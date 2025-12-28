# Cursor Decompilation Findings

## Successfully Extracted
Cursor's source code has been successfully extracted to: `cursor-decompiled/`

## Key Discovery: Composer Input Placeholder

**Location:** `/cursor-decompiled/out/vs/workbench/workbench.desktop.main.js:12154`

**Placeholder Text Found:**
```
"Plan, @ for context, / for commands"
```

### Context
This placeholder appears in the Composer UI's input field and is part of the prompt bar implementation. The surrounding code shows:

1. **Plan Mode Support** - The system supports different modes including "Plan" mode
2. **Context System** - The `@` symbol is used for adding context (files, selections, etc.)
3. **Commands** - The `/` symbol triggers slash commands
4. **Multi-mode Input** - The input supports different submission modes (chat, plan, quick question)

### Related Code Structures

**Mode Types Found:**
- `edit_selection` - Edit selected code
- `send_to_chat` - Send to chat mode
- `quick_question` - Quick Q&A mode
- Plan mode with To-dos tracking

**Context Session:**
- Uses `contextSessionUuid` for tracking context
- Supports file URIs, selections, commits, docs, images
- Has reranking endpoint support

**Key Variables:**
```javascript
J==="send_to_chat" // Switch to chat mode
J==="quick_question" // Quick question mode
xh=true // Chat mode flag
```

## Architecture Insights

### Technology Stack
- **Framework:** Electron (VSCode fork)
- **Version:** Cursor 2.2.43
- **Base:** VSCode 1.105.1
- **Packaging:** Unpacked (not in .asar)

### API Endpoints (from product.json)
```json
{
  "updateUrl": "https://api2.cursor.sh/updates",
  "statsigClientKey": "client-Bm4HJ0aDjXHQVsoACMREyLNxm5p6zzuzhO50MgtoT5D",
  "statsigLogEventProxyUrl": "https://api3.cursor.sh/tev1/v1"
}
```

### Extension Replacements
Cursor replaces several VSCode extensions:
- Pylance → Cursorpyright
- C++ Tools → Anysphere C++ Tools
- C# → Anysphere C#
- Remote SSH → Anysphere Remote SSH

## File Structure

```
cursor-decompiled/
├── out/
│   ├── main.js (1.2MB) - Main application logic
│   ├── cli.js (210KB) - CLI interface
│   └── vs/workbench/
│       └── workbench.desktop.main.js - UI components including composer
├── extensions/ (108 items) - VSCode extensions
├── node_modules/ (207 modules)
├── package.json
└── product.json - Configuration & API endpoints
```

## Composer Features Discovered

### Input Modes
1. **Standard Chat** - Default conversation mode
2. **Plan Mode** - Create structured plans with to-dos
3. **Quick Question** - Fast Q&A without full conversation
4. **Edit Selection** - Direct code editing

### Context System (`@`)
- File references
- Code selections
- Git commits
- Documentation
- Images
- Web search results

### Commands (`/`)
- Slash commands for special actions
- Custom composer commands
- Model switching
- Mode changes

### Smart Features
- Voice input with keyword triggers ("submit", "kachow", "guacamole")
- Auto-submit on keywords
- Best-of-N model selection
- Usage tracking and limits
- MCP (Model Context Protocol) support

## Next Steps for Analysis

To modify the placeholder text "Plan, @ for context, / for commands":
1. The string appears in the minified workbench.desktop.main.js
2. Would need to either:
   - Find the source TypeScript/JavaScript before compilation
   - Modify the compiled file (requires understanding webpack bundling)
   - Use string replacement with careful validation

## Notes
- Code is minified JavaScript (not TypeScript source)
- No source maps available for debugging
- Heavy use of observables and reactive patterns
- VSCode architecture with Cursor-specific modifications
