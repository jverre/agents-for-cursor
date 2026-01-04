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

## Related Documentation

- [Cursor Tool Bubble Format](./cursor-tool-bubble-format.md) - Data format for tool call bubbles in the database
- [Cursor Chat Data Flow](./cursor-chat-data-flow.md) - How data flows through the chat system
- [Agent Client Protocol](./agent-client-protocol.md) - Protocol for external agents
