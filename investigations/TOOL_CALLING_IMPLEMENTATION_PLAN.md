# Tool Calling Implementation Plan

## Current State

**What Works:**
- `submitChatMaybeAbortCurrent` patch intercepts chat messages
- Messages routed to `window.acpService.handleRequest()` for `acp:*` models
- Mock responses returned to UI with bubbles

**What's Missing:**
- ACP subprocess spawning (currently just mock)
- Bidirectional communication with ACP agent
- Tool execution when agent requests tools
- Streaming responses back to UI

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cursor UI (Composer)                         │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ submitChatMaybeAbortCurrent
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ACP Service (window.acpService)                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  handleRequest(model, messages)                              │    │
│  │    1. Get/spawn ACP subprocess                               │    │
│  │    2. Send session/prompt via JSON-RPC                       │    │
│  │    3. Handle tool_call requests from agent                   │    │
│  │    4. Stream text updates back to UI                         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ stdin/stdout (JSON-RPC)
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     ACP Agent Subprocess                             │
│                     (e.g., claude-code-acp)                          │
│  - Receives prompts                                                  │
│  - Calls AI model                                                    │
│  - Requests tools via session/update notifications                   │
│  - Sends text responses                                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ Tool requests
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Tool Executor                                    │
│  Option A: Use cursor-agent-exec (recommended)                       │
│  Option B: Implement directly in extension                           │
└─────────────────────────────────────────────────────────────────────┘
```

## Implementation Phases

### Phase 1: ACP Subprocess Management

**Goal:** Spawn and manage ACP agent subprocess

**Files to modify:**
- `cursor-acp-extension/patches/acp-service.js` - Add subprocess spawning
- `cursor-acp-extension/extension.js` - Handle subprocess lifecycle in extension context

**Implementation:**

```javascript
// In extension.js (Node.js context - can spawn processes)
class ACPProcessManager {
    constructor() {
        this.processes = new Map(); // providerId -> ChildProcess
        this.sessions = new Map();  // sessionId -> { process, callbacks }
    }

    async spawnAgent(provider) {
        if (this.processes.has(provider.id)) {
            return this.processes.get(provider.id);
        }

        const proc = spawn(provider.command, provider.args || [], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, ...provider.env }
        });

        // Handle JSON-RPC messages from agent
        const rl = readline.createInterface({ input: proc.stdout });
        rl.on('line', (line) => this.handleAgentMessage(provider.id, line));

        proc.stderr.on('data', (data) => {
            console.error(`[ACP ${provider.id}] stderr:`, data.toString());
        });

        this.processes.set(provider.id, proc);

        // Initialize ACP connection
        await this.sendToAgent(provider.id, {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
                protocolVersion: 1,
                clientInfo: { name: 'cursor', version: '0.44.0' },
                clientCapabilities: {
                    tools: { call: true },
                    sampling: {}
                }
            }
        });

        return proc;
    }

    async sendToAgent(providerId, message) {
        const proc = this.processes.get(providerId);
        if (!proc) throw new Error(`No process for ${providerId}`);
        proc.stdin.write(JSON.stringify(message) + '\n');
    }

    handleAgentMessage(providerId, line) {
        const msg = JSON.parse(line);
        // Route to appropriate handler
        if (msg.method === 'session/update') {
            this.handleSessionUpdate(providerId, msg.params);
        } else if (msg.method === 'tools/call') {
            this.handleToolCall(providerId, msg);
        } else if (msg.id) {
            // Response to our request
            this.handleResponse(providerId, msg);
        }
    }
}
```

**Bridge to browser context:**

```javascript
// extension.js - Create message channel to browser
const panel = vscode.window.createWebviewPanel(...);

// Or use postMessage through existing bridge
vscode.commands.registerCommand('acp.sendMessage', async (provider, messages) => {
    const manager = getProcessManager();
    return await manager.sendPrompt(provider, messages);
});
```

### Phase 2: JSON-RPC Communication Protocol

**Goal:** Implement proper ACP protocol communication

**ACP Message Flow:**

```
Client                              Agent
  │                                   │
  │──── initialize ──────────────────►│
  │◄─── initialize result ────────────│
  │                                   │
  │──── session/create ──────────────►│
  │◄─── session/create result ────────│
  │                                   │
  │──── session/prompt ──────────────►│
  │◄─── session/update (text) ────────│  (notification)
  │◄─── session/update (tool_call) ───│  (notification)
  │──── tools/call result ───────────►│  (we execute tool, send result)
  │◄─── session/update (text) ────────│
  │◄─── session/prompt result ────────│  (turn complete)
```

**Implementation:**

```javascript
// acp-protocol.js
class ACPSession {
    constructor(sessionId, process, callbacks) {
        this.sessionId = sessionId;
        this.process = process;
        this.callbacks = callbacks;
        this.pendingRequests = new Map();
        this.requestId = 0;
    }

    async sendPrompt(message) {
        const id = ++this.requestId;

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(id, { resolve, reject });

            this.send({
                jsonrpc: '2.0',
                id,
                method: 'session/prompt',
                params: {
                    sessionId: this.sessionId,
                    message: { type: 'text', text: message }
                }
            });
        });
    }

    handleNotification(method, params) {
        if (method === 'session/update') {
            const update = params.update;

            switch (update.type) {
                case 'text':
                    this.callbacks.onText(update.text);
                    break;

                case 'tool_call':
                    this.handleToolCall(update);
                    break;

                case 'tool_result':
                    // Agent reporting tool completed
                    break;
            }
        }
    }

    async handleToolCall(toolCall) {
        const { toolCallId, name, input } = toolCall;

        try {
            // Execute tool
            const result = await this.callbacks.executeTool(name, input);

            // Send result back to agent
            this.send({
                jsonrpc: '2.0',
                method: 'tools/call/result',
                params: {
                    sessionId: this.sessionId,
                    toolCallId,
                    result
                }
            });
        } catch (error) {
            this.send({
                jsonrpc: '2.0',
                method: 'tools/call/result',
                params: {
                    sessionId: this.sessionId,
                    toolCallId,
                    error: { message: error.message }
                }
            });
        }
    }
}
```

### Phase 3: Tool Execution

**Goal:** Execute tools requested by ACP agent

**Option A: Use cursor-agent-exec (Recommended)**

Leverage Cursor's existing infrastructure:

```javascript
// In extension.js
async function executeTool(toolName, toolInput) {
    // Get cursor-agent-exec API
    const agentExec = vscode.extensions.getExtension('cursor.cursor-agent-exec');

    if (!agentExec) {
        throw new Error('cursor-agent-exec not available');
    }

    const api = agentExec.exports;

    switch (toolName) {
        case 'read_file':
            return await api.readFile(toolInput.path, toolInput.options);

        case 'write_file':
            return await api.writeFile(toolInput.path, toolInput.content);

        case 'edit_file':
            return await api.editFile(toolInput.path, toolInput.edits);

        case 'run_terminal':
            return await api.runCommand(toolInput.command, toolInput.options);

        case 'search':
            return await api.search(toolInput.query, toolInput.options);

        default:
            throw new Error(`Unknown tool: ${toolName}`);
    }
}
```

**Option B: Implement Tools Directly**

If cursor-agent-exec API not accessible:

```javascript
// tools/file-tools.js
const vscode = require('vscode');
const fs = require('fs').promises;
const path = require('path');

async function readFile(filePath, options = {}) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath);

    const content = await fs.readFile(fullPath, 'utf8');

    if (options.startLine || options.endLine) {
        const lines = content.split('\n');
        const start = (options.startLine || 1) - 1;
        const end = options.endLine || lines.length;
        return lines.slice(start, end).join('\n');
    }

    return content;
}

async function writeFile(filePath, content) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    const fullPath = path.isAbsolute(filePath)
        ? filePath
        : path.join(workspaceRoot, filePath);

    await fs.writeFile(fullPath, content, 'utf8');
    return { success: true, path: fullPath };
}

async function runTerminal(command, options = {}) {
    return new Promise((resolve, reject) => {
        const { exec } = require('child_process');
        const cwd = options.cwd || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        exec(command, { cwd, timeout: options.timeout || 30000 }, (error, stdout, stderr) => {
            if (error && !options.allowNonZero) {
                reject({ error: error.message, stderr });
            } else {
                resolve({ stdout, stderr, code: error?.code || 0 });
            }
        });
    });
}
```

**Tool Registry:**

```javascript
// tools/registry.js
const tools = {
    // File operations
    read_file: {
        description: 'Read contents of a file',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'File path' },
                startLine: { type: 'number', description: 'Start line (1-indexed)' },
                endLine: { type: 'number', description: 'End line (1-indexed)' }
            },
            required: ['path']
        },
        handler: readFile
    },

    write_file: {
        description: 'Write content to a file',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                content: { type: 'string' }
            },
            required: ['path', 'content']
        },
        handler: writeFile
    },

    edit_file: {
        description: 'Make targeted edits to a file',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string' },
                old_string: { type: 'string' },
                new_string: { type: 'string' }
            },
            required: ['path', 'old_string', 'new_string']
        },
        handler: editFile
    },

    run_terminal: {
        description: 'Run a shell command',
        inputSchema: {
            type: 'object',
            properties: {
                command: { type: 'string' },
                cwd: { type: 'string' },
                timeout: { type: 'number' }
            },
            required: ['command']
        },
        handler: runTerminal
    },

    search_files: {
        description: 'Search for files by pattern',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string' },
                path: { type: 'string' }
            },
            required: ['pattern']
        },
        handler: searchFiles
    },

    search_content: {
        description: 'Search file contents with regex',
        inputSchema: {
            type: 'object',
            properties: {
                pattern: { type: 'string' },
                path: { type: 'string' },
                filePattern: { type: 'string' }
            },
            required: ['pattern']
        },
        handler: searchContent
    }
};

async function executeTool(name, input) {
    const tool = tools[name];
    if (!tool) {
        throw new Error(`Unknown tool: ${name}`);
    }
    return await tool.handler(input);
}
```

### Phase 4: Streaming Updates to UI

**Goal:** Stream text and tool status updates to Composer UI

**Approach:** Update bubbles incrementally as agent sends updates

```javascript
// In patcher.js - Enhanced submitChatMaybeAbortCurrent patch

// Instead of awaiting full response:
const acpResponse = await window.acpService.handleRequest(modelName, acpMessages);

// Use streaming callback:
await window.acpService.handleRequestStreaming(modelName, acpMessages, {
    onTextDelta: (text) => {
        // Append text to AI bubble
        this._composerDataService.updateBubbleText(aiBubbleId, (prev) => prev + text);
    },

    onToolCall: (toolCall) => {
        // Add tool call indicator to UI
        this._composerDataService.addToolCallBubble(composerHandle, {
            bubbleId: ss(),
            type: 'tool_call',
            toolName: toolCall.name,
            status: 'running',
            toolCallId: toolCall.id
        });
    },

    onToolResult: (toolCallId, result) => {
        // Update tool call status
        this._composerDataService.updateToolCallStatus(toolCallId, 'completed', result);
    },

    onComplete: (finalResponse) => {
        // Set status to completed
        this._composerDataService.updateComposerDataSetStore(e, o => {
            o("status", "completed");
            o("generatingBubbleIds", []);
        });
    },

    onError: (error) => {
        this._composerDataService.updateComposerDataSetStore(e, o => {
            o("status", "error");
            o("errorMessage", error.message);
        });
    }
});
```

### Phase 5: Permission System

**Goal:** Handle tool approval (respect Cursor's permission settings)

```javascript
// permission-handler.js
class PermissionHandler {
    constructor(context) {
        this.context = context;
        this.autoApproved = new Set(); // Tools user has "always allowed"
    }

    async requestApproval(toolName, toolInput) {
        // Check if auto-approved
        if (this.autoApproved.has(toolName)) {
            return { approved: true };
        }

        // Check yolo mode (from Cursor settings)
        const yoloMode = vscode.workspace.getConfiguration('cursor').get('yoloMode');
        if (yoloMode) {
            return { approved: true };
        }

        // Show approval dialog
        const choice = await vscode.window.showWarningMessage(
            `ACP agent wants to ${toolName}: ${JSON.stringify(toolInput).substring(0, 100)}`,
            { modal: true },
            'Allow',
            'Always Allow',
            'Deny'
        );

        if (choice === 'Always Allow') {
            this.autoApproved.add(toolName);
            return { approved: true };
        }

        return { approved: choice === 'Allow' };
    }
}
```

## File Structure

```
cursor-acp-extension/
├── extension.js              # Main extension (process spawning)
├── patcher.js                # Workbench patches
├── checksum-fixer.js         # Fix checksums
├── acp/
│   ├── process-manager.js    # Subprocess lifecycle
│   ├── protocol.js           # JSON-RPC implementation
│   └── session.js            # Session management
├── tools/
│   ├── registry.js           # Tool definitions
│   ├── file-tools.js         # File operations
│   ├── terminal-tools.js     # Terminal execution
│   └── search-tools.js       # Search operations
├── permissions/
│   └── handler.js            # Approval dialogs
└── patches/
    ├── acp-service.js        # Browser-side service
    ├── chat-patch.js         # (deprecated - using patcher.js)
    └── extension-bridge.js   # Browser <-> Extension communication
```

## Implementation Order

1. **Phase 1** - Subprocess management (extension.js)
   - [ ] ACPProcessManager class
   - [ ] Spawn/kill subprocess
   - [ ] stdio communication

2. **Phase 2** - JSON-RPC protocol
   - [ ] Message framing (line-delimited JSON)
   - [ ] Request/response matching
   - [ ] Notification handling
   - [ ] Session lifecycle

3. **Phase 3** - Tool execution
   - [ ] Tool registry
   - [ ] File operations (read, write, edit)
   - [ ] Terminal execution
   - [ ] Search (files, content)

4. **Phase 4** - UI streaming
   - [ ] Update patcher.js for streaming
   - [ ] Incremental bubble updates
   - [ ] Tool call status display

5. **Phase 5** - Permissions
   - [ ] Approval dialogs
   - [ ] "Always allow" memory
   - [ ] Yolo mode respect

## Testing Strategy

### Unit Tests
- JSON-RPC message parsing
- Tool execution (mock filesystem)
- Permission logic

### Integration Tests
1. Spawn echo agent → verify communication
2. Send prompt → receive text response
3. Agent requests tool → tool executes → result returned
4. Multi-turn conversation with tools

### Manual Testing
1. Select ACP model in Composer
2. Send "Read the README.md file"
3. Verify:
   - Agent spawns
   - Tool approval dialog appears
   - File content returned to agent
   - Response appears in UI

## Open Questions

1. **cursor-agent-exec API access**: Can we access its exports from our extension?
   - Need to test `vscode.extensions.getExtension('cursor.cursor-agent-exec')`

2. **Browser <-> Extension bridge**: Best mechanism for communication?
   - WebSocket from extension?
   - postMessage via hidden webview?
   - Command-based RPC?

3. **Streaming to UI**: How to incrementally update bubbles?
   - Need to find the right composer data service methods
   - May need to patch additional functions

4. **Tool schema**: What tools should we expose?
   - Start with: read_file, write_file, edit_file, run_terminal, search
   - Later: list_files, get_diagnostics, etc.

## Phase 6: Plan Mode Support

**Goal:** Support Cursor's planning mode where agent creates a plan before execution

### Cursor's Unified Modes

From the codebase analysis:

```javascript
enum UnifiedMode {
    UNSPECIFIED = 0,
    CHAT = 1,      // Normal chat conversation
    AGENT = 2,     // Agentic mode with tool execution
    EDIT = 3,      // Direct file editing
    CUSTOM = 4,    // Custom mode
    PLAN = 5,      // Planning mode - create plan first
    DEBUG = 6      // Debug mode
}
```

### Plan Mode Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                    User sends message in PLAN mode                   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         ACP Agent                                    │
│  1. Analyze task                                                     │
│  2. Create step-by-step plan                                         │
│  3. Ask clarifying questions (ASK_QUESTION tool)                     │
│  4. Wait for user approval                                           │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ User approves plan
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                         Execute Plan                                 │
│  - SWITCH_MODE to AGENT mode                                         │
│  - Execute each step with tools                                      │
│  - Report progress                                                   │
└─────────────────────────────────────────────────────────────────────┘
```

### Plan Mode Tools

```javascript
// Tools available in plan mode
const PLAN_MODE_TOOLS = {
    CREATE_PLAN: 43,      // Create a structured plan
    ASK_QUESTION: 51,     // Ask user clarifying questions
    SWITCH_MODE: 52,      // Switch to execution mode
    TODO_READ: 34,        // Read existing TODOs
    TODO_WRITE: 35        // Write TODO items
};
```

### Implementation

```javascript
// In ACP session - handle plan mode
class ACPSession {
    constructor(sessionId, options) {
        this.sessionId = sessionId;
        this.mode = options.mode || 'agent';  // 'chat', 'agent', 'plan'
        this.plan = null;
        this.planApproved = false;
    }

    async sendPrompt(message, mode) {
        // Include mode in session/prompt
        this.send({
            jsonrpc: '2.0',
            id: ++this.requestId,
            method: 'session/prompt',
            params: {
                sessionId: this.sessionId,
                message: { type: 'text', text: message },
                mode: mode  // 'chat', 'agent', 'plan'
            }
        });
    }

    handlePlanUpdate(plan) {
        // Agent sent a plan - show to user for approval
        this.plan = plan;
        this.callbacks.onPlanCreated(plan);
    }

    async approvePlan() {
        this.planApproved = true;
        // Send approval to agent
        this.send({
            jsonrpc: '2.0',
            method: 'session/plan_approved',
            params: {
                sessionId: this.sessionId,
                approved: true
            }
        });
    }

    async rejectPlan(feedback) {
        // Send rejection with feedback
        this.send({
            jsonrpc: '2.0',
            method: 'session/plan_approved',
            params: {
                sessionId: this.sessionId,
                approved: false,
                feedback: feedback
            }
        });
    }
}
```

### Plan UI Updates

```javascript
// Callbacks for plan mode
const planModeCallbacks = {
    onPlanCreated: (plan) => {
        // Display plan in UI with approve/reject buttons
        this._composerDataService.addPlanBubble(composerHandle, {
            bubbleId: ss(),
            type: 'plan',
            steps: plan.steps,
            status: 'pending_approval'
        });
    },

    onPlanStepStarted: (stepIndex) => {
        // Highlight current step
        this._composerDataService.updatePlanStep(stepIndex, 'in_progress');
    },

    onPlanStepCompleted: (stepIndex, result) => {
        // Mark step as done
        this._composerDataService.updatePlanStep(stepIndex, 'completed', result);
    }
};
```

## Phase 7: Follow-up Questions (Elicitation)

**Goal:** Allow agent to ask clarifying questions before/during execution

### Elicitation Handler

From cursor-agent-exec architecture:

```javascript
createSession(sessionId, approvalHandler, elicitationHandler, options)
//                                        ^^^^^^^^^^^^^^^^
//                                        This handles follow-up questions
```

### Question Types

```javascript
// Types of questions agent can ask
const QuestionTypes = {
    CLARIFICATION: 'clarification',      // "Did you mean X or Y?"
    CONFIRMATION: 'confirmation',         // "Should I proceed with X?"
    INPUT_REQUIRED: 'input_required',     // "What should the function name be?"
    CHOICE: 'choice',                     // "Which option: A, B, or C?"
    FILE_SELECTION: 'file_selection'      // "Which file should I modify?"
};
```

### ACP Question Protocol

```javascript
// Agent sends question notification
{
    "jsonrpc": "2.0",
    "method": "session/update",
    "params": {
        "sessionId": "sess_123",
        "update": {
            "type": "question",
            "questionId": "q_001",
            "questionType": "choice",
            "text": "Which authentication method should I implement?",
            "options": [
                { "id": "oauth", "label": "OAuth 2.0" },
                { "id": "jwt", "label": "JWT tokens" },
                { "id": "session", "label": "Session-based" }
            ],
            "required": true
        }
    }
}

// Client sends answer
{
    "jsonrpc": "2.0",
    "method": "session/answer",
    "params": {
        "sessionId": "sess_123",
        "questionId": "q_001",
        "answer": {
            "type": "choice",
            "selectedId": "jwt"
        }
    }
}
```

### Implementation

```javascript
// Elicitation handler
class ElicitationHandler {
    constructor(callbacks) {
        this.callbacks = callbacks;
        this.pendingQuestions = new Map();
    }

    async handleQuestion(question) {
        const { questionId, questionType, text, options, required } = question;

        // Store pending question
        this.pendingQuestions.set(questionId, question);

        // Show question in UI
        const answer = await this.callbacks.showQuestion({
            questionId,
            questionType,
            text,
            options,
            required
        });

        // Remove from pending
        this.pendingQuestions.delete(questionId);

        return answer;
    }
}

// UI callback implementations
const elicitationCallbacks = {
    showQuestion: async (question) => {
        switch (question.questionType) {
            case 'clarification':
            case 'confirmation':
                // Show yes/no dialog
                return await vscode.window.showInformationMessage(
                    question.text,
                    { modal: true },
                    'Yes', 'No'
                );

            case 'choice':
                // Show quick pick
                const selected = await vscode.window.showQuickPick(
                    question.options.map(o => ({
                        label: o.label,
                        id: o.id
                    })),
                    { placeHolder: question.text }
                );
                return selected?.id;

            case 'input_required':
                // Show input box
                return await vscode.window.showInputBox({
                    prompt: question.text,
                    ignoreFocusOut: true
                });

            case 'file_selection':
                // Show file picker
                const files = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    title: question.text
                });
                return files?.[0]?.fsPath;
        }
    }
};
```

### Question Display in Composer

```javascript
// Patch for displaying questions in chat UI
onQuestion: (question) => {
    // Add question bubble to conversation
    this._composerDataService.appendComposerBubbles(composerHandle, [{
        bubbleId: ss(),
        type: 'question',
        questionId: question.questionId,
        text: question.text,
        questionType: question.questionType,
        options: question.options,
        status: 'awaiting_answer'
    }]);

    // Focus input for answer
    this._composerViewsService.focus(composerId, true);
},

onQuestionAnswered: (questionId, answer) => {
    // Update question bubble with answer
    this._composerDataService.updateQuestionBubble(questionId, {
        status: 'answered',
        answer: answer
    });
}
```

### Integration with ACP Session

```javascript
class ACPSession {
    async handleNotification(method, params) {
        switch (method) {
            case 'session/update':
                const update = params.update;

                if (update.type === 'question') {
                    // Agent is asking a question
                    const answer = await this.elicitationHandler.handleQuestion(update);

                    // Send answer back to agent
                    this.send({
                        jsonrpc: '2.0',
                        method: 'session/answer',
                        params: {
                            sessionId: this.sessionId,
                            questionId: update.questionId,
                            answer: answer
                        }
                    });
                }
                break;
        }
    }
}
```

## Updated Implementation Order

1. **Phase 1** - Subprocess management
2. **Phase 2** - JSON-RPC protocol
3. **Phase 3** - Tool execution
4. **Phase 4** - UI streaming
5. **Phase 5** - Permissions
6. **Phase 6** - Plan mode support
   - [ ] Detect unified_mode from request
   - [ ] Handle CREATE_PLAN tool
   - [ ] Plan approval UI
   - [ ] SWITCH_MODE handling
7. **Phase 7** - Follow-up questions
   - [ ] ElicitationHandler class
   - [ ] Question types support
   - [ ] Question UI in Composer
   - [ ] Answer routing back to agent

## Session Modes in ACP

When creating an ACP session, specify supported modes:

```javascript
// Initialize with session modes
{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "initialize",
    "params": {
        "protocolVersion": 1,
        "clientCapabilities": {
            "sessionModes": ["chat", "agent", "plan"],  // Supported modes
            "tools": { "call": true },
            "elicitation": true,  // Supports follow-up questions
            "planApproval": true  // Supports plan review
        }
    }
}

// Agent responds with its capabilities
{
    "jsonrpc": "2.0",
    "id": 1,
    "result": {
        "protocolVersion": 1,
        "agentCapabilities": {
            "sessionModes": ["chat", "agent"],  // Agent supports these modes
            "tools": ["read_file", "edit_file", "run_terminal"],
            "supportsPlanning": true,
            "supportsElicitation": true
        }
    }
}
```

## References

- ACP Protocol: https://agentclientprotocol.com
- cursor-agent-exec: `investigations/CURSOR_AGENT_EXEC_EXPLAINED.md`
- Message flow: `investigations/CHAT_MESSAGE_FLOW.md`
- Tools system: `investigations/TOOLS_SYSTEM.md`
- Current patches: `cursor-acp-extension/patcher.js`
