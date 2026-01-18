#!/usr/bin/env node
/**
 * Script to run a prompt through Claude Code ACP
 * Uses the same permissions as the opencursor project (bypassPermissions mode)
 *
 * Usage:
 *   node scripts/run-acp-prompt.js "Your prompt here"
 *   node scripts/run-acp-prompt.js --prompt "Your prompt here"
 *   node scripts/run-acp-prompt.js --prompt "Edit file..." --cwd /path/to/project
 *   node scripts/run-acp-prompt.js --prompt "Edit file..." --version 0.12.0
 *   node scripts/run-acp-prompt.js --prompt "Edit file..." --debug
 *
 * Available versions (recent): 0.10.x, 0.11.0, 0.12.x, 0.13.x
 */

const { spawn } = require('child_process');
const { createInterface } = require('readline');
const path = require('path');

// Parse command line arguments
function parseArgs() {
    const args = process.argv.slice(2);
    let prompt = null;
    let cwd = process.cwd();
    let version = null; // null = latest
    let debug = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--prompt' && args[i + 1]) {
            prompt = args[i + 1];
            i++;
        } else if (args[i] === '--cwd' && args[i + 1]) {
            cwd = args[i + 1];
            i++;
        } else if (args[i] === '--version' && args[i + 1]) {
            version = args[i + 1];
            i++;
        } else if (args[i] === '--debug') {
            debug = true;
        } else if (!args[i].startsWith('--') && !prompt) {
            prompt = args[i];
        }
    }

    return { prompt, cwd, version, debug };
}

class ACPClient {
    constructor(cwd, version = null, debug = false) {
        this.cwd = cwd;
        this.version = version;
        this.debug = debug;
        this.process = null;
        this.readline = null;
        this.pendingRequests = new Map();
        this.nextMessageId = 1;
        this.sessionId = null;
    }

    log(...args) {
        if (this.debug) {
            console.log('[DEBUG]', ...args);
        }
    }

    async start() {
        return new Promise((resolve, reject) => {
            const packageName = this.version
                ? `@zed-industries/claude-code-acp@${this.version}`
                : '@zed-industries/claude-code-acp';

            console.log('[ACP] Starting Claude Code ACP...');
            console.log('[ACP] Package:', packageName);
            console.log('[ACP] Working directory:', this.cwd);

            this.process = spawn('npx', ['--yes', packageName], {
                stdio: ['pipe', 'pipe', 'pipe'],
                cwd: this.cwd,
                env: process.env
            });

            this.readline = createInterface({ input: this.process.stdout });

            // Handle stdout (JSON-RPC responses and notifications)
            this.readline.on('line', (line) => {
                try {
                    const message = JSON.parse(line);
                    this.log('<<< RECV:', JSON.stringify(message, null, 2).slice(0, 2000));
                    this.handleMessage(message);
                } catch (e) {
                    // Ignore non-JSON lines
                    console.log('[ACP] Non-JSON output:', line);
                }
            });

            // Handle stderr
            this.process.stderr.on('data', (data) => {
                const text = data.toString().trim();
                if (text) {
                    console.error('[ACP] stderr:', text);
                }
            });

            // Handle process exit
            this.process.on('exit', (code) => {
                console.log('[ACP] Process exited with code:', code);
            });

            this.process.on('error', (err) => {
                reject(err);
            });

            // Give it a moment to start
            setTimeout(() => resolve(), 1000);
        });
    }

    handleMessage(message) {
        // Handle response to our requests
        if (message.id !== undefined && this.pendingRequests.has(message.id)) {
            const { resolve, reject } = this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);

            if (message.error) {
                console.error('[ACP] Request error:', message.error.message || message.error);
                reject(new Error(message.error.message || 'ACP error'));
            } else {
                resolve(message.result);
            }
            return;
        }

        // Handle permission requests - auto-approve all (same as opencursor)
        if (message.method === 'session/request_permission' && message.id !== undefined) {
            const params = message.params || {};
            const permissionKind = params.permission?.kind || params.toolCall?.title || 'unknown';
            console.log('[ACP] Auto-approving permission:', permissionKind);
            this.log('Permission details:', JSON.stringify(params, null, 2));

            // New format (0.13.x): uses options array with optionId
            let optionId = 'allow_always';
            if (params.options && Array.isArray(params.options)) {
                const allowAlways = params.options.find(o => o.kind === 'allow_always' || o.optionId === 'allow_always');
                const allowOnce = params.options.find(o => o.kind === 'allow_once' || o.optionId === 'allow');
                optionId = allowAlways?.optionId || allowOnce?.optionId || 'allow_always';
            }

            // ACP protocol format: outcome.outcome = "selected", outcome.optionId = chosen option
            const response = {
                jsonrpc: '2.0',
                id: message.id,
                result: {
                    outcome: {
                        outcome: 'selected',
                        optionId: optionId
                    }
                }
            };
            this.log('Permission response:', JSON.stringify(response.result));
            this.process.stdin.write(JSON.stringify(response) + '\n');
            return;
        }

        // Handle session updates (streaming response)
        if (message.method === 'session/update') {
            const update = message.params?.update;
            const sessionUpdate = update?.sessionUpdate;

            // Log all update types in debug mode
            this.log('Session update type:', sessionUpdate);

            // Handle different update types
            if (sessionUpdate === 'agent_message_chunk') {
                const content = update.content;
                if (content?.type === 'text' && content.text) {
                    process.stdout.write(content.text);
                } else if (content?.type === 'tool_use') {
                    console.log('\n[TOOL_USE] Tool:', content.name);
                    console.log('[TOOL_USE] ID:', content.id);
                    console.log('[TOOL_USE] Input:', JSON.stringify(content.input, null, 2));
                } else if (content?.type === 'tool_result') {
                    console.log('\n[TOOL_RESULT] Tool ID:', content.tool_use_id);
                    console.log('[TOOL_RESULT] Is Error:', content.is_error || false);
                    if (typeof content.content === 'string') {
                        console.log('[TOOL_RESULT] Content:', content.content.slice(0, 500));
                    } else {
                        console.log('[TOOL_RESULT] Content:', JSON.stringify(content.content, null, 2).slice(0, 500));
                    }
                } else {
                    this.log('Unknown content type:', content?.type, JSON.stringify(content, null, 2).slice(0, 500));
                }
            } else if (sessionUpdate === 'tool_use') {
                console.log('\n[TOOL_USE EVENT]');
                console.log('  Tool:', update.tool?.name || update.name);
                console.log('  Input:', JSON.stringify(update.tool?.input || update.input, null, 2));
            } else if (sessionUpdate === 'tool_result') {
                console.log('\n[TOOL_RESULT EVENT]');
                console.log('  Is Error:', update.isError || update.is_error || false);
                const resultContent = update.result || update.content;
                if (typeof resultContent === 'string') {
                    console.log('  Result:', resultContent.slice(0, 500));
                } else {
                    console.log('  Result:', JSON.stringify(resultContent, null, 2).slice(0, 500));
                }
            } else if (sessionUpdate === 'agent_tool_use') {
                console.log('\n[AGENT_TOOL_USE]');
                console.log('  Tool:', update.toolName || update.tool_name);
                console.log('  Input:', JSON.stringify(update.input, null, 2));
            } else if (sessionUpdate === 'agent_tool_result') {
                console.log('\n[AGENT_TOOL_RESULT]');
                console.log('  Is Error:', update.isError || update.is_error || false);
                const resultContent = update.result || update.content || update.output;
                if (typeof resultContent === 'string') {
                    console.log('  Result:', resultContent.slice(0, 500));
                } else {
                    console.log('  Result:', JSON.stringify(resultContent, null, 2).slice(0, 500));
                }
            } else {
                this.log('Unhandled session update:', sessionUpdate, JSON.stringify(update, null, 2).slice(0, 1000));
            }
        }
    }

    async sendRequest(method, params) {
        return new Promise((resolve, reject) => {
            const id = this.nextMessageId++;
            const request = {
                jsonrpc: '2.0',
                id,
                method,
                params
            };

            this.log('>>> SEND:', JSON.stringify(request, null, 2));
            this.pendingRequests.set(id, { resolve, reject });
            this.process.stdin.write(JSON.stringify(request) + '\n');
        });
    }

    async createSession() {
        console.log('[ACP] Creating session...');
        const result = await this.sendRequest('session/new', {
            cwd: this.cwd,
            mcpServers: []
        });
        this.sessionId = result.sessionId;
        console.log('[ACP] Session created:', this.sessionId);

        // Set permission mode to bypass all permission checks (same as opencursor)
        console.log('[ACP] Setting permission mode to bypassPermissions...');
        await this.sendRequest('session/set_mode', {
            sessionId: this.sessionId,
            modeId: 'bypassPermissions'
        });
        console.log('[ACP] Permission mode set');

        return this.sessionId;
    }

    async sendPrompt(prompt) {
        console.log('[ACP] Sending prompt...');
        console.log('---');

        const result = await this.sendRequest('session/prompt', {
            sessionId: this.sessionId,
            prompt: [{
                type: 'text',
                text: prompt
            }]
        });

        console.log('\n---');
        console.log('[ACP] Prompt complete. Stop reason:', result.stopReason);
        this.log('Full result:', JSON.stringify(result, null, 2));
        return result;
    }

    async close() {
        if (this.process) {
            this.process.kill();
        }
    }
}

async function main() {
    const { prompt, cwd, version, debug } = parseArgs();

    if (!prompt) {
        console.error('Usage: node scripts/run-acp-prompt.js "Your prompt here"');
        console.error('       node scripts/run-acp-prompt.js --prompt "Your prompt" --cwd /path/to/project');
        console.error('       node scripts/run-acp-prompt.js --prompt "Your prompt" --version 0.12.0');
        console.error('       node scripts/run-acp-prompt.js --prompt "Your prompt" --debug');
        console.error('');
        console.error('Available versions: 0.10.x, 0.11.0, 0.12.x, 0.13.x (latest)');
        process.exit(1);
    }

    console.log('[ACP] Prompt:', prompt);
    if (version) {
        console.log('[ACP] Using version:', version);
    }
    if (debug) {
        console.log('[ACP] Debug mode enabled');
    }

    const client = new ACPClient(cwd, version, debug);

    try {
        await client.start();
        await client.createSession();
        await client.sendPrompt(prompt);
    } catch (err) {
        console.error('[ACP] Error:', err.message);
        process.exit(1);
    } finally {
        client.close();
    }
}

main();
