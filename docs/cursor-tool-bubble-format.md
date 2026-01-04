# Cursor Tool Bubble Data Format

This document describes the data format Cursor uses for tool call bubbles in the chat interface. Understanding this format is essential for properly logging tool calls so the UI displays them correctly.

## Overview

Cursor stores chat bubbles in a SQLite database (`state.vscdb`) in the `cursorDiskKV` table. Each bubble is stored with a key format of `bubbleId:<conversationId>:<bubbleId>` and the value is a JSON object.

## Bubble Types

The `type` field indicates the bubble type:
- `1` - Human/User message
- `2` - Assistant message (including tool calls)

## Tool Call Bubbles

Tool call bubbles are assistant messages (`type: 2`) that contain a `toolFormerData` object. This is the key structure that determines how the UI renders tool calls.

### Core Schema

```typescript
interface ToolBubble {
  // Version marker
  _v: 3;

  // Bubble type: 1=human, 2=assistant
  type: 2;

  // Unique identifier for this bubble
  bubbleId: string;

  // Capability type (15 = tool call)
  capabilityType: 15;

  // Timestamp when bubble was created
  createdAt: string; // ISO 8601 format

  // Text content (often empty for tool bubbles)
  text: string;

  // Code blocks if any
  codeBlocks: CodeBlock[];

  // The tool call data - THIS IS THE KEY FIELD
  toolFormerData: ToolFormerData;

  // ... other fields (see full schema below)
}
```

### ToolFormerData Structure

The `toolFormerData` object contains all the information needed to display a tool call:

```typescript
interface ToolFormerData {
  // Tool type ID (see Tool Type IDs section)
  tool: number;

  // Unique identifier for this tool call
  toolCallId: string;

  // Index of this tool call in the current response (0-based)
  toolIndex: number;

  // ID of the model call that generated this tool call
  modelCallId: string;

  // Execution status
  status: "loading" | "completed" | "cancelled" | "error";

  // Tool name (human-readable)
  name: string;

  // Raw arguments as JSON string (from the model)
  rawArgs: string;

  // Parsed/normalized parameters as JSON string
  params: string;

  // Additional tool-specific data
  additionalData: AdditionalData;

  // Tool result as JSON string (when completed)
  result?: string;

  // User decision for tools requiring approval
  userDecision?: "accepted" | "rejected";
}
```

## Tool Type IDs

| ID | Name | Description |
|----|------|-------------|
| 0 | Generic/MCP | Generic tool call (MCP tools, external tools) |
| 9 | `codebase_search` | Semantic code search across the codebase |
| 15 | `run_terminal_cmd` | Terminal command execution |
| 38 | `search_replace` | File editing with search/replace |
| 39 | `list_dir` | Directory listing |
| 40 | `read_file` | File reading |
| 41 | `grep` | Content search using ripgrep |
| 42 | `glob_file_search` | File pattern search |
| 49 | Unknown | Appears to be internal/placeholder |

### Full Supported Tools List

From the `supportedTools` array observed in bubbles:
`[1, 7, 8, 9, 11, 12, 15, 18, 25, 27, 29, 30, 32, 34, 35, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 49, 52]`

## Tool-Specific Data Formats

### Tool 9: codebase_search

**rawArgs:**
```json
{
  "query": "search query text",
  "target_directories": []
}
```

**params:**
```json
{
  "repositoryInfo": {
    "relativeWorkspacePath": ".",
    "repoName": "repo-uuid",
    "repoOwner": "owner"
  }
}
```

**result:**
```json
{
  "results": [
    {
      "file": "path/to/file.ts",
      "line": 42,
      "content": "matched content..."
    }
  ]
}
```

### Tool 15: run_terminal_cmd

**rawArgs:**
```json
{
  "command": "git status",
  "is_background": false,
  "required_permissions": ["all"]
}
```

**params:**
```json
{
  "command": "git status",
  "requireUserApproval": true,
  "parsingResult": {
    "executableCommands": [
      {
        "name": "git",
        "args": [{"type": "word", "value": "status"}],
        "fullText": "git status"
      }
    ]
  },
  "requestedSandboxPolicy": {
    "type": "TYPE_INSECURE_NONE",
    "networkAccess": true,
    "blockGitWrites": false
  }
}
```

**additionalData:**
```json
{
  "status": "success",
  "reviewData": {
    "status": "None",
    "selectedOption": "accept",
    "isShowingInput": false,
    "candidatesForAllowlist": ["git status"],
    "approvalType": "user"
  },
  "sessionId": "uuid",
  "startAtBufferLine": 0,
  "previousAttempt": "..."
}
```

**result:**
```json
{
  "output": "On branch main\nnothing to commit...",
  "rejected": false,
  "notInterrupted": true,
  "endedReason": "RUN_TERMINAL_COMMAND_ENDED_REASON_EXECUTION_COMPLETED",
  "exitCodeV2": 0,
  "effectiveSandboxPolicy": {
    "type": "TYPE_INSECURE_NONE"
  }
}
```

### Tool 38: search_replace

**rawArgs:**
```json
{
  "file_path": "/path/to/file.ts"
}
```

**params:**
```json
{
  "relativeWorkspacePath": "/path/to/file.ts"
}
```

**additionalData:**
```json
{
  "codeblockId": "uuid",
  "status": "error",
  "reviewData": {
    "status": "None",
    "selectedOption": "accept",
    "isShowingInput": false,
    "firstTimeReviewMode": false
  }
}
```

### Tool 39: list_dir

**rawArgs:**
```json
{
  "target_directory": "/path/to/directory"
}
```

**params:**
```json
{
  "targetDirectory": "/path/to/directory",
  "shouldEnrichTerminalMetadata": false
}
```

**result:**
```json
{
  "directoryTreeRoot": {
    "absPath": "/path/to/directory",
    "childrenFiles": [
      {"name": "file1.js"},
      {"name": "file2.ts"}
    ],
    "childrenWereProcessed": true,
    "fullSubtreeExtensionCounts": {".js": 1, ".ts": 1},
    "numFiles": 2
  }
}
```

### Tool 40: read_file

**rawArgs:**
```json
{
  "target_file": "/path/to/file.ts",
  "limit": 100
}
```

**params:**
```json
{
  "targetFile": "/path/to/file.ts",
  "limit": 100,
  "charsLimit": 100000,
  "effectiveUri": "file:///path/to/file.ts"
}
```

**result:**
```json
{
  "contents": "file contents here...",
  "numCharactersInRequestedRange": 884,
  "totalLinesInFile": 29
}
```

### Tool 41: grep

**rawArgs:**
```json
{
  "pattern": "search pattern",
  "path": "/path/to/search",
  "output_mode": "files_with_matches",
  "head_limit": 20
}
```

**params:**
```json
{
  "pattern": "search pattern",
  "path": "/path/to/search",
  "outputMode": "files_with_matches",
  "caseInsensitive": false,
  "headLimit": 20
}
```

**result:**
```json
{
  "success": {
    "pattern": "search pattern",
    "path": "/path/to/search",
    "outputMode": "files_with_matches",
    "workspaceResults": {
      "/path/to/search": {
        "files": {
          "files": ["./file1.ts", "./file2.ts"],
          "totalFiles": 2
        }
      }
    }
  }
}
```

### Tool 42: glob_file_search

**rawArgs:**
```json
{
  "target_directory": "/path/to/search",
  "glob_pattern": "*.ts"
}
```

**params:**
```json
{
  "targetDirectory": "/path/to/search",
  "globPattern": "**/*.ts"
}
```

**result:**
```json
{
  "directories": [
    {
      "absPath": "/path/to/search",
      "files": [
        {"relPath": "src/index.ts"},
        {"relPath": "src/utils.ts"}
      ],
      "totalFiles": 2
    }
  ]
}
```

### Tool 0: Generic/MCP Tool

For MCP and external tools, the format is minimal:

**toolFormerData:**
```json
{
  "tool": 0,
  "toolCallId": "toolu_xxx",
  "status": "completed",
  "additionalData": {}
}
```

The `name` field contains the display name (e.g., "Read File", "Task", "Tool").

## Full Bubble Schema

Here's the complete bubble schema with all fields:

```typescript
interface FullBubble {
  _v: 3;
  type: 1 | 2;
  bubbleId: string;
  createdAt: string;
  text: string;
  richText?: string;
  codeBlocks: CodeBlock[];

  // Tool-related
  capabilityType?: number;
  toolFormerData?: ToolFormerData;
  toolResults: any[];

  // Context
  approximateLintErrors: any[];
  lints: any[];
  codebaseContextChunks: any[];
  commits: any[];
  pullRequests: any[];
  attachedCodeChunks: any[];
  attachedFolders: any[];
  attachedFoldersNew: any[];
  attachedFileCodeChunksMetadataOnly: any[];
  attachedFoldersListDirResults: any[];

  // Suggestions
  assistantSuggestedDiffs: any[];
  suggestedCodeBlocks: any[];
  userResponsesToSuggestedCodeBlocks: any[];
  diffsForCompressingFiles: any[];
  diffsSinceLastApply: any[];
  diffHistories: any[];
  fileDiffTrajectories: any[];

  // References
  gitDiffs: any[];
  docsReferences: any[];
  webReferences: any[];
  aiWebSearchResults: any[];
  relevantFiles: any[];

  // Execution
  interpreterResults: any[];

  // Media
  images: any[];

  // State
  notepads: any[];
  capabilities: any[];
  capabilityStatuses: CapabilityStatuses;
  capabilityContexts: any[];

  // Lint errors
  multiFileLinterErrors: any[];

  // History
  recentLocationsHistory: any[];
  recentlyViewedFiles: any[];

  // Flags
  isAgentic: boolean;
  isQuickSearchQuery: boolean;
  isRefunded: boolean;
  isNudge?: boolean;
  skipRendering?: boolean;
  isPlanExecution?: boolean;

  // Terminal
  existedSubsequentTerminalCommand: boolean;
  existedPreviousTerminalCommand: boolean;

  // Changes
  humanChanges: any[];
  attachedHumanChanges?: boolean;
  deletedFiles: any[];

  // Composers
  summarizedComposers: any[];

  // Rules
  cursorRules: any[];

  // Context
  contextPieces: any[];
  editTrailContexts: any[];

  // Thinking
  allThinkingBlocks: any[];
  thinking?: ThinkingBlock;
  thinkingStyle?: number;
  thinkingDurationMs?: number;

  // Tools
  supportedTools?: number[];
  editToolSupportsSearchAndReplace?: boolean;

  // Token counting
  tokenCount: {
    inputTokens: number;
    outputTokens: number;
  };

  // UI
  consoleLogs: any[];
  uiElementPicked: any[];

  // Knowledge
  knowledgeItems: any[];
  documentationSelections: any[];
  externalLinks: any[];

  // Settings
  useWeb: boolean;
  projectLayouts: any[];
  unifiedMode: number;

  // Todos
  todos: any[];

  // MCP
  mcpDescriptors: any[];

  // Workspace
  workspaceUris: string[];
  workspaceProjectDir?: string;

  // Model info
  modelInfo: {
    modelName: string;
  };

  // Request tracking
  requestId: string;
  serverBubbleId?: string;
  usageUuid?: string;

  // Checkpoints
  checkpointId?: string;

  // Context
  context?: BubbleContext;

  // Timing
  timingInfo?: {
    clientStartTime: number;
    clientRpcSendTime: number;
    clientSettleTime: number;
    clientEndTime: number;
  };
}
```

## Status Values

The `status` field in `toolFormerData` can have these values:
- `"loading"` - Tool is currently executing
- `"completed"` - Tool finished successfully
- `"cancelled"` - Tool was cancelled by user
- `"error"` - Tool execution failed

The `additionalData.status` can also have:
- `"success"` - Execution succeeded
- `"error"` - Execution failed
- `"loading"` - Still executing

## Key Observations

1. **Tool bubbles are assistant messages** with `type: 2` and `capabilityType: 15`

2. **The `toolFormerData` object is essential** - without it, the UI won't render the tool call properly

3. **Both `rawArgs` and `params` are needed** - `rawArgs` contains the original model arguments, `params` contains the normalized/processed version

4. **Results are JSON strings** - The `result` field contains a stringified JSON object with tool-specific structure

5. **User approval is tracked** via `userDecision` and `additionalData.reviewData`

6. **Tool index matters** for parallel tool calls - `toolIndex` indicates the order within a single model response

7. **Model call ID groups tools** - `modelCallId` links all tool calls from the same model response

## Database Location

The SQLite database is located at:
```
~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
```

Tables:
- `ItemTable` - General VS Code state
- `cursorDiskKV` - Cursor-specific data including bubbles

## Related Documentation

- [Cursor Chat Rendering System](./cursor-chat-rendering-system.md) - How Cursor renders these bubbles in the UI, component hierarchy, and how to add new tool types
- [Cursor Chat Data Flow](./cursor-chat-data-flow.md) - How data flows through the chat system
