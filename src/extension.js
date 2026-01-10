const vscode = require('vscode');
const patcher = require('./patcher');
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// File-based logging for ACP - logs to ~/.cursor-acp.log
const ACP_LOG_PATH = path.join(os.homedir(), '.cursor-acp.log');

/**
 * Log a message to the ACP log file and console
 * @param {string} level - Log level: INFO, DEBUG, WARN, ERROR
 * @param  {...any} args - Message parts to log
 */
function acpLog(level, ...args) {
    const timestamp = new Date().toISOString();
    const message = `[${timestamp}] [${level}] ${args.join(' ')}\n`;
    try {
        fs.appendFileSync(ACP_LOG_PATH, message);
    } catch (e) {
        // Ignore file write errors
    }
    console.log(`[ACP] ${args.join(' ')}`);
}

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
            sessionUpdateListeners: new Map(),  // Map<sessionId, {onUpdate, chunkSeq}>
            readline: createInterface({ input: proc.stdout }),
        };

        // Handle stdout (JSON-RPC responses and notifications)
        agent.readline.on('line', (line) => {
            try {
                const message = JSON.parse(line);

                // Handle response to our requests
                if (message.id !== undefined && agent.pendingRequests.has(message.id)) {
                    const { resolve, reject, startTime, method } = agent.pendingRequests.get(message.id);
                    agent.pendingRequests.delete(message.id);
                    const elapsed = startTime ? Date.now() - startTime : 0;
                    acpLog('INFO', '[ACP] 📩 Response received | id:', message.id, '| method:', method, '| elapsed:', elapsed, 'ms | error:', !!message.error);

                    if (message.error) {
                        acpLog('ERROR', '[ACP] ❌ Request error:', message.error.message || message.error);
                        reject(new Error(message.error.message || 'ACP error'));
                    } else {
                        resolve(message.result);
                    }
                }

                // Handle permission requests from agent - auto-approve all
                if (message.method === 'session/request_permission' && message.id !== undefined) {
                    acpLog('INFO', '[ACP] Auto-approving permission request:', message.params?.permission?.kind);
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
                    acpLog('INFO', '[ACP] 🔧 Terminal CREATE:', terminalId, '| cmd:', command, args?.join(' ').slice(0, 50), '| cwd:', cwd?.slice(-30));

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

                    const terminalStart = Date.now();
                    termProc.stdout.on('data', (data) => {
                        const chunk = data.toString();
                        terminal.output += chunk;
                        acpLog('INFO', '[ACP] 📄 Terminal', terminalId, 'stdout:', chunk.length, 'bytes | total:', terminal.output.length);
                    });
                    termProc.stderr.on('data', (data) => {
                        const chunk = data.toString();
                        terminal.output += chunk;
                        acpLog('INFO', '[ACP] 📄 Terminal', terminalId, 'stderr:', chunk.length, 'bytes');
                    });
                    termProc.on('error', (err) => {
                        acpLog('ERROR', '[ACP] ❌ Terminal', terminalId, 'error:', err.message);
                        terminal.exitCode = -1;
                        terminal.done = true;
                    });
                    termProc.on('close', (code) => {
                        const elapsed = Date.now() - terminalStart;
                        terminal.exitCode = code;
                        terminal.done = true;
                        acpLog('INFO', '[ACP] ✅ Terminal', terminalId, 'exited | code:', code, '| elapsed:', elapsed, 'ms | output:', terminal.output.length, 'bytes');
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
                    acpLog('INFO', '[ACP] ⏳ Terminal WAIT:', terminalId, '| done:', terminal?.done, '| exitCode:', terminal?.exitCode);

                    const sendResult = () => {
                        acpLog('INFO', '[ACP] ✅ Terminal WAIT complete:', terminalId, '| exitCode:', terminal?.exitCode ?? 0);
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
                    acpLog('INFO', '[ACP] 📤 Terminal OUTPUT:', terminalId, '| len:', terminal?.output?.length, '| exitCode:', terminal?.exitCode);

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
                    acpLog('INFO', '[ACP] Releasing terminal:', terminalId);

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
                    acpLog('INFO', '[ACP] session/update received:', update?.sessionUpdate, '| session:', sessionId?.slice(0, 8));

                    // Handle available_commands_update - cache slash commands
                    if (update?.sessionUpdate === 'available_commands_update') {
                        agent.slashCommands = update.availableCommands || [];
                        this.slashCommands.set(agent.providerId, agent.slashCommands);
                        acpLog('INFO', '[ACP] Received', agent.slashCommands.length, 'slash commands');
                    }

                    // Handle agent_message_chunk - extract text content
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
                    }

                    // Log tool events for debugging
                    if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
                        acpLog('INFO', '[ACP] Tool event:', update.sessionUpdate, '| id:', update.toolCallId?.slice(0, 8), '| status:', update.status, '| kind:', update.kind);
                    }

                    // Forward to session-specific listener (routes by sessionId to avoid race conditions)
                    const listenerEntry = agent.sessionUpdateListeners.get(sessionId);
                    if (listenerEntry?.onUpdate) {
                        listenerEntry.onUpdate(message.params);
                    }
                }
            } catch (error) {
                acpLog('ERROR', '[ACP] Failed to parse message:', error);
            }
        });

        // Handle stderr - log any errors from the agent
        proc.stderr.on('data', (data) => {
            const msg = data.toString().trim();
            if (msg) {
                // Check if it's an error or just info
                if (msg.includes('error') || msg.includes('Error') || msg.includes('ERROR')) {
                    console.error('[ACP Agent] ❌ STDERR:', msg.slice(0, 200));
                } else {
                    console.log('[ACP Agent] 📢 stderr:', msg.slice(0, 200));
                }
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
            acpLog('INFO', '[ACP] 📨 Sending request:', method, '| id:', id, '| session:', params?.sessionId?.slice(0, 8) || '-');

            const startTime = Date.now();
            agent.pendingRequests.set(id, { resolve, reject, startTime, method });
            agent.process.stdin.write(JSON.stringify(request) + '\n');

            setTimeout(() => {
                if (agent.pendingRequests.has(id)) {
                    const elapsed = Date.now() - startTime;
                    acpLog('ERROR', '[ACP] ⏰ Request TIMEOUT after', elapsed, 'ms | method:', method, '| id:', id);
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

        // Register session-specific listener for response chunks
        const listenerEntry = {
            chunkSeq: 0,
            onUpdate: (params) => {
                if (params.update?.sessionUpdate === 'agent_message_chunk') {
                    const content = params.update.content;
                    if (content?.type === 'text' && content.text) {
                        responseChunks.push(content.text);
                    }
                }
            }
        };
        agent.sessionUpdateListeners.set(sessionId, listenerEntry);

        let result;
        try {
            // Send only the current message
            result = await this.sendRequest(agent, 'session/prompt', {
                sessionId: sessionId,
                prompt: [{
                    type: 'text',
                    text: message
                }]
            });
        } finally {
            agent.sessionUpdateListeners.delete(sessionId);
        }

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

    // Create HTTP server FIRST (before any dialogs that might block)
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

        // POST /acp/log - receive logs from renderer context
        if (req.method === 'POST' && req.url === '/acp/log') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });
            req.on('end', () => {
                try {
                    const { level, message } = JSON.parse(body);
                    acpLog(level || 'INFO', message);
                } catch (e) {
                    // Ignore parse errors
                }
                res.writeHead(200);
                res.end('ok');
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
                    acpLog('INFO', '[ACP] Getting session for composer:', composerId);
                    vscode.window.showInformationMessage(`[ACP] 1️⃣ getSession called`);

                    const agent = await agentManager.spawnAgent(provider);

                    // Check if we already have a session for this composer
                    const existingSession = agentManager.sessions.get(composerId);
                    if (existingSession && existingSession.providerId === agent.providerId) {
                        acpLog('INFO', '[ACP] Reusing existing session:', existingSession.sessionId);
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

                    acpLog('INFO', '[ACP] Created new session:', sessionResult.sessionId);
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ sessionId: sessionResult.sessionId }));
                } catch (error) {
                    acpLog('ERROR', '[ACP] Error getting session:', error);
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
                    acpLog('INFO', '[ACP] Initializing session for slash commands, provider:', provider.id);

                    const agent = await agentManager.spawnAgent(provider);

                    // Create a session to trigger available_commands_update
                    const sessionResult = await agentManager.sendRequest(agent, 'session/new', {
                        cwd: getWorkspacePath(),
                        mcpServers: []
                    });

                    acpLog('INFO', '[ACP] Session created:', sessionResult.sessionId);

                    // Wait a bit for the agent to send available_commands_update
                    await new Promise(resolve => setTimeout(resolve, 500));

                    const commands = agentManager.slashCommands.get(provider.id) || [];
                    acpLog('INFO', '[ACP] Slash commands after init:', commands.length);

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({
                        sessionId: sessionResult.sessionId,
                        commands: commands
                    }));
                } catch (error) {
                    acpLog('ERROR', '[ACP] Error initializing session:', error);
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

                        // Register session-specific streaming listener (keyed by sessionId to avoid race conditions)
                        const listenerEntry = {
                            chunkSeq: 0,
                            onUpdate: (params) => {
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
                                        const seq = listenerEntry.chunkSeq++;
                                        console.log(`[ACP] 📝 Chunk session=${sessionId.slice(0, 8)} seq=${seq} len=${textContent.length} preview="${textContent.slice(0, 30).replace(/\n/g, '\\n')}..."`);
                                        res.write(JSON.stringify({ type: 'text', content: textContent, seq }) + '\n');
                                    }
                                } else if (update?.sessionUpdate === 'tool_call' || update?.sessionUpdate === 'tool_call_update') {
                                    console.log(`[ACP] 🔧 Tool session=${sessionId.slice(0, 8)} event=${update.sessionUpdate} status=${update.status || 'pending'}`);
                                    res.write(JSON.stringify({ type: 'tool', ...update }) + '\n');
                                }
                            }
                        };
                        agent.sessionUpdateListeners.set(sessionId, listenerEntry);
                        console.log(`[ACP] 📡 Registered listener for session ${sessionId.slice(0, 8)} (total: ${agent.sessionUpdateListeners.size})`);

                        try {
                            // Send prompt and wait for completion
                            await agentManager.sendRequest(agent, 'session/prompt', {
                                sessionId: sessionId,
                                prompt: [{ type: 'text', text: message }]
                            });

                            // Send done marker and end
                            res.write(JSON.stringify({ type: 'done' }) + '\n');
                            res.end();
                        } finally {
                            // Always clean up listener
                            agent.sessionUpdateListeners.delete(sessionId);
                            console.log(`[ACP] 📡 Unregistered listener for session ${sessionId.slice(0, 8)} (remaining: ${agent.sessionUpdateListeners.size})`);
                        }
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
                    acpLog('ERROR', '[ACP] Error:', error);
                    if (!res.headersSent) {
                        res.writeHead(500, { 'Content-Type': 'application/json' });
                        res.end(JSON.stringify({ error: true, message: error.message }));
                    } else {
                        // Headers already sent (streaming), just end the response
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
            context.globalState.update('active', true);
            context.globalState.update('firstRun', false);
            vscode.window.showInformationMessage(
                'Agents for Cursor enabled! Please restart Cursor.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to enable Agents for Cursor: ${error.message}`);
        }
    });

    let disableCommand = vscode.commands.registerCommand('acp.disable', async () => {
        try {
            await patcher.removePatches();
            context.globalState.update('active', undefined);
            context.globalState.update('firstRun', undefined);
            vscode.window.showInformationMessage(
                'Agents for Cursor disabled! Please restart Cursor.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to disable Agents for Cursor: ${error.message}`);
        }
    });

    let reloadCommand = vscode.commands.registerCommand('acp.reload', async () => {
        try {
            agentManager.cleanup();
            await patcher.removePatches();
            await patcher.applyPatches();
            context.globalState.update('active', true);
            vscode.window.showInformationMessage(
                'Agents for Cursor reloaded! Please restart Cursor.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reload Agents for Cursor: ${error.message}`);
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
            acpLog('ERROR', '[ACP] Error:', error);
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

    // Handle first-run consent dialog and re-apply detection
    // This runs AFTER server and commands are registered so they're always available
    const firstRun = context.globalState.get('firstRun');
    const active = context.globalState.get('active');

    if (firstRun === undefined) {
        // First install - show consent dialog (non-blocking for commands/server)
        vscode.window.showInformationMessage(
            'Agents for Cursor will modify Cursor files to enable agent integration. ' +
            'You can disable this anytime via the command palette or reinstall Cursor.',
            'Proceed', 'Cancel'
        ).then(async (result) => {
            context.globalState.update('firstRun', false);

            if (result === 'Proceed') {
                try {
                    await patcher.applyPatches();
                    context.globalState.update('active', true);
                    vscode.window.showInformationMessage(
                        'Agents for Cursor enabled! Please restart Cursor to activate.',
                        'Restart Now'
                    ).then(selection => {
                        if (selection === 'Restart Now') {
                            vscode.commands.executeCommand('workbench.action.reloadWindow');
                        }
                    });
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to enable Agents for Cursor: ${error.message}`);
                }
            }
        });
    } else if (active) {
        // User previously enabled patches - verify they're still valid
        patcher.isPatchValid().then(async (patchesValid) => {
            if (!patchesValid) {
                const result = await vscode.window.showInformationMessage(
                    'Agents for Cursor patches were overwritten (Cursor may have updated).',
                    'Re-apply', 'Disable'
                );

                if (result === 'Re-apply') {
                    try {
                        await patcher.applyPatches();
                        vscode.window.showInformationMessage(
                            'Agents for Cursor re-applied! Please restart Cursor.',
                            'Restart Now'
                        ).then(selection => {
                            if (selection === 'Restart Now') {
                                vscode.commands.executeCommand('workbench.action.reloadWindow');
                            }
                        });
                    } catch (error) {
                        vscode.window.showErrorMessage(`Failed to re-apply Agents for Cursor: ${error.message}`);
                    }
                } else if (result === 'Disable') {
                    context.globalState.update('active', false);
                }
            }
        });
    }
}

function deactivate() {}

module.exports = {
    activate,
    deactivate
};
//test
