# Cursor Chat Rendering System

This document describes how Cursor renders chat messages in the composer/AI chat panel. Understanding this system is essential for patching or extending the chat UI.

**Source file:** `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`

> **Note:** Line numbers reference the beautified version of the minified file. In the actual minified file, these will be on different lines but the function/variable names remain the same.

## Overview

Cursor uses a component-based rendering system built on SolidJS. Messages are rendered based on:
1. **Message type** - Human vs AI
2. **Capability type** - Plain text, thinking, tool calls, etc.
3. **Tool type** - Specific tool being executed (for tool call bubbles)

## Component Call Hierarchy

```
UI Entry Points (Composer views)
    │
    ├── Line ~998879: Panel/Sidebar composer view
    ├── Line ~1216631: Editor inline composer
    ├── Line ~1217277: Another editor view
    └── Line ~1241403: "Bar" location (floating bar)
            │
            ▼
        mks(i) — Main messages container component (line ~978945)
            │
            │   Creates scrollable container with J3c.Provider context
            │   Sets up message virtualization, scrolling, keyboard nav
            │
            ▼
        eUc(i) — Human-AI pair container (line ~980499)
            │
            │   Renders each conversation "pair" (human message + AI responses)
            │   Handles nudges (follow-up messages)
            │
            ├── Jnf(i) — AI message group component (line ~978266)
            │       Renders grouped AI messages (tool calls, thinking, etc.)
            │
            └──► fks(i) — Individual message bubble (line ~977806)
                    │
                    │   Sets data-message-role="human"|"ai"
                    │   Sets data-message-kind="human"|"thinking"|"tool"|"assistant"
                    │   Sets data-message-id, data-message-index, etc.
                    │
                    └── Renders actual message content (text, tools, thinking)
```

## Data Attributes on Message Bubbles

Each message bubble DOM element has several data attributes set by `fks()`:

| Attribute | Source | Values | Purpose |
|-----------|--------|--------|---------|
| `data-message-role` | `A()` (line ~977879) | `"human"`, `"ai"` | Identifies message sender |
| `data-message-kind` | `M()` (line ~977880) | `"human"`, `"thinking"`, `"tool"`, `"background-composer"`, `"assistant"` | More granular classification |
| `data-message-id` | `H().bubbleId` | UUID string | Unique bubble identifier |
| `data-message-index` | `o()` | Number | Position in conversation |
| `data-server-bubble-id` | `H().serverBubbleId` | UUID string | Server-side bubble ID |

### Role Determination (line ~977879)

```javascript
A = ve(() => (r()?.type === Va.HUMAN ? "human" : "ai"))
```

- Returns `"human"` if message type is `Va.HUMAN` (value: 1)
- Returns `"ai"` otherwise (type value: 2)

### Message Kind Determination (lines ~977880-977892)

```javascript
M = ve(() => {
  if (A() === "human") return "human";
  switch (r()?.capabilityType) {
    case $s.THINKING:           return "thinking";
    case $s.TOOL_FORMER:        return "tool";
    case $s.BACKGROUND_COMPOSER: return "background-composer";
    default:                    return "assistant";
  }
})
```

## Component Rendering Decision Tree

The `fks()` function (lines ~978015-978163) determines which component to render:

```
Message to render
    │
    ├─► Is it a HUMAN message? (a() === true)
    │       │
    │       ├─► Is it a simulated message? (B() === true)
    │       │       └─► Render nothing special (just container)
    │       │
    │       └─► Normal human message
    │               └─► Render: hno (Human message bubble)
    │
    └─► Is it an AI message? (a() === false)
            │
            ├─► Has capabilityType? (H().capabilityType exists)
            │       │
            │       └─► Get renderer from capability:
            │           composerDataService.getComposerCapability(handle, capabilityType)
            │               .renderAIBubble()
            │
            │           Returns component based on capability type:
            │           ┌─────────────────────┬──────────────────────────────────┐
            │           │ Capability Type     │ Component                        │
            │           ├─────────────────────┼──────────────────────────────────┤
            │           │ $s.TOOL_FORMER (15) │ Smo (line ~1219730)              │
            │           │                     │ Tool call bubbles (terminal,     │
            │           │                     │ file edits, etc.)                │
            │           ├─────────────────────┼──────────────────────────────────┤
            │           │ $s.THINKING (30)    │ umo (line ~1203287)              │
            │           │                     │ Extended thinking display        │
            │           ├─────────────────────┼──────────────────────────────────┤
            │           │ $s.SUMMARIZATION(22)│ L8f                              │
            │           │                     │ Summarization bubble             │
            │           └─────────────────────┴──────────────────────────────────┘
            │
            └─► No capabilityType (plain AI text response)
                    └─► Render: Ktf (line ~978082)
                        Standard AI text message with markdown
```

## Capability Types ($s enum)

Defined at line ~159810:

| ID | Name | Description |
|----|------|-------------|
| 0 | UNSPECIFIED | Default/unspecified |
| 15 | TOOL_FORMER | Tool call execution |
| 21 | BACKGROUND_COMPOSER | Background agent |
| 22 | SUMMARIZATION | Conversation summarization |
| 30 | THINKING | Extended thinking/reasoning |
| ... | ... | (see full list in source) |

## Tool Types (bt enum)

Defined at line ~147354:

| ID | Name | Description |
|----|------|-------------|
| 0 | UNSPECIFIED | Generic/unspecified |
| 5 | READ_FILE | Read file (legacy) |
| 6 | LIST_DIR | List directory (legacy) |
| 7 | EDIT_FILE | Edit file (legacy) |
| 11 | DELETE_FILE | Delete file |
| 15 | RUN_TERMINAL_COMMAND_V2 | Terminal command |
| 18 | WEB_SEARCH | Web search |
| 19 | MCP | MCP tool call |
| 34 | TODO_READ | Read todo list |
| 35 | TODO_WRITE | Write todo list |
| 38 | EDIT_FILE_V2 | Edit file (current) |
| 39 | LIST_DIR_V2 | List directory (current) |
| 40 | READ_FILE_V2 | Read file (current) |
| 41 | RIPGREP_RAW_SEARCH | Grep search |
| 42 | GLOB_FILE_SEARCH | File pattern search |
| 49 | CALL_MCP_TOOL | Call MCP tool |
| 51 | ASK_QUESTION | Ask user question |
| 53 | GENERATE_IMAGE | Image generation |
| 54 | COMPUTER_USE | Computer use |
| 55 | WRITE_SHELL_STDIN | Write to shell stdin |

## Tool Bubble Rendering (Smo component)

The `Smo` component (line ~1219730) renders all tool call bubbles. It uses conditional rendering based on tool type:

```javascript
// Pattern used for each tool type (line ~1220095+)
U(cr, {
  get when() {
    return P(bt.TOOL_TYPE);  // P() checks if current bubble is this tool type
  },
  children: (ze) => {
    // Render tool-specific UI
  },
})
```

### Tool Type to UI Mapping

| Tool Type | Check Location | UI Component |
|-----------|----------------|--------------|
| `bt.EDIT_FILE` / `bt.EDIT_FILE_V2` | ~1220095 | File diff editor |
| `bt.READ_FILE_V2` | ~1220242 | File content viewer |
| `bt.RUN_TERMINAL_COMMAND_V2` | ~1220313 | Terminal output |
| `bt.RIPGREP_RAW_SEARCH` | ~1220660 | Search results |
| `bt.GLOB_FILE_SEARCH` | ~1220872 | File list |
| `bt.FILE_SEARCH` | ~1220919 | File search results |
| `bt.DELETE_FILE` | ~1221079 | Delete confirmation |
| `bt.WEB_SEARCH` | ~1221139 | Web search results |
| `bt.TODO_READ` | ~1221720 | Todo list display |
| `bt.TODO_WRITE` | ~1221742 | Todo list editor |
| `bt.GENERATE_IMAGE` | ~1221893 | Image display |
| `bt.ASK_QUESTION` | ~1222229 | User question UI |
| `bt.COMPUTER_USE` | ~1222254 | Computer use display |

## Tool Verb Labels (pN function)

The `pN()` function (line ~961681) provides loading/completed verb text for each tool:

```javascript
function pN(i, e) {
  switch (i) {
    case bt.READ_FILE:
      return ["Reading", "Read", "Read"];
    case bt.RUN_TERMINAL_COMMAND_V2:
      return ["Running command", "Ran command", "Run command"];
    case bt.TODO_WRITE:
      return ["Updating todos", "Updated todos", "Update todos"];
    // ... etc
  }
}
```

Returns array: `[loadingVerb, completedVerb, actionVerb]`

---

## Adding a New Tool Type Bubble

To add a new tool type (e.g., ID=90), you need to patch these locations:

### 1. Tool Type Enum (bt) — Line ~147400

Add the new tool type to the enum:

```javascript
(i[(i.MY_NEW_TOOL = 90)] = "MY_NEW_TOOL")
```

### 2. Verb Labels (pN function) — Line ~961681

Add a case for loading/completed text:

```javascript
case bt.MY_NEW_TOOL:
  return ["Processing", "Processed", "Process"];
```

### 3. Tool Renderer in Smo — Lines ~1220095-1222285

Add a new conditional block to render your tool's UI:

```javascript
U(cr, {
  get when() {
    return P(bt.MY_NEW_TOOL);
  },
  children: (ze) => {
    const ut = ze();
    if (!ut) return null;
    const [_t, nt] = pN(bt.MY_NEW_TOOL);
    return U(YourToolComponent, {
      get isInGroup() {
        return i.isInGroup;
      },
      get isLoading() {
        return ut.status === "loading";
      },
      loadingVerb: _t,
      completedVerb: nt,
      params: ut.params,
      result: ut.result,
    });
  },
}),
```

### 4. (Optional) Tool Icons — Line ~316473

Add icon mapping:

```javascript
[$s.TOOL_FORMER]: {
  // ...existing tools...
  [bt.MY_NEW_TOOL]: de.yourIcon,
}
```

### 5. (Optional) Tool Display Names — Line ~316511

Add display name:

```javascript
[$s.TOOL_FORMER]: {
  // ...existing tools...
  [bt.MY_NEW_TOOL]: "My New Tool",
}
```

### Summary of Patch Locations

| What | Line | Purpose |
|------|------|---------|
| `bt` enum | ~147400 | Register tool type ID |
| `pN()` switch | ~961681 | Loading/completed verbs |
| `Smo` component | ~1220095 | Render the tool bubble UI |
| Tool icons map | ~316473 | (Optional) Icon mapping |
| Tool names map | ~316511 | (Optional) Display name |

---

## Key Components Summary

| Component | Line | Purpose |
|-----------|------|---------|
| `mks` | ~978945 | Main messages container |
| `eUc` | ~980499 | Human-AI pair container |
| `Jnf` | ~978266 | AI message group |
| `fks` | ~977806 | Individual message bubble |
| `hno` | - | Human message bubble |
| `Ktf` | ~978082 | Plain AI text response |
| `Smo` | ~1219730 | Tool call bubbles (TOOL_FORMER) |
| `umo` | ~1203287 | Thinking/reasoning display |

## Key Services

| Service | Purpose |
|---------|---------|
| `composerDataService` | Manages composer/chat data |
| `getComposerCapability()` | Retrieves capability renderer |
| `getComposerBubble()` | Gets bubble data by ID |
| `getToolFormer()` | Gets TOOL_FORMER capability |

## DOM Structure

```html
<div class="composer-messages-container" tabindex="0">
  <!-- For each message pair -->
  <div class="composer-human-ai-pair-container">
    <!-- Human message -->
    <div class="composer-rendered-message"
         data-message-role="human"
         data-message-kind="human"
         data-message-id="uuid"
         data-message-index="0">
      <!-- hno component content -->
    </div>

    <!-- AI message(s) -->
    <div class="composer-rendered-message"
         data-message-role="ai"
         data-message-kind="assistant"
         data-message-id="uuid"
         data-message-index="1">
      <!-- Ktf or capability-specific component -->
    </div>

    <!-- Tool call bubble -->
    <div class="composer-rendered-message"
         data-message-role="ai"
         data-message-kind="tool"
         data-message-id="uuid"
         data-message-index="2"
         data-tool-call-id="toolcall-uuid"
         data-tool-status="completed">
      <!-- Smo component with tool-specific UI -->
    </div>
  </div>
</div>
```

## CSS Classes

Key CSS classes for styling:

| Class | Purpose |
|-------|---------|
| `.composer-messages-container` | Main scrollable container |
| `.composer-human-ai-pair-container` | Wraps human+AI message pair |
| `.composer-rendered-message` | Individual message bubble |
| `.composer-message-group` | Grouped messages container |
| `.composer-grouped-toolformer-message` | Grouped tool messages |
| `.composer-human-message-nudge` | Nudge/follow-up styling |
| `.message-content-animated` | Entry animation |

---

## Tool Approval & Permission System

Cursor implements a sophisticated **hooks-based permission system** that controls tool execution through external scripts. This allows users to approve, deny, or automatically allow tool calls.

### Hook Types

Defined in the `kb` namespace (fY namespace in workbench):

```javascript
kb = {
  // Tool execution hooks
  beforeShellExecution: "beforeShellExecution",
  beforeMCPExecution: "beforeMCPExecution",
  afterShellExecution: "afterShellExecution",
  afterMCPExecution: "afterMCPExecution",

  // File operation hooks
  beforeReadFile: "beforeReadFile",
  afterFileEdit: "afterFileEdit",
  beforeTabFileRead: "beforeTabFileRead",
  afterTabFileEdit: "afterTabFileEdit",

  // Chat flow hooks
  beforeSubmitPrompt: "beforeSubmitPrompt",
  afterAgentResponse: "afterAgentResponse",
  afterAgentThought: "afterAgentThought",
  stop: "stop"
}
```

### Permission Values

Hooks return a response object with a `permission` field:

| Value | Behavior | Description |
|-------|----------|-------------|
| `"allow"` | Auto-run | Tool executes immediately without user approval |
| `"deny"` | Block | Tool execution is prevented |
| `"ask"` | Prompt | UI shows approval dialog (Ask Every Time mode) |
| `undefined` | Default | Falls back to default permission setting |

### Hook Response Formats

#### Command Execution Hooks

For `beforeShellExecution` and `beforeMCPExecution`:

```typescript
interface CommandExecutionResponse {
  permission?: "allow" | "deny" | "ask";
  user_message?: string;    // Message shown to user in UI
  agent_message?: string;   // Message sent to AI agent
}
```

**Validator**: `wro` (out-build/vs/base/common/hooks/validators/beforeCommandExecutionHookResponse.js)

#### File Read Hooks

For `beforeReadFile` and `beforeTabFileRead`:

```typescript
interface FileReadResponse {
  permission?: "allow" | "deny";  // Only allow or deny
}
```

**Validator**: `WOc` and `HOc`

#### Other Hook Responses

- **afterFileEdit**, **afterTabFileEdit**: Base response object (no permission field)
- **beforeSubmitPrompt**: Includes `continue?: boolean` and `user_message?: string`
- **stop**: Includes `followup_message?: string`

### Tool Review Service

Located in workbench at the review model cache implementation:

```javascript
// Tools that skip review (auto-approved)
if (r.tool === bt.MCP || r.tool === bt.CALL_MCP_TOOL || r.tool === bt.ACP_TOOL) {
  const o = new vdt(n, t);
  return this._reviewModelCache.set(t, o), o;
}
```

**Key observations:**
- MCP tools (types 19, 49) skip the review model
- ACP tools (type 90) skip the review model
- These tools still respect hook responses but don't show approval UI by default
- The `vdt` class manages the review state for tools requiring approval

### Approval Flow States

Tools progress through these states during execution:

```
1. Tool Call Initiated
   ├─► Hook Called (e.g., beforeShellExecution)
   │
   ├─► Hook Returns Permission
   │   │
   │   ├─► "allow" → status: "loading" (immediate execution)
   │   ├─► "deny"  → status: "error" (blocked)
   │   └─► "ask"   → status: "pending" (awaiting approval)
   │
   ├─► User Approves/Rejects (if "ask")
   │   │
   │   ├─► Approve → status: "loading"
   │   └─► Reject  → status: "error"
   │
   ├─► Tool Executes
   │   └─► status: "loading"
   │
   └─► Tool Completes
       ├─► Success → status: "completed"
       └─► Failure → status: "error"
```

### Tool Status Values

| Status | Meaning | UI Rendering |
|--------|---------|--------------|
| `"loading"` | Tool is executing | Shows loading spinner, verb text (e.g., "Running command...") |
| `"completed"` | Tool finished successfully | Shows result, completed verb (e.g., "Ran command") |
| `"error"` | Tool failed or was denied | Shows error message in red |
| `"pending"` | Awaiting user approval | Shows approve/reject buttons |

### The ASK_QUESTION Tool

**Type 51** (`bt.ASK_QUESTION`) is a special tool that implements interactive approval:

```javascript
// Tool parameters
{
  title: string,
  questions: [{
    id: string,
    prompt: string,
    allowMultiple: boolean,
    options: [{
      id: string,
      label: string
    }]
  }]
}
```

**Rendering** (line ~1222229):
- Displays interactive UI with question prompt
- Shows option buttons for user selection
- Supports multi-select mode via `allowMultiple`
- Returns user's selection as tool result
- AI continues execution based on answer

### Hook Integration with Rendering

The rendering pipeline checks tool status to determine UI:

```javascript
// In Smo component (tool bubble renderer)
get isLoading() {
  return Ze().status === "loading";
}

// Conditional rendering based on status
if (status === "pending") {
  // Show approval buttons
} else if (status === "loading") {
  // Show loading spinner + verb
} else if (status === "error") {
  // Show error message
} else {
  // Show completed result
}
```

### Approval UI Components

When `status === "pending"`, tools render approval UI:

1. **Command Preview**: Shows the command/tool parameters
2. **User Message**: Displays `user_message` from hook response
3. **Action Buttons**:
   - "Accept" / "Approve" - Sets status to "loading", executes tool
   - "Reject" / "Deny" - Sets status to "error", blocks tool
4. **Remember Choice**: Option to update permission setting

### Settings Integration

User settings control default hook behavior:

- **Always Allow** → Hooks return `"allow"` by default
- **Ask Every Time** → Hooks return `"ask"` by default
- **Never Allow** → Hooks return `"deny"` by default

These settings are stored per-tool-type and can be overridden by hook scripts.

---

## Complete Rendering Flow with Approvals

### Full Pipeline

```
1. AI Generates Tool Call
   │
   ▼
2. Tool Call Created (params, type, callId)
   │
   ▼
3. Before Hook Called
   ├─► beforeShellExecution (for bash)
   ├─► beforeMCPExecution (for MCP)
   ├─► beforeReadFile (for read)
   └─► (no hook for some tools)
   │
   ▼
4. Hook Returns Permission
   │
   ├─► "allow" ──────────────┐
   │                         │
   ├─► "deny" ─────► Error   │
   │                         │
   └─► "ask" ───► UI Approval│
                    │         │
                    ▼         │
                User Accepts  │
                    │         │
                    └─────────┘
                         │
                         ▼
5. Tool Execution Starts
   status: "loading"
   │
   ▼
6. Rendering Pipeline Triggered
   │
   ├─► composerDataService updates bubble
   │
   ├─► Component re-renders (Smo)
   │   │
   │   ├─► Checks tool type (P(bt.TOOL_TYPE))
   │   │
   │   ├─► Renders tool-specific UI
   │   │
   │   └─► Shows loading spinner + verb
   │
   ▼
7. Tool Completes
   status: "completed"
   result: { ... }
   │
   ▼
8. After Hook Called
   ├─► afterShellExecution
   ├─► afterMCPExecution
   └─► afterFileEdit
   │
   ▼
9. Final Render
   │
   ├─► Shows completed verb
   ├─► Displays result content
   └─► Hides loading spinner
```

### Example: Bash Command Flow

```
User: "run npm install"

1. AI: RUN_TERMINAL_COMMAND_V2 { command: "npm install" }

2. beforeShellExecution hook called
   Input: { command: "npm install", workingDirectory: "/path" }
   Output: { permission: "ask", user_message: "Allow npm install?" }

3. status: "pending"
   Renders: Approval UI with "npm install" preview

4. User clicks "Accept"
   status: "loading"

5. Rendering updates:
   - Loading spinner appears
   - Verb: "Running command..."
   - Shows "npm install" in terminal preview

6. Command executes, streams output

7. Command completes
   status: "completed"
   result: { stdout: "added 523 packages...", exitCode: 0 }

8. afterShellExecution hook called
   Input: { command: "npm install", exitCode: 0, stdout: "..." }

9. Final render:
   - Spinner disappears
   - Verb: "Ran command"
   - Full terminal output displayed
```

---

## Tool Content Rendering

Different tools render different content in their bubbles. Here's what each tool type displays:

### READ_FILE_V2 (Type 40)

**Parameters**:
```javascript
{
  path: string,
  offset?: number,
  limit?: number,
  charsLimit: number
}
```

**Result**:
```javascript
{
  output: string,           // File contents
  isEmpty: boolean,
  exceededLimit: boolean,   // Truncated
  totalLines: number,
  fileSize: number,
  path: string
}
```

**Rendered Content**:
- File path header
- Syntax-highlighted code viewer
- Line numbers
- "Truncated" indicator if exceededLimit
- Total lines / file size info

#### CRITICAL: Tool Data Format

**DO NOT stringify params or result!** Cursor expects these as **objects**, not JSON strings.

**CORRECT ✅**:
```javascript
toolFormerData: {
  tool: 40,
  toolCallId: 'abc123',
  status: 'loading',
  name: 'read_file',
  params: {                          // OBJECT, not string
    targetFile: '/path/to/file.ts',
    effectiveUri: 'file:///path/to/file.ts',
    limit: 1000,
    charsLimit: 100000
  },
  rawArgs: {                         // OBJECT, not string
    target_file: '/path/to/file.ts',
    limit: 1000,
    offset: 0
  },
  result: {                          // OBJECT, not string
    contents: 'file contents here...',
    numCharactersInRequestedRange: 884,
    totalLinesInFile: 29
  }
}
```

**INCORRECT ❌**:
```javascript
toolFormerData: {
  tool: 40,
  // ...
  params: JSON.stringify({...}),     // WRONG - stringified
  result: JSON.stringify({...})      // WRONG - stringified
}
```

**Why this matters**:
- Cursor's SolidJS components access fields directly (e.g., `params.targetFile`)
- Stringified data causes `undefined` access errors
- The READ_FILE_V2 renderer won't display file content if result is a string
- This applies to ALL tool types, not just READ_FILE_V2

**URI Format**:
- `effectiveUri` must be: `'file://' + absolutePath`
- For Unix paths starting with `/`: becomes `file:///path` (three slashes total)
- For Windows paths: `file:///C:/path`

**Field Name Mapping** (ACP → Cursor):
- ACP sends `file_path`, Cursor expects `target_file` in rawArgs
- params uses `targetFile` (camelCase)
- effectiveUri must include `file://` prefix

### EDIT_FILE_V2 (Type 38)

**Parameters**:
```javascript
{
  path: string,
  oldString: string,
  newString: string,
  replaceAll?: boolean
}
```

**Result**:
```javascript
{
  success: boolean,
  error?: string,
  appliedEdits: number
}
```

**Rendered Content**:
- File path header
- Diff viewer (Monaco diff editor)
  - Red lines: oldString removed
  - Green lines: newString added
- "X edits applied" counter
- Error message if failed

### RUN_TERMINAL_COMMAND_V2 (Type 15)

**Parameters**:
```javascript
{
  command: string,
  workingDirectory?: string
}
```

**Result**:
```javascript
{
  stdout: string,
  stderr: string,
  exitCode: number
}
```

**Rendered Content**:
- Command string in code block
- Terminal output viewer
  - stdout in white
  - stderr in red
- Exit code indicator
- Working directory path

### RIPGREP_RAW_SEARCH (Type 41)

**Parameters**:
```javascript
{
  pattern: string,
  path?: string,
  glob?: string,
  outputMode: "content" | "files_with_matches" | "count",
  contextBefore?: number,
  contextAfter?: number,
  caseInsensitive?: boolean,
  type?: string
}
```

**Result**:
```javascript
{
  matches: [{
    file: string,
    line: number,
    content: string,
    matchStart: number,
    matchEnd: number
  }],
  totalMatches: number
}
```

**Rendered Content**:
- Search pattern header
- List of matches grouped by file
- Each match shows:
  - File path (clickable)
  - Line number
  - Highlighted match in context
- Total matches count

### GLOB_FILE_SEARCH (Type 42)

**Parameters**:
```javascript
{
  globPattern: string,
  targetDirectory?: string
}
```

**Result**:
```javascript
{
  files: string[],
  totalFiles: number
}
```

**Rendered Content**:
- Glob pattern header
- File tree/list view
- Clickable file paths
- Total files count
- Directory structure indicators

### TODO_WRITE (Type 35)

**Parameters**:
```javascript
{
  todos: [{
    content: string,
    status: "pending" | "in_progress" | "completed",
    activeForm: string
  }]
}
```

**Result**:
```javascript
{
  success: boolean,
  updatedTodos: [...]
}
```

**Rendered Content**:
- Todo list with checkboxes
- Status indicators:
  - ⭘ Pending (empty circle)
  - ◐ In Progress (half circle)
  - ✓ Completed (checkmark)
- Task content (clickable)
- Progress bar

### ASK_QUESTION (Type 51)

**Parameters**:
```javascript
{
  title: string,
  questions: [{
    id: string,
    prompt: string,
    allowMultiple: boolean,
    options: [{
      id: string,
      label: string
    }]
  }]
}
```

**Result**:
```javascript
{
  answers: {
    [questionId]: string | string[]
  }
}
```

**Rendered Content**:
- Question title
- Question prompt text
- Option buttons (single or multi-select)
- Selected answers highlighted
- Submit button (if not auto-submitted)

### WEB_SEARCH (Type 18)

**Parameters**:
```javascript
{
  searchTerm: string
}
```

**Result**:
```javascript
{
  results: [{
    title: string,
    url: string,
    snippet: string
  }],
  totalResults: number
}
```

**Rendered Content**:
- Search term header
- Result cards:
  - Title (clickable link)
  - URL
  - Snippet preview
- "Show more" pagination
- Total results count

### MCP / CALL_MCP_TOOL (Types 19, 49)

**Parameters**:
```javascript
{
  toolName: string,
  serverName: string,
  args: { [key: string]: any }
}
```

**Result**:
```javascript
{
  content: string | object,
  isError: boolean
}
```

**Rendered Content**:
- Tool name + server badge
- Input arguments (collapsed JSON)
- Output content (formatted based on type)
- Error indicator if failed
- MCP server icon

### GENERATE_IMAGE (Type 53)

**Parameters**:
```javascript
{
  description: string,
  filePath: string
}
```

**Result**:
```javascript
{
  imageUrl: string,
  width: number,
  height: number
}
```

**Rendered Content**:
- Description text
- Generated image preview
- Image dimensions
- Download button
- File path link

### Tool Bubble Template Structure

All tool bubbles follow this general structure:

```html
<div class="tool-bubble" data-tool-type="TYPE_ID" data-status="STATUS">
  <!-- Header -->
  <div class="tool-header">
    <span class="tool-icon">...</span>
    <span class="tool-verb">Verb text...</span>
    <span class="tool-status-indicator">...</span>
  </div>

  <!-- Content (varies by tool type) -->
  <div class="tool-content">
    <!-- Tool-specific UI -->
  </div>

  <!-- Footer (if approval needed) -->
  <div class="tool-footer" *ngIf="status === 'pending'">
    <button class="approve">Accept</button>
    <button class="reject">Reject</button>
  </div>
</div>
```

### Status-Based Rendering

Each tool's content rendering adapts based on status:

| Status | Header | Content | Footer |
|--------|--------|---------|--------|
| `loading` | Spinner + loading verb | Partial results (streaming) | Hidden |
| `completed` | ✓ + completed verb | Full results | Hidden |
| `error` | ✗ + error text | Error message | Hidden |
| `pending` | ⏸ + "Waiting..." | Preview of action | Approve/Reject |

---

## Rendering Performance & Optimization

### Message Virtualization

The `mks` component (line ~978945) implements virtual scrolling:

- Only renders messages visible in viewport
- Maintains scroll position during updates
- Lazy-loads message content on scroll
- Recycles DOM elements for performance

### Streaming Updates

Tools with streaming results (terminal commands, thinking) use incremental rendering:

1. **Initial render**: Shows tool bubble with loading state
2. **Stream chunks**: Append to existing content (no full re-render)
3. **Completion**: Final render with full result

**Implementation**:
```javascript
// Streaming handler
onChunk(chunk) {
  this.accumulatedOutput += chunk;
  this.updateDOMDirectly(chunk);  // Append only new content
}
```

### Memoization

SolidJS components use `ve()` (reactive memoization) to avoid unnecessary re-renders:

```javascript
// Only re-computes when dependencies change
const toolStatus = ve(() => bubble().status);
const isLoading = ve(() => toolStatus() === "loading");
```

---

## Related Documentation

- [Cursor Tool Bubble Format](./cursor-tool-bubble-format.md) - Data format for tool call bubbles in the database
- [Cursor Chat Data Flow](./cursor-chat-data-flow.md) - How data flows through the chat system
- [Agent Client Protocol](./agent-client-protocol.md) - Protocol for external agents
- [Hooks System](./hooks-system.md) - Complete guide to implementing permission hooks
