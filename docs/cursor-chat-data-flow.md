# Cursor Chat Data Flow Documentation

This document describes in detail how Cursor handles chat interactions, including message sending, response streaming, and tool calls.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Message Sending Flow](#message-sending-flow)
3. [Response Streaming](#response-streaming)
4. [Tool Calls](#tool-calls)
5. [Context Management](#context-management)
6. [Key Services and Classes](#key-services-and-classes)
7. [Data Structures](#data-structures)

---

## Architecture Overview

Cursor's chat system is **NOT** built on VS Code's Chat API (`ChatParticipant`, etc.). Instead, Cursor has its own proprietary chat implementation:

```
┌─────────────────────────────────────────────────────────────────┐
│                     CURSOR CHAT UI                               │
│  (Composer, Message Bubbles, Input Field, Model Selector)        │
│  Services: composerDataService, composerViewsService             │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CURSOR CHAT SERVICES                            │
│  (submitChatMaybeAbortCurrent, appendComposerBubbles)            │
│  Built into workbench.desktop.main.js                            │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────────┐
│ CURSOR BACKEND  │ │ ACP SERVICE │ │    MCP LAYER        │
│ (Standard models│ │ (HTTP IPC   │ │ (Tool execution)    │
│ claude, gpt)    │ │ port 37842) │ │                     │
└────────┬────────┘ └──────┬──────┘ └──────────┬──────────┘
         │                 │                   │
         └─────────────────┼───────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    LLM PROVIDERS                                 │
│  (Claude, GPT via Cursor backend, or ACP providers)              │
└─────────────────────────────────────────────────────────────────┘
```

### Key Components

| Component | Location | Purpose |
|-----------|----------|---------|
| Composer | `workbench.desktop.main.js` | User input, file references, model selection |
| composerDataService | Workbench | Manages composer state, bubbles, history |
| composerViewsService | Workbench | Chat UI rendering |
| ACP Service | `workbench.js` (bootstrap) | Custom ACP provider management |
| acpExtensionBridge | `workbench.js` | HTTP IPC to ACP extension on port 37842 |
| MCP Client | `cursor-mcp` extension | Tool execution via MCP protocol |

**Note:** VS Code's Chat API (`ChatParticipant`, `LanguageModelChat`) exists in Cursor but is used for VS Code Copilot Chat features, NOT for Cursor's main composer chat.

---

## Message Sending Flow

### 1. User Input Capture

When a user types in the composer and submits:

```
User types message in Composer
    ↓
submitChatMaybeAbortCurrent() called
    ↓
Message + references extracted from composer state
    ↓
Model determined from composerHandle.data.modelConfig.modelName
```

### 2. Message Processing

```javascript
// Composer state contains:
{
  modelConfig: {
    modelName: "claude-3.5-sonnet" | "acp:claude-code" | ...
  },
  references: [
    { uri: "file:///path/to/file.ts", range: {...} }
  ],
  inputText: "User's message"
}
```

### 3. Request Construction

The message is packaged into a `ChatRequest`:

```typescript
interface ChatRequest {
  prompt: string;                    // User's input text
  command?: string;                  // Slash command if used
  references: ChatPromptReference[]; // Attached files/symbols
  toolReferences: ChatLanguageModelToolReference[];
  toolInvocationToken: ChatParticipantToolToken;
  model: LanguageModelChat;          // Selected LLM
}
```

### 4. Model Routing

```
ChatRequest created
    ↓
    ├─── Standard Model (claude-3.5-sonnet, gpt-4, etc.)
    │    └→ LanguageModelChat.sendRequest()
    │
    └─── ACP Model (acp:claude-code)
         └→ window.acpService.handleRequest()
             └→ HTTP POST to localhost:37842/acp/sendMessage
```

### 5. UI Update

Before sending to the model:

```javascript
// Create human bubble
const humanBubble = {
  type: 1,           // Human message
  text: message,
  timestamp: Date.now()
};
appendComposerBubbles(humanBubble);

// Update state to "generating"
updateComposerDataSetStore({ generating: true });
```

---

## Response Streaming

### Streaming Mechanisms

Cursor supports three transport types for streaming:

#### 1. StreamableHTTP (Primary)

```typescript
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
  requestInit: {
    headers: {
      'User-Agent': getUserAgent(),
      'MCP-Session-Id': sessionId  // Session tracking
    }
  }
});
```

**Features:**
- Session-aware with automatic recovery
- Detects 404 session termination and re-initializes
- Preferred transport for modern MCP servers

#### 2. Server-Sent Events (SSE)

```typescript
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

// Fallback when StreamableHTTP fails
const transport = new SSEClientTransport(new URL(serverUrl));
```

**Features:**
- Auto-reconnect on disconnect
- Fallback for HTTP-based servers
- Standard SSE protocol

#### 3. Stdio (Local Processes)

```typescript
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: 'npx',
  args: ['@some/mcp-server'],
  env: { ...process.env, CUSTOM_VAR: 'value' }
});
```

**Features:**
- For local executable MCP servers
- Communicates via stdin/stdout
- Captures stderr for logging

### Response Processing

```typescript
interface LanguageModelChatResponse {
  // Async iterable of response parts
  stream: AsyncIterable<
    | LanguageModelTextPart      // Text content
    | LanguageModelToolCallPart  // Tool call request
    | unknown                    // Extension points
  >;

  // Convenience for text-only responses
  text: AsyncIterable<string>;
}
```

### Streaming Flow

```
Model generates response
    ↓
Response chunks sent over transport
    ↓
SDK receives and parses chunks
    ↓
    ├─── TextPart
    │    └→ ChatResponseStream.markdown(text)
    │        └→ UI renders incrementally
    │
    └─── ToolCallPart
         └→ Tool execution triggered
             └→ Result sent back to model
```

### Progress Notifications

For long-running operations:

```typescript
client.callTool({
  name: toolName,
  arguments: args,
  _meta: { progressToken }
}, CallToolResultSchema, {
  onprogress: (progress: Progress) => {
    // Send progress to UI
    vscode.commands.executeCommand('mcp.progressNotification', {
      progressToken,
      notification: progress
    });
  },
  timeout: 60 * 60 * 1000  // 1 hour timeout
});
```

---

## Tool Calls

### Tool Architecture

Cursor uses MCP (Model Context Protocol) as the **internal protocol for ALL tools** - both built-in and external:

```
┌─────────────────────────────────────────────────────────────────┐
│                    AGENT LOOP                                    │
│  SimpleControlledExecManager (from @anysphere/agent-exec)        │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    VscodeMcpLease                                │
│  Wraps all tool providers, provides getToolSet()                 │
└──────────────────────────┬──────────────────────────────────────┘
                           │
          ┌────────────────┼────────────────┐
          │                │                │
          ▼                ▼                ▼
┌─────────────────┐ ┌─────────────┐ ┌─────────────────────┐
│ BUILT-IN TOOLS  │ │ BROWSER     │ │ EXTERNAL MCP        │
│ (cursor-agent-  │ │ AUTOMATION  │ │ SERVERS             │
│ exec extension) │ │ (extension) │ │ (stdio/http/sse)    │
│                 │ │             │ │                     │
│ - Read file     │ │ - Navigate  │ │ - Custom tools      │
│ - Edit file     │ │ - Click     │ │ - Third-party       │
│ - Terminal      │ │ - Type      │ │   integrations      │
│ - Search        │ │ - Screenshot│ │                     │
│ - Apply diff    │ │             │ │                     │
└─────────────────┘ └─────────────┘ └─────────────────────┘
        │                 │                │
        └─────────────────┼────────────────┘
                          │
                          ▼
               All registered via:
               vscode.cursor.registerMcpProvider()
```

**Key insight:** Built-in tools are NOT separate from MCP - they're registered as MCP providers internally.

### Tool Discovery

Tools are registered and discovered via the MCP protocol:

```typescript
// Get available tools from all providers
const tools = await mcpLease.getToolSet();

// Tool definition structure (McpToolDefinition)
interface Tool {
  name: string;           // Tool identifier
  description: string;    // Human-readable description
  inputSchema: object;    // JSON Schema for parameters
}
```

### Tool Name Sanitization

Tool names are sanitized for LLM compatibility:

```javascript
// Original: "my-special_tool.v2"
// Sanitized: "my_special_tool_v2"

// Mapping stored for reverse lookup
toolNameMap.set(sanitizedName, originalName);
```

### Tool Call Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. MODEL RETURNS TOOL CALL                                      │
│    LanguageModelToolCallPart {                                  │
│      callId: "call_abc123",                                     │
│      name: "read_file",                                         │
│      input: { path: "/src/index.ts" }                           │
│    }                                                            │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. TOOL EXECUTION                                               │
│    const result = await lm.invokeTool(name, {                   │
│      toolInvocationToken,                                       │
│      input: toolCall.input                                      │
│    });                                                          │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. RESULT SENT BACK                                             │
│    LanguageModelToolResultPart {                                │
│      callId: "call_abc123",                                     │
│      content: [{ type: "text", value: "file contents..." }]     │
│    }                                                            │
└──────────────────────────┬──────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. MODEL CONTINUES                                              │
│    Agent loop continues until model returns final text          │
└─────────────────────────────────────────────────────────────────┘
```

### Tool Invocation Code

```typescript
// ClientToMcpClientAdapter.callTool()
async callTool(
  name: string,
  args: Record<string, unknown>,
  toolCallId: string
): Promise<McpToolResult> {

  // Resolve sanitized name to original
  const originalName = this.toolNameMap.get(name) ?? name;

  // Call with session retry for auto-recovery
  const result = await this.withSessionRetry(async () => {
    return this.client.callTool({
      name: originalName,
      arguments: args,
      _meta: { progressToken: toolCallId }
    }, CallToolResultSchema, {
      onprogress: this.handleProgress,
      timeout: 3600000
    });
  });

  return {
    content: result.content,
    isError: result.error !== undefined
  };
}
```

### Elicitation (User Input During Tool Execution)

Some tools can request user input during execution:

```typescript
// Server sends ElicitRequest
client.setRequestHandler(ElicitRequestSchema, async (request) => {
  const { message, requestedSchema } = request.params;

  // Ask user for input
  const response = await elicitationProvider.elicit({
    message,
    requestedSchema
  });

  return {
    action: response.action,  // "confirm" | "decline" | "cancel"
    content: response.content
  };
});
```

---

## Context Management

### Reference Types

```typescript
// Files/symbols attached to chat
interface ChatPromptReference {
  id: string;
  name: string;
  value: Uri | Location | { variableName: string; value: unknown };
  iconPath?: ThemeIcon | Uri | { light: Uri; dark: Uri };
}

// Tools available for the request
interface ChatLanguageModelToolReference {
  name: string;
  range?: [number, number];  // Position in prompt
}
```

### Context Selection Flow

```
User selects files with # in composer
    ↓
Files added to references array
    ↓
ChatRequest includes references
    ↓
Chat handler receives references
    ↓
    ├─── Embed directly in system prompt
    │    (for small files/snippets)
    │
    └─── Use tools to read on demand
         (for large files/many references)
```

### Token Management

```typescript
// Count tokens before sending
const tokenCount = await model.countTokens(message);

// Model limits
interface LanguageModelChat {
  maxInputTokens: number;   // e.g., 200000 for Claude
  // ...
}
```

### Context Window Optimization

1. **Priority-based inclusion**: High-relevance files first
2. **Truncation**: History trimmed when approaching limit
3. **Tool results preferred**: More concise than raw file content
4. **Incremental loading**: Tools fetch context on demand

### Session Management

```javascript
// Each composer gets unique session ID
const composerId = generateUniqueId();

// ACP maintains server-side history per session
await acpService.initSession(composerId);

// Only current message sent (server has history)
await acpService.handleRequest(modelName, currentMessage, composerId);
```

---

## Key Services and Classes

### Cursor Chat Services (Proprietary)

| Service | Purpose |
|---------|---------|
| `composerDataService` | Manages composer state, message history, bubbles |
| `composerViewsService` | Renders chat UI, handles view updates |
| `composerUtilsService` | Text input management, clearing, focus |
| `submitChatMaybeAbortCurrent` | Entry point for sending messages |
| `appendComposerBubbles` | Adds human/AI messages to the chat |
| `updateComposerDataSetStore` | Updates composer state (generating, completed) |
| `cursorCommandsService` | Handles slash commands |
| `ChatSlashCommandService` | Manages available slash commands |

### ACP Layer (Custom Providers)

| Service | Purpose |
|---------|---------|
| `ACPService` | Provider management, request routing |
| `acpExtensionBridge` | HTTP IPC to ACP extension (port 37842) |
| `window._acpRegisterProvider` | Registers ACP model providers |

### Agent Execution Layer

| Class/Service | Package | Purpose |
|---------------|---------|---------|
| `SimpleControlledExecManager` | `@anysphere/local-exec` | Main agent loop orchestrator |
| `LocalRequestContextExecutor` | `@anysphere/local-exec` | Executes tools in workspace context |
| `VscodeMcpLease` | `cursor-mcp` extension | Wraps all tool providers, provides `getToolSet()` |
| `ClientToMcpClientAdapter` | `cursor-mcp` extension | Adapts MCP clients to agent-exec interface |

### Tool Provider Extensions

| Extension | Tools Provided |
|-----------|----------------|
| `cursor-agent-exec` | Read file, Edit file, Terminal, Search, Apply diff |
| `cursor-browser-automation` | Navigate, Click, Type, Screenshot, etc. |
| `cursor-mcp` | External MCP server tools (stdio/http/sse) |

### MCP Transport Layer

| Class | Purpose |
|-------|---------|
| `StdioClientTransport` | Local process communication (for external MCP servers) |
| `StreamableHTTPClientTransport` | HTTP streaming transport |
| `SSEClientTransport` | Server-Sent Events transport |

### Cursor-Specific

| Service | Purpose |
|---------|---------|
| `ACPService` | Custom provider management |
| `acpExtensionBridge` | HTTP IPC to ACP extension (port 37842) |
| `composerDataService` | Composer state management |
| `composerViewsService` | Chat UI rendering |

---

## Data Structures

### Message Types

```typescript
// Role enumeration
enum LanguageModelChatMessageRole {
  User = 1,
  Assistant = 2
}

// Message structure
class LanguageModelChatMessage {
  role: LanguageModelChatMessageRole;
  content: Array<
    | LanguageModelTextPart
    | LanguageModelToolCallPart
    | LanguageModelToolResultPart
  >;
  name?: string;
}
```

### Chat History

```typescript
// Request turn (user message)
interface ChatRequestTurn {
  prompt: string;
  command?: string;
  references: ChatPromptReference[];
  participant: string;
}

// Response turn (assistant message)
interface ChatResponseTurn {
  response: ChatResponsePart[];
  result: ChatResult;
  participant: string;
}

// Full context
interface ChatContext {
  history: ReadonlyArray<ChatRequestTurn | ChatResponseTurn>;
}
```

### Tool Result

```typescript
interface McpToolResult {
  content: McpToolResultContent;
  isError: boolean;
}

type McpToolResultContent = Array<{
  type: 'text' | 'image' | 'resource';
  text?: string;
  data?: string;      // Base64 for images
  mimeType?: string;
  uri?: string;
}>;
```

### Server Instance

```typescript
type ServerInstance =
  | StdioServerInstance
  | StreamableHttpServerInstance
  | SSEServerInstance;

interface StdioServerInstance {
  transport: StdioClientTransport;
  client: Client;
  type: 'stdio';
  serverInfo: MCPServerInfo;
}

interface StreamableHttpServerInstance {
  transport: StreamableHTTPClientTransport;
  client: Client;
  type: 'streamableHttp';
  serverInfo: MCPServerInfo;
}
```

---

## Complete Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER INTERACTION                                │
│  User types: "Fix the bug in auth.ts"                                        │
│  User attaches: #auth.ts                                                     │
│  User selects: Claude 3.5 Sonnet (or acp:claude-code)                        │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPOSER SUBMISSION                                │
│  submitChatMaybeAbortCurrent(composerHandle, message)                        │
│  ├── Extract from composerHandle.data:                                       │
│  │   - modelConfig.modelName                                                 │
│  │   - references (attached files)                                           │
│  │   - inputText (user message)                                              │
│  ├── Create human bubble: { type: 1, text: message }                         │
│  ├── appendComposerBubbles(humanBubble)                                      │
│  └── updateComposerDataSetStore({ generating: true })                        │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           MODEL ROUTING                                      │
│  if (modelName.startsWith('acp:')) {                                         │
│    // ACP model (e.g., acp:claude-code)                                      │
│    → window.acpService.handleRequest(modelName, message, composerId)         │
│    → HTTP POST to localhost:37842/acp/sendMessage                            │
│  } else {                                                                    │
│    // Standard model (claude-3.5-sonnet, gpt-4, etc.)                        │
│    → Cursor backend API                                                      │
│  }                                                                           │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           RESPONSE STREAMING                                 │
│  Response streams back as chunks:                                            │
│  ├── Text chunks → Append to current AI bubble incrementally                │
│  └── Tool calls → Handled by agent loop (see below)                          │
└────────────────────────────────────┬────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    │                                 │
                    ▼                                 ▼
┌─────────────────────────────┐     ┌─────────────────────────────────────────┐
│       TEXT RESPONSE         │     │              TOOL CALL                   │
│                             │     │                                          │
│  Cursor renders markdown    │     │  Model returns tool_use in response      │
│  incrementally in the       │     │  { name: "read_file",                    │
│  AI bubble                  │     │    input: { path: "/src/auth.ts" } }     │
│                             │     │           │                              │
│                             │     │           ▼                              │
│                             │     │  MCP client executes tool                │
│                             │     │  (via cursor-mcp extension)              │
│                             │     │           │                              │
│                             │     │           ▼                              │
│                             │     │  Tool result sent back to model          │
│                             │     │           │                              │
│                             │     │           ▼                              │
│                             │     │  Agent loop continues until              │
│                             │     │  model returns final text                │
└─────────────────────────────┘     └─────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           COMPLETION                                         │
│  ├── Create AI bubble: { type: 2, text: finalResponse }                      │
│  ├── appendComposerBubbles(aiBubble)                                         │
│  ├── updateComposerDataSetStore({ generating: false, completed: true })      │
│  └── Session history maintained server-side (keyed by composerId)            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Key File Locations

| File | Purpose |
|------|---------|
| `out/vscode-dts/vscode.d.ts` | VS Code API type definitions |
| `out/vs/workbench/workbench.desktop.main.js` | Main workbench with chat UI |
| `out/vs/code/electron-sandbox/workbench/workbench.js` | Bootstrap + ACP services |
| `extensions/cursor-mcp/src/commands/mcpCommands.ts` | MCP client implementation |

---

## Summary

Cursor's chat system is a proprietary implementation (NOT VS Code's Chat API):

1. **UI Layer**: Composer handles input, bubbles render messages
2. **Cursor Services Layer**: `composerDataService`, `submitChatMaybeAbortCurrent`, etc.
3. **Provider Layer**: Cursor backend (standard models) or ACP service (custom providers)
4. **Tool Layer**: MCP clients handle tool execution via HTTP, SSE, or stdio

The system supports:
- **Streaming responses** with incremental rendering
- **Tool calling** with automatic result integration
- **Session management** with server-side history
- **Multi-transport** with automatic fallback
- **Progress notifications** for long operations
- **User elicitation** for interactive tool execution
