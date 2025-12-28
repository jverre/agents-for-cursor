# `cursor-agent-exec`: What It Actually Does

## Quick Answer

**NO**, `cursor-agent-exec` is **NOT** just for CLI!

It's the infrastructure that **provides execution capabilities for AI agents** - whether they're:
- ✅ Cursor's built-in agent (in Composer)
- ✅ Future ACP-based agents (like Claude Code)
- ✅ Any agent that needs to execute tools locally

## What It Provides

From the package.json description:

> "Provides agent execution capabilities for Cursor, enabling agents to run commands, interact with files, and use tools with user permissions and approvals"

### Two Main Functions:

#### 1. `spawn(command, options)`
**Purpose:** Run standalone commands/scripts
```javascript
async spawn(command, options) {
    // Executes a command and returns stdout/stderr
    // Used for: Quick script execution, one-off commands
    return { stdout, stderr, code };
}
```

**Example Use:**
```javascript
// Run a build script
await agentExec.spawn('npm run build', { cwd: '/project' });

// Run tests
await agentExec.spawn('pytest tests/', { cwd: '/project' });
```

#### 2. `createSession(sessionId, handlers, options)`
**Purpose:** Create a **long-running agent session** with full tool access

```javascript
createSession(sessionId, approvalHandler, elicitationHandler, options) {
    // Creates a session with:
    // - File system access (read, write, edit)
    // - Terminal execution (interactive)
    // - Tool execution with permissions
    // - Context management
    // - MCP integration

    return {
        createStream: (metadata, request, abortSignal) => {
            // Handle agent messages (ACP-style protocol)
            // Binary message format
        },
        dispose: () => {
            // Clean up session
        }
    };
}
```

**This is the ACP infrastructure!**

## How It Works

### Architecture:

```
┌─────────────────────────────────────────┐
│   Cursor Composer / Agent UI            │
│   (or future ACP agent subprocess)      │
└──────────────┬──────────────────────────┘
               │ Uses cursor.registerAgentExecProvider
               ▼
┌─────────────────────────────────────────┐
│   cursor-agent-exec Extension           │
│   ────────────────────────────────      │
│   Provides:                             │
│   • File operations (LocalResourceProv) │
│   • Terminal execution                  │
│   • Permission handling                 │
│   • Tool execution manager              │
│   • Context management                  │
│   • MCP integration                     │
└──────────────┬──────────────────────────┘
               │
               ▼
┌─────────────────────────────────────────┐
│   Your Workspace                         │
│   • Files                                │
│   • Terminal                             │
│   • Git                                  │
└─────────────────────────────────────────┘
```

### Key Components:

**1. LocalResourceProvider**
```javascript
{
    pendingDecisionStore,     // User approvals
    fileChangeTracker,        // Track file edits
    ignoreService,            // .cursorignore
    grepProvider,             // Search
    permissionsService,       // User permissions
    workspacePath,            // Project paths
    diagnosticsProvider,      // Lints/errors
    mcpLease,                 // MCP servers
    cursorRulesService,       // .cursorrules
    subagentsService,         // Sub-agents
    terminalExecutor,         // Shell execution
    // ... more
}
```

**2. Permission System**
```javascript
class InteractivePermissionsService {
    async requestApproval(toolCall) {
        // Show user approval dialog
        // "Allow agent to read file.ts?"
        return { approved: true/false };
    }
}
```

**3. Tool Execution**
```javascript
const manager = SimpleControlledExecManager.fromResources(resources);

// Handle agent requests (ACP-style binary protocol)
for await (const response of manager.handle(context, request)) {
    yield response.toBinary();
}
```

## Who Uses It?

### Currently:

**Cursor's Built-in Agent (Composer)**
```javascript
// When you use Composer Agent mode:
const session = agentExecProvider.createSession(
    sessionId,
    approvalHandler,     // Show "Allow?" dialogs
    elicitationHandler,  // Ask user for input
    {
        workspacePaths: ['/your/project'],
        // ...
    }
);

// Agent can now:
// - Read files
// - Edit files
// - Run terminal commands
// - Use MCP tools
// - All with user permission!
```

### Future (ACP Support):

**Third-Party ACP Agents (like Claude Code)**
```javascript
// When ACP is enabled:
// 1. Start Claude Code agent subprocess
const agent = spawn('claude-code-agent', ['--stdio']);

// 2. Agent communicates via ACP protocol
// 3. Uses cursor-agent-exec for local execution
const session = agentExecProvider.createSession(...);

// 4. Agent requests tools via binary protocol:
const request = ExecServerMessage.encode({
    type: 'read_file',
    path: '/src/main.ts'
});

// 5. cursor-agent-exec executes and returns result
const response = await session.createStream(metadata, request);
```

## Is It For CLI?

**NO!** It's not about command-line interface vs GUI.

It's about **agent execution**:
- ✅ Cursor's GUI agent uses it
- ✅ Future ACP CLI agents will use it
- ✅ Any agent (GUI or CLI) uses it

The name `cursor-agent-exec` means:
- "cursor" - Cursor IDE
- "agent" - AI agents (any kind)
- "exec" - **execution** (of tools, commands, file operations)

## Comparison: MCP vs Agent-Exec

**MCP (cursor-mcp extension):**
- External servers provide tools TO the agent
- Agent calls MCP server's tools
- Server-side execution

**Agent-Exec (cursor-agent-exec extension):**
- Provides execution infrastructure FOR the agent
- Agent executes tools locally
- Client-side execution

**They work together:**
```
Agent uses Agent-Exec to execute:
  ├─ File operations (built-in)
  ├─ Terminal commands (built-in)
  └─ MCP tools (via MCP integration)
```

## Example Session Flow

### 1. Create Session
```javascript
const session = cursor.registerAgentExecProvider({
    spawn: (cmd, opts) => { /* ... */ },
    createSession: (sessionId, handlers, opts) => {
        // Set up:
        // - File system access
        // - Terminal access
        // - Permission handlers
        // - MCP connections

        return { createStream, dispose };
    }
});
```

### 2. Agent Requests Tool
```javascript
// Agent sends binary message:
{
    type: 'read_file',
    path: '/src/app.ts',
    startLine: 1,
    endLine: 100
}
```

### 3. Permission Check
```javascript
// cursor-agent-exec asks user:
"Allow agent to read /src/app.ts?"
[Allow] [Deny] [Always Allow]
```

### 4. Execute & Return
```javascript
// If approved:
const content = await fs.readFile('/src/app.ts');

// Return to agent:
{
    success: true,
    content: "import React from 'react';\n..."
}
```

## Key Takeaways

1. **Not CLI-specific** - Works with any agent (GUI or CLI-based)

2. **Execution Infrastructure** - Provides tools/resources TO agents

3. **Dual Purpose:**
   - **Now:** Powers Cursor's built-in agent
   - **Future:** Will support ACP agents (like Claude Code)

4. **Security Layer** - All execution goes through permission system

5. **ACP-Ready** - Binary message protocol, session management

## Why "Agent-Exec"?

The name makes sense when you understand:
- **Agent** = AI agents that need to execute tools
- **Exec** = Execute tools locally with permissions
- **Not** = "CLI executable" but "agent execution provider"

It's the **execution layer** that any agent uses to interact with your workspace safely.
