const vscode = require('vscode');
const patcher = require('./patcher');
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const http = require('http');

/**
 * Get the current workspace folder path
 */
function getWorkspacePath() {
    const folders = vscode.workspace.workspaceFolders;
    if (folders && folders.length > 0) {
        return folders[0].uri.fsPath;
    }
    // Fallback to process.cwd() if no workspace is open
    return process.cwd();
}

/**
 * ACP Agent Manager - Handles subprocess lifecycle and JSON-RPC communication
 */
class ACPAgentManager {
    constructor() {
        this.agents = new Map(); // Map<providerId, AgentProcess>
        this.sessions = new Map(); // Map<composerId, { sessionId, providerId }>
        this.slashCommands = new Map(); // Map<providerId, AvailableCommand[]>
        this.toolCallListeners = new Map(); // Map<sessionId, Set<response>> for SSE
        this.toolCallNames = new Map(); // Map<toolCallId, toolName> - cache names for updates
        this.terminals = new Map(); // Map<terminalId, { process, output, exitCode, done }>
        this.nextMessageId = 1;
        this.nextTerminalId = 1;
    }

    /**
     * Spawn an ACP agent subprocess
     */
    async spawnAgent(provider) {
        if (this.agents.has(provider.id)) {
            return this.agents.get(provider.id);
        }

        const workspacePath = getWorkspacePath();
        const proc = spawn(provider.command, provider.args || [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            cwd: workspacePath,
            env: { ...process.env, ...provider.env }
        });

        const agent = {
            process: proc,
            providerId: provider.id,
            sessionId: null,
            initialized: false,
            pendingRequests: new Map(),
            readline: createInterface({ input: proc.stdout }),
        };

        // Handle stdout (JSON-RPC responses and notifications)
        agent.readline.on('line', (line) => {
            try {
                const message = JSON.parse(line);

                // Handle response to our requests
                if (message.id !== undefined && agent.pendingRequests.has(message.id)) {
                    const { resolve, reject } = agent.pendingRequests.get(message.id);
                    agent.pendingRequests.delete(message.id);

                    if (message.error) {
                        reject(new Error(message.error.message || 'ACP error'));
                    } else {
                        resolve(message.result);
                    }
                }

                // Handle permission requests from agent - auto-approve all
                if (message.method === 'session/request_permission' && message.id !== undefined) {
                    console.log('[ACP] Auto-approving permission request:', message.params?.permission?.kind);
                    const response = {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: { granted: true }
                    };
                    agent.process.stdin.write(JSON.stringify(response) + '\n');
                }

                // Handle terminal/create - spawn command and return terminal ID
                if (message.method === 'terminal/create' && message.id !== undefined) {
                    const { command, args, cwd } = message.params || {};
                    const terminalId = `term_${this.nextTerminalId++}`;
                    console.log('[ACP] Creating terminal:', terminalId, command, args?.join(' '));

                    const cmdArgs = args || [];
                    const termProc = spawn(command, cmdArgs, {
                        cwd: cwd || getWorkspacePath(),
                        shell: true,
                        env: process.env
                    });

                    const terminal = {
                        process: termProc,
                        output: '',
                        exitCode: null,
                        done: false
                    };

                    termProc.stdout.on('data', (data) => {
                        terminal.output += data.toString();
                    });
                    termProc.stderr.on('data', (data) => {
                        terminal.output += data.toString();
                    });
                    termProc.on('close', (code) => {
                        terminal.exitCode = code;
                        terminal.done = true;
                        console.log('[ACP] Terminal', terminalId, 'exited with code:', code);
                    });

                    this.terminals.set(terminalId, terminal);

                    const response = {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: { terminalId }
                    };
                    agent.process.stdin.write(JSON.stringify(response) + '\n');
                }

                // Handle terminal/wait_for_exit - wait for process to finish
                if (message.method === 'terminal/wait_for_exit' && message.id !== undefined) {
                    const { terminalId } = message.params || {};
                    const terminal = this.terminals.get(terminalId);
                    console.log('[ACP] Waiting for terminal:', terminalId);

                    const sendResult = () => {
                        const response = {
                            jsonrpc: '2.0',
                            id: message.id,
                            result: { exitCode: terminal?.exitCode ?? 0 }
                        };
                        agent.process.stdin.write(JSON.stringify(response) + '\n');
                    };

                    if (terminal?.done) {
                        sendResult();
                    } else if (terminal) {
                        terminal.process.on('close', sendResult);
                    } else {
                        sendResult(); // Terminal not found, return 0
                    }
                }

                // Handle terminal/output - return accumulated output
                if (message.method === 'terminal/output' && message.id !== undefined) {
                    const { terminalId } = message.params || {};
                    const terminal = this.terminals.get(terminalId);
                    console.log('[ACP] Getting output for terminal:', terminalId);

                    const response = {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: {
                            output: terminal?.output || '',
                            exitCode: terminal?.exitCode
                        }
                    };
                    agent.process.stdin.write(JSON.stringify(response) + '\n');
                }

                // Handle terminal/release - cleanup terminal
                if (message.method === 'terminal/release' && message.id !== undefined) {
                    const { terminalId } = message.params || {};
                    console.log('[ACP] Releasing terminal:', terminalId);

                    const terminal = this.terminals.get(terminalId);
                    if (terminal?.process && !terminal.done) {
                        terminal.process.kill();
                    }
                    this.terminals.delete(terminalId);

                    const response = {
                        jsonrpc: '2.0',
                        id: message.id,
                        result: {}
                    };
                    agent.process.stdin.write(JSON.stringify(response) + '\n');
                }

                // Handle notification (session/update)
                if (message.method === 'session/update') {
                    const update = message.params?.update;
                    const sessionId = message.params?.sessionId;

                    // Handle available_commands_update - cache slash commands
                    if (update?.sessionUpdate === 'available_commands_update') {
                        agent.slashCommands = update.availableCommands || [];
                        this.slashCommands.set(agent.providerId, agent.slashCommands);
                        console.log('[ACP] Received', agent.slashCommands.length, 'slash commands');
                    }

                    // Handle agent_message_chunk - stream text to SSE listeners
                    if (update?.sessionUpdate === 'agent_message_chunk') {
                        // Extract text from content - may be nested as { type: 'text', text: '...' }
                        let textContent = '';
                        if (typeof update.content === 'string') {
                            textContent = update.content;
                        } else if (update.content?.type === 'text' && typeof update.content?.text === 'string') {
                            textContent = update.content.text;
                        } else if (typeof update.content?.text === 'string') {
                            textContent = update.content.text;
                        }

                        // Skip empty chunks
                        if (!textContent) {
                            return;
                        }

                        const listeners = this.toolCallListeners.get(sessionId);
                        if (listeners && listeners.size > 0) {
                            const chunkData = JSON.stringify({
                                type: 'agent_message_chunk',
                                content: textContent
                            });
                            for (const listener of listeners) {
                                listener.write(`data: ${chunkData}\n\n`);
                            }
                        }
                    }

                    // Handle tool_call and tool_call_update - stream to SSE listeners
                    if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
                        const toolCallId = update.toolCallId;

                        // Extract tool name from _meta.claudeCode.toolName (e.g., "mcp__acp__Bash" -> "Bash")
                        let toolName = 'unknown';
                        const metaToolName = update._meta?.claudeCode?.toolName;
                        if (metaToolName) {
                            // Extract last part: "mcp__acp__Bash" -> "Bash"
                            const parts = metaToolName.split('__');
                            toolName = parts[parts.length - 1] || metaToolName;
                        } else if (update.title) {
                            toolName = update.title.split(' ')[0] || update.kind || 'unknown';
                        }

                        // Cache tool name for updates (which may not have _meta)
                        if (toolCallId && toolName !== 'unknown') {
                            this.toolCallNames.set(toolCallId, toolName);
                        } else if (toolCallId && this.toolCallNames.has(toolCallId)) {
                            toolName = this.toolCallNames.get(toolCallId);
                        } else if (update.kind) {
                            toolName = update.kind;
                        }

                        const listeners = this.toolCallListeners.get(sessionId);
                        if (listeners && listeners.size > 0) {
                            const toolData = JSON.stringify({
                                type: update.sessionUpdate,
                                toolCallId: toolCallId,
                                name: toolName,
                                tool: toolName,
                                title: update.title,
                                kind: update.kind,
                                status: update.status,
                                rawInput: update.rawInput,
                                input: update.rawInput,
                                content: update.content,
                                result: update._meta?.claudeCode?.toolResponse || update.content
                            });
                            for (const listener of listeners) {
                                listener.write(`data: ${toolData}\n\n`);
                            }
                        }
                    }

                    // Forward to listener for other updates
                    if (agent.sessionUpdateListener) {
                        agent.sessionUpdateListener(message.params);
                    }
                }
            } catch (error) {
                console.error('[ACP] Failed to parse message:', error);
            }
        });

        // Handle stderr - log any errors from the agent
        proc.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) {
                console.error('[ACP Agent stderr]', msg);
            }
        });

        // Handle process exit
        proc.on('close', () => {
            this.agents.delete(provider.id);
        });

        this.agents.set(provider.id, agent);

        // Initialize the agent
        await this.initialize(agent);

        // Note: Session creation moved to sendPrompt() - we create a new session for each message

        return agent;
    }

    /**
     * Send JSON-RPC request to agent
     */
    sendRequest(agent, method, params) {
        return new Promise((resolve, reject) => {
            const id = this.nextMessageId++;
            const request = { jsonrpc: '2.0', id, method, params };

            agent.pendingRequests.set(id, { resolve, reject });
            agent.process.stdin.write(JSON.stringify(request) + '\n');

            setTimeout(() => {
                if (agent.pendingRequests.has(id)) {
                    agent.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 300000); // 5 minutes timeout for long-running requests
        });
    }

    /**
     * Initialize ACP agent
     */
    async initialize(agent) {
        const result = await this.sendRequest(agent, 'initialize', {
            protocolVersion: 1,
            clientInfo: {
                name: 'cursor',
                version: '0.43.0'
            },
            clientCapabilities: {
                readTextFile: true,
                writeTextFile: true,
                terminal: true
            }
        });

        agent.initialized = true;
        return result;
    }

    /**
     * Create ACP session
     */
    async createSession(agent, provider) {
        const result = await this.sendRequest(agent, 'session/new', {
            cwd: getWorkspacePath(),
            mcpServers: []
        });

        agent.sessionId = result.sessionId;
        return result;
    }

    /**
     * Send prompt to ACP agent
     * Uses persistent sessions per composer - agent maintains conversation history
     */
    async sendPrompt(agent, message, composerId) {
        // Get or create session for this composer
        let sessionId;
        const existingSession = this.sessions.get(composerId);

        if (existingSession && existingSession.providerId === agent.providerId) {
            sessionId = existingSession.sessionId;
            console.log(`[ACP] Reusing session ${sessionId} for composer ${composerId}`);
        } else {
            // Create new session for this composer
            const sessionResult = await this.sendRequest(agent, 'session/new', {
                cwd: getWorkspacePath(),
                mcpServers: []
            });
            sessionId = sessionResult.sessionId;
            this.sessions.set(composerId, { sessionId, providerId: agent.providerId });
            console.log(`[ACP] Created new session ${sessionId} for composer ${composerId}`);

            // Set permission mode to bypass all permission checks
            try {
                await this.sendRequest(agent, 'session/set_mode', {
                    sessionId: sessionId,
                    modeId: 'bypassPermissions'
                });
                console.log(`[ACP] Set permission mode to bypassPermissions for session ${sessionId}`);
            } catch (err) {
                console.log(`[ACP] Could not set permission mode: ${err.message}`);
            }
        }

        const responseChunks = [];

        // Set up listener for response chunks
        agent.sessionUpdateListener = (params) => {
            if (params.update?.sessionUpdate === 'agent_message_chunk') {
                const content = params.update.content;
                if (content?.type === 'text' && content.text) {
                    responseChunks.push(content.text);
                }
            }
        };

        // Send only the current message
        const result = await this.sendRequest(agent, 'session/prompt', {
            sessionId: sessionId,
            prompt: [{
                type: 'text',
                text: message
            }]
        });

        delete agent.sessionUpdateListener;

        console.log(`[ACP] Prompt complete for session ${sessionId}`);
        return {
            text: responseChunks.join(''),
            stopReason: result.stopReason
        };
    }

    /**
     * Cleanup - kill all agent processes
     */
    cleanup() {
        for (const [, agent] of this.agents) {
            agent.process.kill();
        }
        this.agents.clear();
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
async function activate(context) {
    const agentManager = new ACPAgentManager();

    // First-run detection and auto-patching
    const firstRun = context.globalState.get('firstRun');
    const patchesApplied = await patcher.isPatchApplied();

    if (firstRun === undefined) {
        // First install - automatically enable patches
        context.globalState.update('firstRun', false);

        if (!patchesApplied) {
            try {
                await patcher.applyPatches();
                vscode.window.showInformationMessage(
                    'ACP integration enabled! Please restart Cursor to activate.',
                    'Restart Now'
                ).then(selection => {
                    if (selection === 'Restart Now') {
                        vscode.commands.executeCommand('workbench.action.reloadWindow');
                    }
                });
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to enable ACP: ${error.message}`);
            }
        }
    } else if (!patchesApplied) {
        // Not first run, but patches are missing (Cursor update?)
        vscode.window.showInformationMessage(
            'ACP patches need to be reapplied (Cursor may have been updated). Run "ACP: Enable" to activate.',
            'Enable Now'
        ).then(selection => {
            if (selection === 'Enable Now') {
                vscode.commands.executeCommand('acp.enable');
            }
        });
    }

    // Create HTTP server for renderer-to-extension communication
    const server = http.createServer(async (req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        // GET /acp/stream/:sessionId - Server-Sent Events for streaming updates
        if (req.method === 'GET' && req.url.startsWith('/acp/stream/')) {
            const sessionId = decodeURIComponent(req.url.split('/acp/stream/')[1]);
            console.log('[ACP] SSE stream requested for session:', sessionId);
            vscode.window.showInformationMessage(`[ACP] 🔵 Browser SSE request for: ${sessionId?.slice(0,8)}`);

            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders();

            // Disable Nagle's algorithm to send data immediately
            if (res.socket) {
                res.socket.setNoDelay(true);
            }

            // Register this response as a listener
            if (!agentManager.toolCallListeners.has(sessionId)) {
                agentManager.toolCallListeners.set(sessionId, new Set());
            }
            agentManager.toolCallListeners.get(sessionId).add(res);
            vscode.window.showInformationMessage(`[ACP] 2️⃣ SSE listener registered for ${sessionId?.slice(0,8)}`);

            // Send initial connection message
            const connectMsg = `data: ${JSON.stringify({ type: 'connected', sessionId })}\n\n`;
            res.write(connectMsg);
            res.uncork && res.uncork();  // Force flush
            vscode.window.showInformationMessage(`[ACP] 3️⃣ Sent "connected" event to browser`);

            // Cleanup on close
            req.on('close', () => {
                console.log('[ACP] SSE stream closed for session:', sessionId);
                const listeners = agentManager.toolCallListeners.get(sessionId);
                if (listeners) {
                    listeners.delete(res);
                    if (listeners.size === 0) {
                        agentManager.toolCallListeners.delete(sessionId);
                    }
                }
            });

            return;
        }

        // GET /acp/debug - show debug notification
        if (req.method === 'GET' && req.url.startsWith('/acp/debug?')) {
            const url = new URL(req.url, 'http://localhost');
            const msg = url.searchParams.get('msg') || 'debug';
            vscode.window.showInformationMessage(`[ACP] ${msg}`);
            res.writeHead(200);
            res.end('ok');
            return;
        }

        // GET /acp/getSlashCommands - return cached slash commands for a provider
        if (req.method === 'GET' && req.url.startsWith('/acp/getSlashCommands')) {
            const url = new URL(req.url, 'http://localhost');
            const providerId = url.searchParams.get('providerId');
            const commands = agentManager.slashCommands.get(providerId) || [];
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(commands));
            return;
        }

        // POST /acp/getSession - get or create session for a composer (fast, no slash command wait)
        if (req.method === 'POST' && req.url === '/acp/getSession') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });

            req.on('end', async () => {
                try {
                    const { provider, composerId } = JSON.parse(body);
                    console.log('[ACP] Getting session for composer:', composerId);
                    vscode.window.showInformationMessage(`[ACP] 1️⃣ getSession called`);

                    const agent = await agentManager.spawnAgent(provider);

                    // Check if we already have a session for this composer
                    const existingSession = agentManager.sessions.get(composerId);
                    if (existingSession && existingSession.providerId === agent.providerId) {
                        console.log('[ACP] Reusing existing session:', existingSession.sessionId);
                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ sessionId: existingSession.sessionId }));
                        return;
                    }

                    // Create new session
                    const sessionResult = await agentManager.sendRequest(agent, 'session/new', {
                        cwd: getWorkspacePath(),
                        mcpServers: []
                    });
                    agentManager.sessions.set(composerId, {
                        sessionId: sessionResult.sessionId,
                        providerId: agent.providerId
                    });

                    console.log('[ACP] Created new session:', sessionResult.sessionId);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ sessionId: sessionResult.sessionId }));
                } catch (error) {
                    console.error('[ACP] Error getting session:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: true, message: error.message }));
                }
            });
            return;
        }

        // POST /acp/initSession - initialize a session to fetch slash commands
        if (req.method === 'POST' && req.url === '/acp/initSession') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });

            req.on('end', async () => {
                try {
                    const { provider } = JSON.parse(body);
                    console.log('[ACP] Initializing session for slash commands, provider:', provider.id);

                    const agent = await agentManager.spawnAgent(provider);

                    // Create a session to trigger available_commands_update
                    const sessionResult = await agentManager.sendRequest(agent, 'session/new', {
                        cwd: getWorkspacePath(),
                        mcpServers: []
                    });

                    console.log('[ACP] Session created:', sessionResult.sessionId);

                    // Wait a bit for the agent to send available_commands_update
                    await new Promise(resolve => setTimeout(resolve, 500));

                    const commands = agentManager.slashCommands.get(provider.id) || [];
                    console.log('[ACP] Slash commands after init:', commands.length);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        sessionId: sessionResult.sessionId,
                        commands: commands
                    }));
                } catch (error) {
                    console.error('[ACP] Error initializing session:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: true, message: error.message }));
                }
            });
            return;
        }

        if (req.method === 'POST' && req.url === '/acp/sendMessage') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });

            req.on('end', async () => {
                try {
                    const { provider, message, composerId, stream } = JSON.parse(body);

                    if (stream) {
                        // Streaming mode - send chunks as NDJSON
                        res.writeHead(200, {
                            'Content-Type': 'application/x-ndjson',
                            'Transfer-Encoding': 'chunked',
                            'Cache-Control': 'no-cache'
                        });
                        if (res.socket) res.socket.setNoDelay(true);

                        const agent = await agentManager.spawnAgent(provider);

                        // Get or create session
                        let sessionId;
                        const existingSession = agentManager.sessions.get(composerId);
                        if (existingSession && existingSession.providerId === agent.providerId) {
                            sessionId = existingSession.sessionId;
                        } else {
                            const sessionResult = await agentManager.sendRequest(agent, 'session/new', {
                                cwd: getWorkspacePath(),
                                mcpServers: []
                            });
                            sessionId = sessionResult.sessionId;
                            agentManager.sessions.set(composerId, { sessionId, providerId: agent.providerId });
                        }

                        // Always set permission mode (idempotent - safe to call on existing sessions)
                        try {
                            await agentManager.sendRequest(agent, 'session/set_mode', {
                                sessionId: sessionId,
                                modeId: 'bypassPermissions'
                            });
                            console.log(`[ACP] Set permission mode to bypassPermissions for session ${sessionId}`);
                        } catch (err) {
                            console.log(`[ACP] Could not set permission mode: ${err.message}`);
                        }

                        // Set up streaming listener
                        const originalListener = agent.sessionUpdateListener;
                        agent.sessionUpdateListener = (params) => {
                            const update = params.update;

                            if (update?.sessionUpdate === 'agent_message_chunk') {
                                let textContent = '';
                                if (typeof update.content === 'string') {
                                    textContent = update.content;
                                } else if (update.content?.type === 'text') {
                                    textContent = update.content.text || '';
                                } else if (update.content?.text) {
                                    textContent = update.content.text;
                                }
                                if (textContent) {
                                    res.write(JSON.stringify({ type: 'text', content: textContent }) + '\n');
                                }
                            } else if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
                                vscode.window.showInformationMessage(`[ACP] 📤 NDJSON tool: ${update.sessionUpdate} | ${update.status || 'pending'}`);
                                res.write(JSON.stringify({ type: 'tool', ...update }) + '\n');
                            }

                            if (originalListener) originalListener(params);
                        };

                        // Send prompt
                        await agentManager.sendRequest(agent, 'session/prompt', {
                            sessionId: sessionId,
                            prompt: [{ type: 'text', text: message }]
                        });

                        // Send done marker and end
                        res.write(JSON.stringify({ type: 'done' }) + '\n');
                        res.end();

                        agent.sessionUpdateListener = originalListener;
                    } else {
                        // Non-streaming mode (original behavior)
                        const agent = await agentManager.spawnAgent(provider);
                        const response = await agentManager.sendPrompt(agent, message, composerId);

                        const result = {
                            id: `acp-${Date.now()}`,
                            object: 'chat.completion',
                            created: Math.floor(Date.now() / 1000),
                            model: `acp:${provider.id}`,
                            choices: [{
                                index: 0,
                                message: {
                                    role: 'assistant',
                                    content: response.text || '[No response]'
                                },
                                finish_reason: 'stop'
                            }],
                            usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                        };

                        res.writeHead(200, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify(result));
                    }
                } catch (error) {
                    console.error('[ACP] Error:', error);
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: true, message: error.message }));
                    } else {
                        // Headers already sent (e.g., SSE stream), just end the response
                        res.end();
                    }
                }
            });
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.listen(37842, 'localhost');

    context.subscriptions.push({
        dispose: () => server.close()
    });

    let enableCommand = vscode.commands.registerCommand('acp.enable', async () => {
        try {
            await patcher.applyPatches();
            vscode.window.showInformationMessage(
                'ACP integration enabled! Please restart Cursor.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to enable ACP: ${error.message}`);
        }
    });

    let disableCommand = vscode.commands.registerCommand('acp.disable', async () => {
        try {
            await patcher.removePatches();
            vscode.window.showInformationMessage(
                'ACP integration disabled! Please restart Cursor.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to disable ACP: ${error.message}`);
        }
    });

    let reloadCommand = vscode.commands.registerCommand('acp.reload', async () => {
        try {
            await patcher.removePatches();
            await patcher.applyPatches();
            vscode.window.showInformationMessage(
                'ACP integration reloaded! Please restart Cursor.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reload ACP: ${error.message}`);
        }
    });

    let sendMessageCommand = vscode.commands.registerCommand('acp.sendMessage', async (provider, message, composerId) => {
        try {
            const agent = await agentManager.spawnAgent(provider);
            const response = await agentManager.sendPrompt(agent, message, composerId);

            return {
                id: `acp-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: `acp:${provider.id}`,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: response.text || '[No response]'
                    },
                    finish_reason: 'stop'
                }],
                usage: {
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    total_tokens: 0
                }
            };
        } catch (error) {
            console.error('[ACP] Error:', error);
            return { error: true, message: error.message };
        }
    });

    context.subscriptions.push(
        enableCommand,
        disableCommand,
        reloadCommand,
        sendMessageCommand,
        { dispose: () => agentManager.cleanup() }
    );
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
