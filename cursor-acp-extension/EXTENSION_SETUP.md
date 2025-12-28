# ACP Extension Installation & Packaging Guide

## Current Development Setup

### How the Extension is Currently Installed

The extension is installed via **symlink** during development:

```bash
# Create symlink from workspace to Cursor extensions folder
ln -sf /Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension \
       ~/.cursor/extensions/local.cursor-acp-extension-0.1.0
```

**Verify installation:**
```bash
ls -la ~/.cursor/extensions/local.cursor-acp-extension-0.1.0
```

After creating the symlink, **reload Cursor** (Cmd+Shift+P → "Developer: Reload Window")

### Extension Activation

The extension activates automatically on startup via `onStartupFinished` event.

**Check if extension is running:**
1. Open Developer Tools (Cmd+Shift+P → "Developer: Toggle Developer Tools")
2. Look for console messages:
   - `[ACP] HTTP server listening on http://localhost:37842`
   - `[ACP] Bridge server started on port 37842`

### How It Works

```
┌─────────────────────────────────────┐
│   Cursor Workbench (Renderer)      │
│   - Patch code runs here            │
│   - window.acpExtensionBridge       │
└──────────────┬──────────────────────┘
               │ HTTP (localhost:37842)
               ▼
┌─────────────────────────────────────┐
│   Extension Host (Node.js)          │
│   - extension.js runs here          │
│   - HTTP server on port 37842       │
│   - ACPAgentManager                 │
└──────────────┬──────────────────────┘
               │ child_process.spawn()
               ▼
┌─────────────────────────────────────┐
│   ACP Agent Subprocess              │
│   - Communicates via stdin/stdout   │
│   - JSON-RPC 2.0 protocol           │
└─────────────────────────────────────┘
```

## For End Users - Packaging Instructions

### Option 1: VSIX Package (Recommended)

**Build VSIX:**
```bash
cd cursor-acp-extension

# Install dependencies (if any added)
npm install

# Package the extension
npx vsce package

# This creates: cursor-acp-extension-0.1.0.vsix
```

**Install VSIX:**
1. In Cursor: Cmd+Shift+P → "Extensions: Install from VSIX..."
2. Select `cursor-acp-extension-0.1.0.vsix`
3. Reload Cursor

**Distribute:**
Upload `cursor-acp-extension-0.1.0.vsix` to GitHub releases or share directly.

### Option 2: Direct Folder Copy

**For users without npm/vsce:**

```bash
# 1. Copy extension folder to Cursor extensions directory
cp -r cursor-acp-extension \
      ~/.cursor/extensions/local.cursor-acp-extension-0.1.0

# 2. Reload Cursor
# Cmd+Shift+P → "Developer: Reload Window"
```

### Option 3: Publish to Marketplace (Future)

When ready for public release:

1. **Create publisher account**: https://marketplace.visualstudio.com/manage
2. **Update package.json**:
   ```json
   {
     "publisher": "your-publisher-id",
     "repository": {
       "type": "git",
       "url": "https://github.com/your-username/cursor-acp-extension"
     }
   }
   ```

3. **Publish**:
   ```bash
   npx vsce publish
   ```

## File Structure

```
cursor-acp-extension/
├── package.json           # Extension manifest
├── extension.js          # Main extension code (Node.js)
│                         # - HTTP server on port 37842
│                         # - ACPAgentManager class
│                         # - Subprocess spawning
│
├── patcher.js            # Patches Cursor workbench files
├── checksum-fixer.js     # Fixes integrity checksums
│
└── patches/              # Code injected into workbench
    ├── extension-bridge.js   # HTTP bridge (renderer → extension)
    ├── acp-service.js       # ACP provider management
    └── model-patch.js       # Model debugging helpers
```

## Dependencies

### Required (Built-in Node.js modules):
- `vscode` - VS Code Extension API
- `child_process` - Spawn ACP agent subprocesses
- `http` - HTTP server for renderer-extension communication
- `readline` - Parse JSON-RPC line-delimited messages
- `fs.promises` - File operations for patching
- `path` - Path manipulation

### Optional (for packaging):
- `@vscode/vsce` - Package extensions as VSIX

**Install packaging tools:**
```bash
npm install -g @vscode/vsce
```

## Troubleshooting

### Extension Not Loading

**Check:**
```bash
# Is extension installed?
ls -la ~/.cursor/extensions/local.cursor-acp-extension-0.1.0

# Check Cursor's extension log
# Cmd+Shift+P → "Developer: Show Extension Host Logs"
```

**Look for:**
- `cursor-acp-extension activated`
- `[ACP] HTTP server listening on http://localhost:37842`

### HTTP Server Not Starting

**Verify port 37842 is free:**
```bash
lsof -i :37842
# Should be empty, or show Cursor's extension host
```

**If port is taken:**
1. Edit `extension.js`, change port number
2. Edit `patches/extension-bridge.js`, update port number
3. Reload extension

### Patches Not Applied

**Check patch status:**
```bash
# Look for ACP comments in workbench
grep "ACP Integration" /Applications/Cursor.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.js

# Check for backup
ls -la /Applications/Cursor.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.js.backup
```

**Reapply patches:**
1. Cmd+Shift+P → "ACP: Reload"
2. Restart Cursor

### Subprocess Spawn Errors

**Common issues:**
- Command not in PATH
- Incorrect arguments
- Missing environment variables

**Debug:**
Check console for:
```
[ACP] Spawning agent: echo
[ACP] stderr: ...
```

## Security Notes

### Port 37842
- Only listens on `localhost` (not exposed to network)
- CORS enabled for `*` (only matters for localhost)
- No authentication (local communication only)

### Subprocess Execution
- Commands defined in patch code (acp-service.js)
- Runs with Cursor's user permissions
- No shell escaping needed (direct spawn, not via shell)

## Testing

### Quick Test
1. Restart Cursor
2. Check console for `[ACP] Bridge server started on port 37842`
3. Add custom model: `acp:test`
4. Send message with that model
5. Check console for:
   - `[ACP Bridge] sendMessage called`
   - `[ACP HTTP] Received request`
   - `[ACP] Spawning agent`

### Full Integration Test
Requires a real ACP agent - see test-acp-agent.js

## Future Improvements

1. **Auto-update mechanism** - Check for new versions
2. **Settings UI** - Add/remove ACP providers via GUI
3. **Provider marketplace** - Discover and install agents
4. **Subprocess lifecycle** - Better cleanup, crash recovery
5. **Streaming support** - Real-time response streaming
6. **Tool execution** - File/terminal operations via ACP protocol

## Version History

### 0.1.0 (Current)
- Initial release
- HTTP bridge for renderer-extension communication
- Basic ACP subprocess spawning
- JSON-RPC 2.0 message handling
- Test provider (echo command)
