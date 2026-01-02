# Agent Client Protocol (ACP) Documentation

This document describes the Agent Client Protocol and how it maps to Cursor's chat architecture.

## Table of Contents

1. [What is ACP?](#what-is-acp)
2. [Protocol Overview](#protocol-overview)
3. [How ACP Maps to Cursor](#how-acp-maps-to-cursor)
4. [Claude Code ACP Implementation](#claude-code-acp-implementation)
5. [Message Flow](#message-flow)
6. [Tool Calls](#tool-calls)
7. [Key Data Structures](#key-data-structures)

---

## What is ACP?

The **Agent Client Protocol** (ACP) is a standardized communication framework that enables interoperability between code editors/IDEs (Clients) and AI coding agents (Agents).

**Key characteristics:**
- Based on JSON-RPC 2.0
- Supports local (stdio) and remote (HTTP/WebSocket) deployment
- Reuses JSON representations from MCP where applicable
- Designed for coding-specific UX (diffs, terminals, file locations)

**Similar to LSP:** Just as the Language Server Protocol standardizes editor-language communication, ACP standardizes editor-agent communication.

```
┌─────────────────────────────────────────────────────────────────┐
│                      CODE EDITOR (Client)                        │
│  Cursor, Zed, VS Code, etc.                                      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │  ACP (JSON-RPC over stdio/HTTP)
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AI AGENT (Server)                           │
│  Claude Code, Copilot, etc.                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Protocol Overview

### Transport

ACP supports two transport modes:

| Mode | Transport | Use Case |
|------|-----------|----------|
| **Local** | JSON-RPC over stdio | Agent runs as subprocess of editor |
| **Remote** | HTTP/WebSocket | Agent hosted in cloud (in development) |

### Message Types

| Type | Description |
|------|-------------|
| **Methods** | Request-response pairs (expects result or error) |
| **Notifications** | One-way messages (no response) |

### Core Methods

**Agent Methods (called by Client):**

| Method | Required | Description |
|--------|----------|-------------|
| `initialize` | Yes | Version/capability negotiation |
| `authenticate` | No | Optional authentication |
| `session/new` | Yes | Create new conversation session |
| `session/prompt` | Yes | Send user message, receive response |
| `session/load` | No | Resume existing session |
| `session/set_mode` | No | Switch operating mode |
| `session/cancel` | No | Interrupt processing (notification) |

**Client Methods (called by Agent):**

| Method | Required | Description |
|--------|----------|-------------|
| `session/request_permission` | Yes | Request user approval for tool |
| `fs/read_text_file` | No | Read file contents |
| `fs/write_text_file` | No | Write file contents |
| `terminal/create` | No | Create terminal for command execution |
| `terminal/output` | No | Get terminal output |
| `terminal/kill` | No | Kill terminal process |

**Notifications (Agent → Client):**

| Notification | Description |
|--------------|-------------|
| `session/update` | Report progress, tool calls, plans, mode changes |

---

## How ACP Maps to Cursor

### Architecture Comparison

```
┌─────────────────────────────────────────────────────────────────┐
│                         CURSOR                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐      ┌─────────────────────────────────┐   │
│  │  Composer UI    │      │  ACP Extension Bridge           │   │
│  │  (Chat Input)   │      │  (HTTP on localhost:37842)      │   │
│  └────────┬────────┘      └────────────────┬────────────────┘   │
│           │                                │                     │
│           ▼                                ▼                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              submitChatMaybeAbortCurrent()              │    │
│  │                                                         │    │
│  │  if (modelName.startsWith('acp:')) {                    │    │
│  │    → acpExtensionBridge.sendMessage()                   │    │
│  │    → HTTP POST /acp/sendMessage                         │    │
│  │  }                                                      │    │
│  └─────────────────────────┬───────────────────────────────┘    │
│                            │                                     │
└────────────────────────────┼─────────────────────────────────────┘
                             │
                             │ stdio (JSON-RPC)
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    ACP AGENT (subprocess)                        │
│  e.g., claude-code-acp (npx @zed-industries/claude-code-acp)    │
└─────────────────────────────────────────────────────────────────┘
```

### Concept Mapping

| Cursor Concept | ACP Concept |
|----------------|-------------|
| `composerId` | `sessionId` |
| `submitChatMaybeAbortCurrent()` | `session/prompt` method |
| Human bubble (type: 1) | Prompt content |
| AI bubble (type: 2) | `session/update` notifications |
| `updateComposerDataSetStore({ generating: true })` | Agent processing after `session/prompt` |
| Tool permission UI | `session/request_permission` |
| MCP tools | ACP can expose tools via MCP server internally |

### Session Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. INITIALIZATION                                               │
│    Client → Agent: initialize { clientCapabilities }            │
│    Agent → Client: { protocolVersion, agentCapabilities }       │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. SESSION CREATION                                             │
│    Client → Agent: session/new { cwd, mcpServers }              │
│    Agent → Client: { sessionId, models, modes }                 │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. PROMPT TURNS (repeat)                                        │
│    Client → Agent: session/prompt { sessionId, prompt }         │
│    Agent → Client: session/update (notifications, streaming)    │
│    Agent → Client: { stopReason: "end_turn" }                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Claude Code ACP Implementation

The `@zed-industries/claude-code-acp` package bridges Claude Code (Anthropic's CLI agent) to the ACP protocol.

### How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                    claude-code-acp                               │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ClaudeAcpAgent (implements Agent interface)            │    │
│  │                                                         │    │
│  │  - initialize()     → Returns capabilities              │    │
│  │  - newSession()     → Creates Claude Code query         │    │
│  │  - prompt()         → Sends to Claude, streams back     │    │
│  │  - cancel()         → Interrupts Claude                 │    │
│  │  - setSessionMode() → Changes permission mode           │    │
│  └─────────────────────────────────────────────────────────┘    │
│                            │                                     │
│                            ▼                                     │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  @anthropic-ai/claude-agent-sdk                         │    │
│  │                                                         │    │
│  │  query({ prompt, options }) → Claude Code execution     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

**`ClaudeAcpAgent` class** (`acp-agent.ts`):
- Implements the ACP `Agent` interface
- Manages sessions with Claude Code SDK
- Translates between ACP and Claude message formats
- Handles tool permission requests

**`createMcpServer()` function** (`mcp-server.ts`):
- Creates an MCP server that exposes ACP tools to Claude
- Tools: `Read`, `Write`, `Edit`, `Bash`, `BashOutput`, `KillShell`
- Routes file/terminal operations back to the ACP client

### Translation Flow

```
ACP Client (Cursor)                      Claude Code ACP
────────────────────                     ───────────────────

session/prompt
  { prompt: [{ type: "text", text }] }
        │
        └───────────────────────────────→ promptToClaude()
                                           → SDKUserMessage
                                           → query.next()

        ┌───────────────────────────────← streamEventToAcpNotifications()
        │                                  ← Claude streaming events
session/update
  { sessionUpdate: "agent_message_chunk",
    content: { type: "text", text } }

session/update
  { sessionUpdate: "tool_call",
    toolCallId, title, kind, status }   ← toAcpNotifications()
                                           ← Claude tool_use blocks

        ┌───────────────────────────────← Tool execution
        │
session/request_permission              ← canUseTool() callback
  { toolCall, options }
        │
        └───────────────────────────────→ User approves/rejects

{ stopReason: "end_turn" }              ← query completes
```

### Tool Name Mapping

Claude Code's native tools are exposed via an internal MCP server with `mcp__acp__` prefix:

| Claude Tool | ACP MCP Tool |
|-------------|--------------|
| `Read` | `mcp__acp__Read` |
| `Write` | `mcp__acp__Write` |
| `Edit` | `mcp__acp__Edit` |
| `Bash` | `mcp__acp__Bash` |
| `BashOutput` | `mcp__acp__BashOutput` |
| `KillShell` | `mcp__acp__KillShell` |

When the client supports `fs/read_text_file`, the ACP server routes file reads through the client instead of using Claude's native `Read` tool. Same for writes and terminal.

---

## Message Flow

### Prompt Turn Detail

```
┌─────────────────────────────────────────────────────────────────┐
│ CLIENT                                                          │
│                                                                  │
│  session/prompt {                                                │
│    sessionId: "abc123",                                          │
│    prompt: [                                                     │
│      { type: "text", text: "Fix the bug in auth.ts" },          │
│      { type: "resource", resource: { uri: "file:///auth.ts" } } │
│    ]                                                             │
│  }                                                               │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ AGENT PROCESSING                                                 │
│                                                                  │
│  1. Convert prompt to Claude format                              │
│  2. Send to Claude API                                           │
│  3. Stream response chunks → session/update notifications        │
│  4. Handle tool calls → session/update + request_permission      │
│  5. Return final result                                          │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
                    ▼                ▼                ▼
┌─────────────────────┐ ┌─────────────────┐ ┌─────────────────────┐
│ session/update      │ │ session/update  │ │ request_permission  │
│ agent_message_chunk │ │ tool_call       │ │ (if needed)         │
│                     │ │                 │ │                     │
│ { content: {        │ │ { toolCallId,   │ │ { toolCall: {       │
│   type: "text",     │ │   title,        │ │     toolCallId,     │
│   text: "I'll..."   │ │   kind: "edit", │ │     title,          │
│ }}                  │ │   status }      │ │     rawInput        │
│                     │ │                 │ │   },                │
└─────────────────────┘ └─────────────────┘ │   options: [...] }  │
                                            └─────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ RESPONSE                                                         │
│                                                                  │
│  { stopReason: "end_turn" | "cancelled" | "max_tokens" | ... }  │
└─────────────────────────────────────────────────────────────────┘
```

### Session Update Types

| Update Type | Description |
|-------------|-------------|
| `agent_message_chunk` | Text from the agent (streaming) |
| `agent_thought_chunk` | Agent thinking/reasoning (extended thinking) |
| `user_message_chunk` | Echo of user input |
| `tool_call` | Agent requesting tool execution |
| `tool_call_update` | Tool execution progress/result |
| `plan` | Agent's plan entries (TodoWrite) |
| `current_mode_update` | Permission mode changed |
| `available_commands_update` | Available slash commands |

---

## Tool Calls

### Tool Call Lifecycle

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. TOOL CALL (Agent → Client)                                   │
│                                                                  │
│    session/update {                                              │
│      sessionId,                                                  │
│      update: {                                                   │
│        sessionUpdate: "tool_call",                               │
│        toolCallId: "call_xyz",                                   │
│        title: "Edit `auth.ts`",                                  │
│        kind: "edit",                                             │
│        status: "pending",                                        │
│        rawInput: { file_path, old_string, new_string },          │
│        content: [{ type: "diff", path, oldText, newText }],      │
│        locations: [{ path: "/src/auth.ts", line: 42 }]           │
│      }                                                           │
│    }                                                             │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 2. PERMISSION REQUEST (if needed)                               │
│                                                                  │
│    session/request_permission {                                  │
│      sessionId,                                                  │
│      toolCall: { toolCallId, title, rawInput },                  │
│      options: [                                                  │
│        { kind: "allow_always", name: "Always Allow" },           │
│        { kind: "allow_once", name: "Allow" },                    │
│        { kind: "reject_once", name: "Reject" }                   │
│      ]                                                           │
│    }                                                             │
│                                                                  │
│    Response: { outcome: { outcome: "selected", optionId } }      │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 3. TOOL EXECUTION                                               │
│                                                                  │
│    session/update {                                              │
│      update: {                                                   │
│        sessionUpdate: "tool_call_update",                        │
│        toolCallId: "call_xyz",                                   │
│        status: "in_progress"                                     │
│      }                                                           │
│    }                                                             │
│                                                                  │
│    (Agent executes tool, possibly using client fs/terminal)      │
└────────────────────────────────────┬────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────┐
│ 4. TOOL COMPLETION                                              │
│                                                                  │
│    session/update {                                              │
│      update: {                                                   │
│        sessionUpdate: "tool_call_update",                        │
│        toolCallId: "call_xyz",                                   │
│        status: "completed",                                      │
│        content: [{ type: "content", content: { text } }]         │
│      }                                                           │
│    }                                                             │
└─────────────────────────────────────────────────────────────────┘
```

### Tool Kinds

| Kind | Description | Example Tools |
|------|-------------|---------------|
| `read` | Read file contents | Read |
| `edit` | Modify files | Edit, Write |
| `delete` | Delete files | - |
| `move` | Move/rename files | - |
| `search` | Search codebase | Grep, Glob |
| `execute` | Run commands | Bash, terminal |
| `think` | Agent reasoning | Task, TodoWrite |
| `fetch` | Network requests | WebFetch, WebSearch |
| `switch_mode` | Mode transitions | ExitPlanMode |
| `other` | Uncategorized | - |

### Tool Content Types

```typescript
type ToolCallContent =
  | { type: "content"; content: { type: "text"; text: string } }
  | { type: "diff"; path: string; oldText: string | null; newText: string }
  | { type: "terminal"; terminalId: string };
```

---

## Key Data Structures

### Initialize Request/Response

```typescript
// Client → Agent
interface InitializeRequest {
  protocolVersion: number;
  clientCapabilities: {
    fs?: { readTextFile?: boolean; writeTextFile?: boolean };
    terminal?: boolean;
  };
  clientInfo: { name: string; version: string };
}

// Agent → Client
interface InitializeResponse {
  protocolVersion: number;
  agentCapabilities: {
    promptCapabilities?: { image?: boolean; embeddedContext?: boolean };
    mcpCapabilities?: { http?: boolean; sse?: boolean };
    sessionCapabilities?: { fork?: {}; resume?: {} };
  };
  agentInfo: { name: string; title: string; version: string };
  authMethods?: AuthMethod[];
}
```

### New Session Request/Response

```typescript
// Client → Agent
interface NewSessionRequest {
  cwd: string;  // Working directory (absolute path)
  mcpServers?: McpServerConfig[];
  _meta?: {
    systemPrompt?: string | { append: string };
    disableBuiltInTools?: boolean;
  };
}

// Agent → Client
interface NewSessionResponse {
  sessionId: string;
  models?: {
    availableModels: { modelId: string; name: string }[];
    currentModelId: string;
  };
  modes?: {
    availableModes: { id: string; name: string; description: string }[];
    currentModeId: string;
  };
}
```

### Prompt Request/Response

```typescript
// Client → Agent
interface PromptRequest {
  sessionId: string;
  prompt: PromptContent[];  // Text, images, resources
}

type PromptContent =
  | { type: "text"; text: string }
  | { type: "image"; data?: string; mimeType?: string; uri?: string }
  | { type: "resource"; resource: { uri: string; text: string } }
  | { type: "resource_link"; uri: string };

// Agent → Client
interface PromptResponse {
  stopReason: "end_turn" | "cancelled" | "max_tokens" | "max_turn_requests" | "refusal";
}
```

### Session Update Notification

```typescript
interface SessionNotification {
  sessionId: string;
  update:
    | { sessionUpdate: "agent_message_chunk"; content: Content }
    | { sessionUpdate: "agent_thought_chunk"; content: Content }
    | { sessionUpdate: "tool_call"; toolCallId: string; title: string; kind: ToolKind; status: Status; ... }
    | { sessionUpdate: "tool_call_update"; toolCallId: string; status: Status; content?: Content[] }
    | { sessionUpdate: "plan"; entries: PlanEntry[] }
    | { sessionUpdate: "current_mode_update"; currentModeId: string }
    | { sessionUpdate: "available_commands_update"; availableCommands: Command[] };
}
```

---

## Summary

### ACP vs Cursor's Native Chat

| Feature | Cursor Native | ACP |
|---------|---------------|-----|
| Transport | HTTP to Cursor backend | stdio (JSON-RPC) |
| Session management | Server-side (Cursor) | Agent-side |
| Tool execution | Cursor services | Agent + client callbacks |
| Streaming | Cursor-specific | `session/update` notifications |
| Permission flow | Cursor UI | `session/request_permission` |

### When to Use ACP

ACP is ideal when:
- Building a new AI agent that should work in multiple editors
- Integrating an existing agent (like Claude Code) into an editor
- Need standardized tool permission flows
- Want portable agent implementations

### Claude Code ACP Specifics

The `@zed-industries/claude-code-acp` package:
- Wraps Claude Code SDK in ACP protocol
- Exposes Claude's tools via internal MCP server
- Routes file/terminal operations through ACP client when available
- Supports all Claude Code features: thinking, tool calling, agent mode
- Permission modes: `default`, `acceptEdits`, `plan`, `dontAsk`, `bypassPermissions`

### Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point, runs ACP server |
| `src/acp-agent.ts` | `ClaudeAcpAgent` class implementing ACP |
| `src/mcp-server.ts` | Internal MCP server for ACP tools |
| `src/tools.ts` | Tool info/update translation |
| `src/settings.ts` | Permission settings management |
