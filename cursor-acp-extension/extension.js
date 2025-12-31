const vscode = require('vscode');
const patcher = require('./patcher');
const { spawn } = require('child_process');
const { createInterface } = require('readline');
const http = require('http');

/**
 * ACP Agent Manager - Handles subprocess lifecycle and JSON-RPC communication
 */
class ACPAgentManager {
    constructor() {
        this.agents = new Map(); // Map<providerId, AgentProcess>
        this.nextMessageId = 1;
    }

    /**
     * Spawn an ACP agent subprocess
     */
    async spawnAgent(provider) {
        if (this.agents.has(provider.id)) {
            console.log(`[ACP] Agent ${provider.id} already running`);
            return this.agents.get(provider.id);
        }

        console.log(`[ACP] Spawning agent: ${provider.command} ${provider.args?.join(' ')}`);

        const proc = spawn(provider.command, provider.args || [], {
            stdio: ['pipe', 'pipe', 'pipe'],
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
                console.log(`[ACP] <- Received:`, message);

                // Handle response
                if (message.id !== undefined && agent.pendingRequests.has(message.id)) {
                    const { resolve, reject } = agent.pendingRequests.get(message.id);
                    agent.pendingRequests.delete(message.id);

                    if (message.error) {
                        reject(new Error(message.error.message || 'ACP error'));
                    } else {
                        resolve(message.result);
                    }
                }

                // Handle notification (session/update)
                if (message.method === 'session/update') {
                    console.log(`[ACP] Session update:`, message.params);

                    // Call listener if set (during sendPrompt)
                    if (agent.sessionUpdateListener) {
                        agent.sessionUpdateListener(message.params);
                    }
                }
            } catch (error) {
                console.error('[ACP] Failed to parse message:', line, error);
            }
        });

        // Handle stderr
        proc.stderr.on('data', (data) => {
            console.error(`[ACP] stderr:`, data.toString());
        });

        // Handle process exit
        proc.on('close', (code) => {
            console.log(`[ACP] Process exited with code ${code}`);
            this.agents.delete(provider.id);
        });

        this.agents.set(provider.id, agent);

        // Initialize the agent
        await this.initialize(agent);

        // Create session
        await this.createSession(agent, provider);

        return agent;
    }

    /**
     * Send JSON-RPC request to agent
     */
    sendRequest(agent, method, params) {
        return new Promise((resolve, reject) => {
            const id = this.nextMessageId++;
            const request = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };

            agent.pendingRequests.set(id, { resolve, reject });

            const message = JSON.stringify(request) + '\n';
            console.log(`[ACP] -> Sending:`, request);
            agent.process.stdin.write(message);

            // Timeout after 30 seconds
            setTimeout(() => {
                if (agent.pendingRequests.has(id)) {
                    agent.pendingRequests.delete(id);
                    reject(new Error('Request timeout'));
                }
            }, 30000);
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
        console.log(`[ACP] Agent initialized:`, result);
        return result;
    }

    /**
     * Create ACP session
     */
    async createSession(agent, provider) {
        // Use session/new per ACP protocol spec
        const result = await this.sendRequest(agent, 'session/new', {
            cwd: process.cwd(),
            mcpServers: []
        });

        agent.sessionId = result.sessionId;
        console.log(`[ACP] Session created:`, agent.sessionId);
        return result;
    }

    /**
     * Send prompt to ACP agent
     */
    async sendPrompt(agent, messages) {
        const lastMessage = messages[messages.length - 1];

        console.log('[ACP] Sending prompt with message:', lastMessage);

        // Collect session/update notifications
        const responseChunks = [];
        const allUpdates = [];
        let stopReason = null;

        // Set up temporary listener for session/update
        const vscode = require('vscode');
        agent.sessionUpdateListener = (params) => {
            console.log('[ACP] ===== Session update received =====');
            console.log('[ACP] Full params:', JSON.stringify(params));
            allUpdates.push(params);

            // Extract text from the correct structure: params.update.content.text
            if (params.update?.sessionUpdate === 'agent_message_chunk') {
                const content = params.update.content;
                if (content?.type === 'text' && content.text) {
                    console.log('[ACP] Found text chunk:', content.text);
                    responseChunks.push(content.text);
                }
            }

            if (params.stopReason) {
                stopReason = params.stopReason;
            }
        };

        // Use session/prompt per ACP protocol spec
        const result = await this.sendRequest(agent, 'session/prompt', {
            sessionId: agent.sessionId,
            prompt: [
                {
                    type: 'text',
                    text: lastMessage.content
                }
            ]
        });

        // Clean up listener
        delete agent.sessionUpdateListener;

        console.log(`[ACP] ===== FINAL RESULTS =====`);
        console.log(`[ACP] Total updates received: ${allUpdates.length}`);
        console.log(`[ACP] All updates:`, allUpdates);
        console.log(`[ACP] Collected ${responseChunks.length} text chunks:`, responseChunks);
        console.log(`[ACP] Final stopReason:`, result.stopReason);

        const finalText = responseChunks.join('');
        console.log(`[ACP] Combined text (${finalText.length} chars):`, finalText.substring(0, 200));

        // ALERT: Show final results
        if (finalText.length > 0) {
            vscode.window.showInformationMessage(`[ACP SUCCESS] Extracted ${responseChunks.length} chunks, ${finalText.length} chars total`);
        } else {
            vscode.window.showErrorMessage(`[ACP ERROR] No text extracted from ${allUpdates.length} updates!`);
        }

        // Return combined response
        return {
            text: finalText,
            stopReason: result.stopReason,
            allUpdates: allUpdates  // For debugging
        };
    }

    /**
     * Cleanup - kill all agent processes
     */
    cleanup() {
        for (const [id, agent] of this.agents) {
            console.log(`[ACP] Killing agent: ${id}`);
            agent.process.kill();
        }
        this.agents.clear();
    }
}

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('[ACP] Extension activating...');

    const agentManager = new ACPAgentManager();

    // Create HTTP server for renderer-to-extension communication
    const server = http.createServer(async (req, res) => {
        // Enable CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (req.method === 'POST' && req.url === '/acp/sendMessage') {
            let body = '';

            req.on('data', chunk => {
                body += chunk.toString();
            });

            req.on('end', async () => {
                try {
                    const { provider, messages } = JSON.parse(body);
                    console.log(`[ACP HTTP] Received request for provider: ${provider.id}`);

                    vscode.window.showInformationMessage(`[ACP HTTP] Processing ${provider.id} request...`);

                    // Spawn or get existing agent
                    const agent = await agentManager.spawnAgent(provider);

                    // Send prompt
                    const response = await agentManager.sendPrompt(agent, messages);

                    // DEBUG: Show full response structure
                    vscode.window.showInformationMessage(`[ACP DEBUG] Full response: ${JSON.stringify(response).substring(0, 200)}`);

                    // Extract text from response (format may vary)
                    const responseText = response.text ||
                                       response.content ||
                                       response.message?.content ||
                                       JSON.stringify(response);

                    vscode.window.showInformationMessage(`[ACP DEBUG] Extracted text: ${responseText.substring(0, 100)}`);

                    // Convert to OpenAI format
                    const result = {
                        id: `acp-${Date.now()}`,
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: `acp:${provider.id}`,
                        choices: [{
                            index: 0,
                            message: {
                                role: 'assistant',
                                content: responseText
                            },
                            finish_reason: 'stop'
                        }],
                        usage: {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                            total_tokens: 0
                        }
                    };

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));

                } catch (error) {
                    console.error('[ACP HTTP] Error:', error);
                    vscode.window.showErrorMessage(`[ACP HTTP] Error: ${error.message}`);

                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: true, message: error.message }));
                }
            });
        } else {
            res.writeHead(404);
            res.end('Not Found');
        }
    });

    server.on('error', (err) => {
        console.error('[ACP] HTTP server error:', err);
        vscode.window.showErrorMessage(`[ACP] Failed to start server: ${err.message}`);
    });

    server.listen(37842, 'localhost', () => {
        console.log('[ACP] HTTP server listening on http://localhost:37842');
        vscode.window.showInformationMessage('[ACP] Bridge server started on port 37842');
    });

    // Close server on deactivation
    context.subscriptions.push({
        dispose: () => {
            server.close();
            console.log('[ACP] HTTP server closed');
        }
    });

    // Register enable command
    let enableCommand = vscode.commands.registerCommand('acp.enable', async () => {
        try {
            // Show which path we're patching
            const workbenchPath = require('./patcher').getWorkbenchPath();
            vscode.window.showInformationMessage(`Patching: ${workbenchPath}`);

            vscode.window.showInformationMessage('Enabling ACP integration...');

            // Apply patches
            await patcher.applyPatches();

            vscode.window.showInformationMessage(
                'ACP integration enabled! Please restart Cursor for changes to take effect.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to enable ACP: ${error.message}`);
            console.error('ACP enable error:', error);
        }
    });

    // Register disable command
    let disableCommand = vscode.commands.registerCommand('acp.disable', async () => {
        try {
            vscode.window.showInformationMessage('Disabling ACP integration...');

            // Remove patches
            await patcher.removePatches();

            vscode.window.showInformationMessage(
                'ACP integration disabled! Please restart Cursor for changes to take effect.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to disable ACP: ${error.message}`);
            console.error('ACP disable error:', error);
        }
    });

    // Register reload command
    let reloadCommand = vscode.commands.registerCommand('acp.reload', async () => {
        try {
            vscode.window.showInformationMessage('Reloading ACP integration...');

            // Remove old patches
            await patcher.removePatches();

            // Reapply patches
            await patcher.applyPatches();

            vscode.window.showInformationMessage(
                'ACP integration reloaded! Please restart Cursor for changes to take effect.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reload ACP: ${error.message}`);
            console.error('ACP reload error:', error);
        }
    });

    // Register sendMessage command for ACP communication
    let sendMessageCommand = vscode.commands.registerCommand('acp.sendMessage', async (provider, messages) => {
        try {
            vscode.window.showInformationMessage(`[ACP Ext] Starting communication with ${provider.id}`);
            console.log(`[ACP] sendMessage called for provider:`, provider.id);

            // Spawn or get existing agent
            vscode.window.showInformationMessage(`[ACP Ext] Spawning agent: ${provider.command}`);
            const agent = await agentManager.spawnAgent(provider);

            vscode.window.showInformationMessage(`[ACP Ext] Agent spawned, sending prompt...`);

            // Send prompt
            const response = await agentManager.sendPrompt(agent, messages);

            vscode.window.showInformationMessage(`[ACP Ext] Got response: ${response.text?.substring(0, 50)}...`);

            // Convert ACP response to OpenAI-style format
            return {
                id: `acp-${Date.now()}`,
                object: 'chat.completion',
                created: Math.floor(Date.now() / 1000),
                model: `acp:${provider.id}`,
                choices: [{
                    index: 0,
                    message: {
                        role: 'assistant',
                        content: response.text || '[No response from ACP agent]'
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
            vscode.window.showErrorMessage(`[ACP Ext] Error: ${error.message}`);
            console.error('[ACP] sendMessage error:', error);
            return {
                error: true,
                message: error.message
            };
        }
    });

    context.subscriptions.push(enableCommand, disableCommand, reloadCommand, sendMessageCommand);

    // Cleanup on deactivation
    context.subscriptions.push({
        dispose: () => {
            agentManager.cleanup();
        }
    });
}

function deactivate() {
    console.log('cursor-acp-extension deactivated');
}

module.exports = {
    activate,
    deactivate
};
