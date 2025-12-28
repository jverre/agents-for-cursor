# Cursor Tools/Function Calling System

## Overview

Cursor implements a sophisticated **tool calling system** that allows the AI to execute actions in the IDE. This is similar to OpenAI's function calling or Anthropic's tool use, but with **client-side execution** of many tools.

## Tool Architecture

### Two Types of Tools

**1. Client-Side Tools** - Executed locally in the IDE
**2. Server-Side Tools** - Executed on Cursor's backend

## Complete Tool List

### Enum: `ClientSideToolV2` (Line 104274+)

```javascript
enum ClientSideToolV2 {
    UNSPECIFIED = 0,

    // File Operations
    READ_FILE = 5,
    READ_FILE_V2 = 40,
    EDIT_FILE = 7,
    EDIT_FILE_V2 = 38,
    DELETE_FILE = 11,

    // Directory Operations
    LIST_DIR = 6,
    LIST_DIR_V2 = 39,

    // Search Operations
    FILE_SEARCH = 8,
    RIPGREP_SEARCH = 3,
    RIPGREP_RAW_SEARCH = 41,
    GLOB_FILE_SEARCH = 42,
    READ_SEMSEARCH_FILES = 1,
    SEMANTIC_SEARCH_FULL = 9,
    DEEP_SEARCH = 27,
    SEARCH_SYMBOLS = 23,
    GO_TO_DEFINITION = 31,

    // Terminal/Shell
    RUN_TERMINAL_COMMAND_V2 = 15,
    WRITE_SHELL_STDIN = 55,

    // Linting
    READ_LINTS = 30,
    FIX_LINTS = 29,

    // Planning & Tasks
    CREATE_PLAN = 43,
    TODO_READ = 34,
    TODO_WRITE = 35,
    TASK = 32,
    TASK_V2 = 48,
    AWAIT_TASK = 33,

    // External Integrations
    WEB_SEARCH = 18,
    KNOWLEDGE_BASE = 25,
    FETCH_PULL_REQUEST = 26,

    // MCP (Model Context Protocol)
    MCP = 19,
    LIST_MCP_RESOURCES = 44,
    READ_MCP_RESOURCE = 45,
    CALL_MCP_TOOL = 49,

    // Project Management
    READ_PROJECT = 46,
    UPDATE_PROJECT = 47,

    // Advanced Features
    REAPPLY = 12,
    FETCH_RULES = 16,
    BACKGROUND_COMPOSER_FOLLOWUP = 24,
    CREATE_DIAGRAM = 28,
    APPLY_AGENT_DIFF = 50,
    ASK_QUESTION = 51,
    SWITCH_MODE = 52,
    GENERATE_IMAGE = 53,
    COMPUTER_USE = 54
}
```

## Tool Request/Response Flow

### 1. Tool Call Structure

**AI Requests Tool:**

```javascript
{
    response: {
        case: "streamUnifiedChatResponse",
        value: {
            text: "Let me read that file for you",

            // Tool call request
            tool_calls: [
                {
                    id: "call_xyz123",
                    type: "builtin_tool_call",
                    builtin_tool_call: {
                        case: "read_file_v2",
                        value: {
                            path: "/path/to/file.ts",
                            start_line: 1,
                            end_line: 100
                        }
                    }
                }
            ]
        }
    }
}
```

### 2. Client Executes Tool

**Local Execution Handler (Line 450367+):**

```javascript
async handleToolCallStarted(composerId, toolCallId) {
    const bubble = await this.createToolBubble(composerId, toolCallId);

    // Execute the tool locally
    const result = await this.executeToolLocally(toolCall);

    // Store result
    await this.handleToolCallCompleted(composerId, toolCallId, result);
}
```

### 3. Tool Result Structure

**Result Sent Back to AI:**

```javascript
{
    tool_result: {
        case: "builtin_tool_result",
        value: {
            tool_call_id: "call_xyz123",

            // Success case
            content: "file contents here...",

            // OR error case
            error: {
                message: "File not found",
                code: "ENOENT"
            },

            // Attachments/metadata
            attachments: {
                file_path: "/path/to/file.ts",
                line_count: 100,
                size_bytes: 5432
            }
        }
    }
}
```

## Example Tool Calls

### Example 1: Read File

**AI Request:**
```json
{
    "tool_calls": [{
        "id": "call_001",
        "type": "builtin_tool_call",
        "builtin_tool_call": {
            "case": "read_file_v2",
            "value": {
                "path": "src/components/Button.tsx",
                "start_line": 1,
                "end_line": 50
            }
        }
    }]
}
```

**Client Response:**
```json
{
    "tool_result": {
        "case": "builtin_tool_result",
        "value": {
            "tool_call_id": "call_001",
            "content": "import React from 'react';\n\nexport const Button = ({ children, onClick }) => {\n  return <button onClick={onClick}>{children}</button>;\n};"
        }
    }
}
```

### Example 2: Edit File (Search & Replace)

**AI Request:**
```json
{
    "tool_calls": [{
        "id": "call_002",
        "type": "builtin_tool_call",
        "builtin_tool_call": {
            "case": "edit_file_v2",
            "value": {
                "path": "src/components/Button.tsx",
                "edits": [{
                    "old_text": "export const Button = ({ children, onClick }) => {",
                    "new_text": "export const Button = ({ children, onClick, disabled = false }) => {"
                }]
            }
        }
    }]
}
```

**Client Response:**
```json
{
    "tool_result": {
        "case": "builtin_tool_result",
        "value": {
            "tool_call_id": "call_002",
            "content": "Successfully edited 1 location",
            "attachments": {
                "edits_applied": 1,
                "file_path": "src/components/Button.tsx"
            }
        }
    }
}
```

### Example 3: Ripgrep Search

**AI Request:**
```json
{
    "tool_calls": [{
        "id": "call_003",
        "type": "builtin_tool_call",
        "builtin_tool_call": {
            "case": "ripgrep_search",
            "value": {
                "query": "import.*Button",
                "regex": true,
                "case_sensitive": false,
                "max_results": 10
            }
        }
    }]
}
```

**Client Response:**
```json
{
    "tool_result": {
        "case": "builtin_tool_result",
        "value": {
            "tool_call_id": "call_003",
            "content": "Found 3 matches:\n\nsrc/App.tsx:5: import { Button } from './components/Button';\nsrc/pages/Home.tsx:2: import { Button } from '../components/Button';\ntest/Button.test.tsx:1: import { Button } from '../src/components/Button';"
        }
    }
}
```

### Example 4: Run Terminal Command

**AI Request:**
```json
{
    "tool_calls": [{
        "id": "call_004",
        "type": "builtin_tool_call",
        "builtin_tool_call": {
            "case": "run_terminal_command_v2",
            "value": {
                "command": "npm test",
                "working_directory": "/path/to/project",
                "timeout_ms": 30000
            }
        }
    }]
}
```

**Client Response (streaming):**
```json
{
    "tool_result": {
        "case": "builtin_tool_result",
        "value": {
            "tool_call_id": "call_004",
            "content": "> npm test\n\nPASS  test/Button.test.tsx\n  Button component\n    ✓ renders correctly (25ms)\n    ✓ handles click events (12ms)\n\nTest Suites: 1 passed, 1 total\nTests:       2 passed, 2 total",
            "attachments": {
                "exit_code": 0,
                "duration_ms": 1523
            }
        }
    }
}
```

### Example 5: MCP Tool Call

**AI Request:**
```json
{
    "tool_calls": [{
        "id": "call_005",
        "type": "builtin_tool_call",
        "builtin_tool_call": {
            "case": "call_mcp_tool",
            "value": {
                "server_name": "playwright",
                "tool_name": "screenshot",
                "arguments": {
                    "url": "https://example.com",
                    "selector": ".main-content"
                }
            }
        }
    }]
}
```

**Client Response:**
```json
{
    "tool_result": {
        "case": "call_mcp_tool_result",
        "value": {
            "tool_call_id": "call_005",
            "content": "Screenshot captured successfully",
            "attachments": {
                "image_base64": "iVBORw0KGgoAAAANS...",
                "width": 1920,
                "height": 1080
            }
        }
    }
}
```

## How Tools Are Declared to AI

### In Request: `supportedTools` Array

```javascript
{
    conversation: [...],
    model: "claude-sonnet-4.5",

    // Tell AI which tools are available
    supportedTools: [
        ClientSideToolV2.READ_FILE_V2,
        ClientSideToolV2.EDIT_FILE_V2,
        ClientSideToolV2.RIPGREP_SEARCH,
        ClientSideToolV2.LIST_DIR_V2,
        ClientSideToolV2.RUN_TERMINAL_COMMAND_V2,
        ClientSideToolV2.WEB_SEARCH,
        ClientSideToolV2.MCP
    ],

    // MCP-specific tools
    mcpTools: [
        {
            server_name: "playwright",
            tools: [
                { name: "screenshot", description: "Take a screenshot" },
                { name: "click", description: "Click an element" }
            ]
        }
    ]
}
```

### Tool Filtering by Mode (Line 421639+)

```javascript
// Different modes get different tools
const getToolsForMode = (mode) => {
    let tools = ALL_TOOLS.filter(tool => {
        // Filter out deprecated tools
        if (DEPRECATED_TOOLS.has(tool)) return false;

        // Web search only in specific modes
        if (tool === ClientSideToolV2.WEB_SEARCH) {
            return mode === "agent" || mode === "chat" || mode === "search";
        }

        // Knowledge base requires feature flag
        if (tool === ClientSideToolV2.KNOWLEDGE_BASE) {
            return experimentService.checkFeatureGate("knowledge_base_enabled");
        }

        // TASK tools only in specific modes
        if (tool === ClientSideToolV2.TASK) {
            return mode !== "plan" && mode !== "debug";
        }

        // ASK_QUESTION only in plan mode (or with feature flag)
        if (tool === ClientSideToolV2.ASK_QUESTION) {
            return mode === "plan" ||
                   experimentService.checkFeatureGate("ask_question_all_modes");
        }

        return true;
    });

    // Remove MCP from list (sent separately)
    return tools.filter(t => t !== ClientSideToolV2.MCP);
};
```

## Tool Execution Permissions

### Auto-Run Controls

```javascript
{
    autoRunControls: {
        // Yolo mode - auto-accept all tools
        yoloMode: boolean,

        // Specific tool protections
        playwrightProtection: boolean,  // Require approval for Playwright
        mcpToolsProtection: boolean,    // Require approval for MCP tools

        // Admin-controlled settings
        isAdminControlled: boolean
    }
}
```

### Tool Approval Flow

**User can configure auto-accept for tools:**

1. **Always Ask** - Tool shows popup, waits for approval
2. **Auto-Accept** - Tool runs automatically
3. **Yolo Mode** - ALL tools run automatically (dangerous!)

## Tool Result Attachments

**Rich metadata returned with results:**

```javascript
{
    attachments: {
        // File operations
        file_path: string,
        line_count: number,
        size_bytes: number,

        // Search results
        match_count: number,
        files_searched: number,

        // Terminal commands
        exit_code: number,
        duration_ms: number,

        // Reminders/warnings
        todo_reminder: {
            type: "DISCOVERY_BUDGET",
            message: "You've used 80% of your search budget"
        },

        // Error details
        error_details: {
            code: "ENOENT",
            message: "File not found",
            stack_trace: "..."
        }
    }
}
```

## Complete Tool Call Lifecycle

### 1. AI Decides to Use Tool
```javascript
// AI streams response with tool call
{ text: "Let me read that file", tool_calls: [...] }
```

### 2. Client Receives Tool Call
```javascript
handleToolCallStarted(composerId, toolCallId)
```

### 3. Client Checks Permissions
```javascript
if (requiresApproval(toolCall)) {
    await showApprovalDialog(toolCall);
}
```

### 4. Client Executes Tool
```javascript
const result = await executeToolLocally(toolCall);
```

### 5. Client Sends Result
```javascript
{
    tool_result: {
        tool_call_id: "call_xyz",
        content: "...",
        attachments: {...}
    }
}
```

### 6. AI Continues with Result
```javascript
// AI receives result and continues
{ text: "Based on the file contents, I can see that..." }
```

## MCP (Model Context Protocol) Integration

**Special tool type for external integrations:**

```javascript
{
    supportedTools: [
        ClientSideToolV2.MCP  // Generic MCP tool
    ],

    // Specific MCP servers and their tools
    mcpTools: [
        {
            server_name: "playwright",
            tools: [
                { name: "screenshot", schema: {...} },
                { name: "click", schema: {...} }
            ]
        },
        {
            server_name: "filesystem",
            tools: [
                { name: "read", schema: {...} },
                { name: "write", schema: {...} }
            ]
        }
    ]
}
```

## Summary

### Key Points:

1. **Client-Side Execution** - Most tools run locally in the IDE
2. **Rich Tool Set** - 50+ different tools for file ops, search, terminal, etc.
3. **Tool Permissions** - Configurable auto-run vs. manual approval
4. **Structured Results** - Rich metadata and attachments
5. **MCP Support** - Extensible via Model Context Protocol
6. **Mode-Specific** - Different tools available in different modes (chat/agent/plan)

### Tool Categories:

- 📁 **File Operations** - Read, Edit, Delete
- 🔍 **Search** - Grep, Glob, Semantic, Deep Search
- 💻 **Terminal** - Run commands, write stdin
- 🛠️ **Development** - Lints, symbols, definitions
- 📋 **Planning** - Tasks, TODOs, plans
- 🌐 **External** - Web search, Knowledge base, GitHub PRs
- 🔌 **MCP** - Extensible integrations (Playwright, etc.)
