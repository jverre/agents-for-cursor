# Agent Client Protocol (ACP) Integration in Cursor

## What is ACP?

The **Agent Client Protocol (ACP)** is a standardized protocol for communication between code editors/IDEs and AI coding agents. It was designed to solve integration overhead and enable broader compatibility.

**Website:** https://agentclientprotocol.com

## ACP vs Cursor's Current System

### Current Cursor Architecture (Proprietary)
- **Proprietary protocol** based on gRPC/protobuf
- **Server-side tool execution** - AI backend decides what tools to call
- **Client streams results** back to backend
- **Tightly coupled** to Cursor's infrastructure

### ACP Architecture (Open Standard)
- **Open protocol** based on JSON-RPC
- **Client-side agent execution** - Agent runs locally
- **Bidirectional communication** over stdin/stdout
- **Pluggable** - Works with any editor implementing ACP

## ACP Core Concepts

### 1. **Architecture**

```
┌─────────────────┐         stdin/stdout         ┌──────────────────┐
│   Code Editor   │◄─────── JSON-RPC ──────────►│   Agent Process  │
│   (Client)      │                              │   (Subprocess)   │
└─────────────────┘                              └──────────────────┘
        │                                                  │
        │  Provides:                                       │  Provides:
        │  - File system access                            │  - AI model access
        │  - Terminal access                               │  - Tool execution logic
        │  - UI updates                                    │  - Planning/reasoning
        └──────────────────────────────────────────────────┘
```

### 2. **Communication Flow**

1. **Initialization**
   - Client calls `initialize` with capabilities
   - Agent responds with its capabilities
   - Protocol version negotiated

2. **Session Setup**
   - Client creates session with `session/create`
   - Agent maintains session state

3. **Prompt Turn**
   - Client sends `session/prompt` with user message
   - Agent processes and sends `session/update` notifications
   - Tool calls, text chunks, planning updates
   - Turn ends with `StopReason`

### 3. **Key Capabilities**

**Client Capabilities:**
- `readTextFile` - Read file contents
- `writeTextFile` - Create/update files
- `terminal` - Execute shell commands
- `sessionModes` - Support different interaction modes

**Agent Capabilities:**
- `tools` - Which tools the agent can use
- `contentTypes` - Supported content formats
- `sessionUpdates` - Real-time progress updates

## ACP Protocol Methods

### Initialization

```json
// Request
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": 1,
    "clientInfo": {
      "name": "cursor",
      "version": "0.43.0"
    },
    "clientCapabilities": {
      "readTextFile": true,
      "writeTextFile": true,
      "terminal": true
    }
  }
}

// Response
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "protocolVersion": 1,
    "agentInfo": {
      "name": "claude-code",
      "version": "1.0.0"
    },
    "agentCapabilities": {
      "tools": ["read", "edit", "shell"],
      "sessionModes": ["chat", "agent"]
    }
  }
}
```

### File System Operations

```json
// Read file
{
  "method": "fs/read_text_file",
  "params": {
    "sessionId": "sess_123",
    "path": "/path/to/file.ts",
    "line": 10,      // Optional: start line
    "limit": 50      // Optional: max lines
  }
}

// Write file
{
  "method": "fs/write_text_file",
  "params": {
    "sessionId": "sess_123",
    "path": "/path/to/file.ts",
    "content": "new file contents"
  }
}
```

### Terminal Operations

```json
// Create terminal
{
  "method": "terminal/create",
  "params": {
    "sessionId": "sess_123",
    "command": "npm",
    "args": ["test"],
    "cwd": "/path/to/project",
    "env": { "NODE_ENV": "test" },
    "outputByteLimit": 10000
  }
}
```

### Prompt Turn

```json
// Client sends prompt
{
  "method": "session/prompt",
  "params": {
    "sessionId": "sess_123",
    "message": {
      "type": "text",
      "text": "Fix the authentication bug"
    }
  }
}

// Agent sends update (notification)
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_123",
    "update": {
      "type": "text",
      "text": "I'll analyze the authentication code..."
    }
  }
}

// Agent reports tool call
{
  "method": "session/update",
  "params": {
    "sessionId": "sess_123",
    "update": {
      "type": "tool_call",
      "toolCallId": "call_001",
      "title": "Reading auth.ts",
      "kind": "read",
      "status": "in_progress"
    }
  }
}
```

## Cursor's ACP Integration

### Location

**Extension:** `cursor-agent-exec`
**Path:** `/extensions/cursor-agent-exec/dist/main.js`

### Implementation Details

From the decompiled code, Cursor has infrastructure for ACP:

```javascript
// Agent execution provider
const agentExecProvider = {
    // Create agent session
    createSession(sessionId, approvalHandler, elicitationHandler,
                  options, permissionsFetcher, onDidChangePermissions) {

        const sessionUUID = crypto.randomUUID();

        // Set up resource providers (file system, terminal, etc.)
        const resourceProvider = new LocalResourceProvider({
            fileChangeTracker: fileTracker,
            ignoreService: ignoreService,
            grepProvider: grepProvider,
            permissionsService: permissionsService,
            workspacePath: workspacePaths,
            terminalExecutor: terminalExecutor,
            // ... more providers
        });

        // Create hooks executor
        const hooksExecutor = new VscodeHooksExecutor(
            cursor.getHookExecutor(),
            hooksConfigTracker
        );

        // Wrap with hooks for ACP compatibility
        const hooksResourceAccessor = new ListableHooksResourceAccessor(
            resourceProvider,
            hooksExecutor,
            metadata => ({
                conversation_id: metadata?.conversationId ?? "",
                generation_id: metadata?.requestId ?? "",
                model: metadata?.modelName ?? ""
            })
        );

        // Create ACP-compatible manager
        const manager = SimpleControlledExecManager.fromResources(
            hooksResourceAccessor
        );

        return {
            createStream: (metadata, request, abortSignal) => {
                // Handle ACP messages
                const message = ExecServerMessage.fromBinary(request);

                // Process with context and streaming
                const stream = manager.handle(context, message);

                // Stream responses back
                for await (const response of stream) {
                    yield response.toBinary();
                }
            },
            dispose: () => {
                // Cleanup
            }
        };
    }
};

// Register with Cursor
cursor.registerAgentExecProvider(agentExecProvider);
```

### Resource Providers

**Cursor implements ACP resources through:**

1. **File System**
   ```javascript
   LocalResourceProvider provides:
   - readTextFile()
   - writeTextFile()
   - With .cursorignore support
   - Permission checks
   ```

2. **Terminal**
   ```javascript
   TerminalExecutor provides:
   - createTerminal()
   - executeCommand()
   - Background shell support
   ```

3. **Context**
   ```javascript
   RequestContextExecutor provides:
   - Cursor rules (.cursorrules)
   - Codebase context
   - Git repository info
   ```

4. **MCP Integration**
   ```javascript
   VscodeMcpLease provides:
   - MCP server connections
   - Tool proxying
   ```

## Claude Code Extension

Cursor tracks a specific ACP-compatible extension:

```javascript
// From workbench.beautified.js:926266
static CLAUDE_EXTENSION_ID = "Anthropic.claude-code"

// Analytics tracking
handleCommandExecution(commandId) {
    if (extensionId === this.CLAUDE_EXTENSION_ID) {
        this.analyticsService.trackEvent(
            "extension.ai_assistant.command_executed",
            { command: commandId }
        );
    }
}
```

**This suggests Cursor is prepared to integrate with Anthropic's Claude Code extension using ACP.**

## Comparison: Cursor Protocol vs ACP

### Message Format

**Cursor (Proprietary):**
```javascript
{
    conversation: [...],
    supportedTools: [
        ClientSideToolV2.READ_FILE,
        ClientSideToolV2.EDIT_FILE
    ],
    model: "claude-sonnet-4.5",
    unified_mode: CHAT
}
```

**ACP (Standard):**
```json
{
    "method": "session/prompt",
    "params": {
        "sessionId": "sess_123",
        "message": {
            "type": "text",
            "text": "..."
        }
    }
}
```

### Tool Execution

**Cursor:**
- AI backend decides tools
- Client executes and returns results
- Proprietary tool enum

**ACP:**
- Agent (local) decides tools
- Client provides capabilities
- Standard method names

### Session Management

**Cursor:**
- Server-managed sessions
- Tied to composer/conversation ID

**ACP:**
- Client-managed sessions
- Session ID provided by client
- Multiple concurrent sessions

## Benefits of ACP

### For Users:
1. ✅ **Vendor Independence** - Not locked into Cursor's backend
2. ✅ **Privacy** - Agent runs locally, not on cloud
3. ✅ **Customization** - Can run custom agents
4. ✅ **Offline Capable** - With local models

### For Developers:
1. ✅ **Standard Protocol** - One integration works everywhere
2. ✅ **Open Source** - Community-driven development
3. ✅ **Extensible** - Easy to add capabilities
4. ✅ **Well Documented** - Clear specifications

## Future: Hybrid Approach?

Cursor appears to be building support for **both**:

1. **Proprietary Protocol** (Current)
   - Optimized for Cursor's infrastructure
   - Tight integration with backend AI
   - Enterprise features

2. **ACP Support** (Emerging)
   - Third-party agent support
   - Claude Code extension ready
   - Local agent execution
   - Open ecosystem

## How to Use ACP in Cursor (Future)

**Once fully implemented:**

```javascript
// 1. Install ACP-compatible agent
// e.g., Anthropic's Claude Code

// 2. Agent starts as subprocess
const agent = spawn('claude-code-agent', ['--stdio']);

// 3. Initialize connection
await agent.send({
    method: 'initialize',
    params: {
        protocolVersion: 1,
        clientCapabilities: {
            readTextFile: true,
            writeTextFile: true,
            terminal: true
        }
    }
});

// 4. Create session
await agent.send({
    method: 'session/create',
    params: {
        sessionId: 'my-session',
        mode: 'agent'
    }
});

// 5. Send prompts
await agent.send({
    method: 'session/prompt',
    params: {
        sessionId: 'my-session',
        message: {
            type: 'text',
            text: 'Fix this bug'
        }
    }
});

// 6. Receive updates
agent.on('session/update', (update) => {
    // Handle tool calls, text, etc.
});
```

## Resources

- **ACP Documentation:** https://agentclientprotocol.com
- **ACP GitHub:** https://github.com/agentclientprotocol/acp
- **Cursor Extension:** `cursor-agent-exec`
- **Claude Code:** `Anthropic.claude-code`

## Summary

Cursor has built ACP infrastructure into the `cursor-agent-exec` extension, preparing for:
- ✅ Third-party agent support
- ✅ Local agent execution
- ✅ Standard protocol compliance
- ✅ Claude Code integration

This positions Cursor to support both:
1. Their optimized proprietary protocol
2. The open ACP standard for third-party agents

The future is **hybrid**: proprietary for performance, ACP for ecosystem.
