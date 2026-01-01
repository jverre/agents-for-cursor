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
            return this.agents.get(provider.id);
        }

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
                if (message.method === 'session/update' && agent.sessionUpdateListener) {
                    agent.sessionUpdateListener(message.params);
                }
            } catch (error) {
                console.error('[ACP] Failed to parse message:', error);
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
        return result;
    }

    /**
     * Create ACP session
     */
    async createSession(agent, provider) {
        const result = await this.sendRequest(agent, 'session/new', {
            cwd: process.cwd(),
            mcpServers: []
        });

        agent.sessionId = result.sessionId;
        return result;
    }

    /**
     * Send prompt to ACP agent
     * Creates a NEW session for each message and sends full conversation history
     */
    async sendPrompt(agent, messages) {
        // Create NEW session for this conversation
        const sessionResult = await this.sendRequest(agent, 'session/new', {
            cwd: process.cwd(),
            mcpServers: []
        });

        const sessionId = sessionResult.sessionId;
        console.log(`[ACP] Created new session ${sessionId} with ${messages.length} messages`);

        let finalResponse = null;

        // Send all messages in the conversation
        for (let i = 0; i < messages.length; i++) {
            const message = messages[i];
            const isLastMessage = (i === messages.length - 1);
            const responseChunks = [];

            // Set up listener only for the last message (current user message)
            if (isLastMessage) {
                agent.sessionUpdateListener = (params) => {
                    if (params.update?.sessionUpdate === 'agent_message_chunk') {
                        const content = params.update.content;
                        if (content?.type === 'text' && content.text) {
                            responseChunks.push(content.text);
                        }
                    }
                };
            }

            // Send message to session
            const result = await this.sendRequest(agent, 'session/prompt', {
                sessionId: sessionId,
                prompt: [{
                    type: 'text',
                    text: message.content
                }]
            });

            if (isLastMessage) {
                delete agent.sessionUpdateListener;
                finalResponse = {
                    text: responseChunks.join(''),
                    stopReason: result.stopReason
                };
            }
        }

        console.log(`[ACP] Session ${sessionId} complete`);
        return finalResponse;
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
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
            res.writeHead(200);
            res.end();
            return;
        }

        if (req.method === 'POST' && req.url === '/acp/sendMessage') {
            let body = '';
            req.on('data', chunk => { body += chunk.toString(); });

            req.on('end', async () => {
                try {
                    const { provider, messages } = JSON.parse(body);
                    const agent = await agentManager.spawnAgent(provider);
                    const response = await agentManager.sendPrompt(agent, messages);

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
                        usage: {
                            prompt_tokens: 0,
                            completion_tokens: 0,
                            total_tokens: 0
                        }
                    };

                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify(result));
                } catch (error) {
                    console.error('[ACP] Error:', error);
                    res.writeHead(500, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ error: true, message: error.message }));
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

    let sendMessageCommand = vscode.commands.registerCommand('acp.sendMessage', async (provider, messages) => {
        try {
            const agent = await agentManager.spawnAgent(provider);
            const response = await agentManager.sendPrompt(agent, messages);

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
