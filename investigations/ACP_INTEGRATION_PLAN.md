# ACP Integration Plan for Cursor

## Overview
Integrate Agent Client Protocol (ACP) providers into Cursor's UI by **leveraging existing infrastructure**. Cursor already has complete ACP support via `cursor-agent-exec` - we just need to expose it to users.

## Key Insight: Reuse Existing ACP Infrastructure

**What Cursor Already Has (from ACP_INTEGRATION.md):**
- ✅ Complete ACP protocol implementation in `cursor-agent-exec` extension
- ✅ Tool execution via `LocalResourceProvider` (file, terminal, search, etc.)
- ✅ Permission system with approval dialogs
- ✅ Session management via `createSession()`
- ✅ Binary protocol support for tool calls
- ✅ MCP integration already wired up

**What We Need to Build:**
1. Spawn external ACP agent subprocesses (Claude Code, etc.)
2. Configuration UI for ACP providers
3. Add ACP providers to model selector
4. Route chat messages to ACP agent instead of Cursor backend

## Implementation Strategy: Direct File Patching

Based on research into VSCode monkey patching extensions:
- **Custom CSS and JS Loader** - Modifies `workbench.desktop.main.js` by direct injection
- **Fix Checksums** - Updates product.json checksums to prevent corruption warnings
- **APC Extension** - Patches automatically reapplied after updates

**Our Approach:**
1. Create VSCode extension that patches core files
2. Inject JavaScript into workbench to add ACP functionality
3. Fix checksums to suppress "unsupported" warnings
4. Auto-reapply patches after Cursor updates

## Architecture Components

### 1. ACP Configuration System (Mirror MCP)

**Create ACPService Class**
- Location: Extension or patched into `workbench.beautified.js`
- Mirror `MCPService` architecture (line 418036)
- Manage ACP providers from multiple sources:
  - User configured: `~/.cursor/acp-providers.json`
  - Project: `.cursor/acp-providers.json`
  - Extension registered
  - Default providers

**Storage Structure:**
```json
{
  "acpProviders": {
    "claude-code": {
      "type": "stdio",
      "command": "/path/to/claude-code",
      "args": ["--stdio"],
      "env": {},
      "displayName": "Claude Code",
      "capabilities": {
        "supportsAgent": true,
        "supportsImages": true,
        "supportsThinking": true
      }
    }
  }
}
```

**Reactive Storage Keys:**
- `applicationUserPersistentStorage.acpProviders` - List of configured providers
- `applicationUserPersistentStorage.disabledAcpProviders` - Disabled provider identifiers
- `applicationUserPersistentStorage.acpProviderStatus` - Connection status per provider

### 2. Model Selector Integration

**Register ACP Providers as Models**
- Patch `ModelConfigService` (line 216345)
- Add ACP providers to `availableDefaultModels2`
- Set model capabilities based on ACP provider metadata

**Model Entry Structure:**
```javascript
{
  name: "acp:claude-code",  // Prefix with "acp:" to identify
  clientDisplayName: "Claude Code (ACP)",
  serverModelName: "acp:claude-code",
  isACPProvider: true,  // Flag to identify ACP models
  acpProviderId: "claude-code",

  // Capabilities from ACP provider config
  supportsAgent: true,
  supportsMaxMode: true,
  supportsNonMaxMode: true,
  supportsThinking: true,
  supportsImages: true,
  defaultOn: false
}
```

**Integration Points:**
- Patch `getAvailableModelsReactiveWithStatus()` (line 257589) to include ACP providers
- Add ACP models to model dropdown UI
- Store selection in `aiSettings.modelConfig.composer`

### 3. Message Routing to ACP (Simplified!)

**Primary Interception Point:**
- Location: `LanguageModelProvider.$registerLanguageModelChat()` at line 761781
- Method: Patch `sendChatRequest()` function

**Simplified Strategy - Leverage cursor-agent-exec:**
```javascript
// Patch sendChatRequest in LanguageModelProvider
sendChatRequest: async (messages, options, token, cancellation) => {
    const modelName = options.model || currentModelConfig.modelName;

    // Check if this is an ACP provider
    if (modelName.startsWith('acp:')) {
        const acpProviderId = modelName.replace('acp:', '');

        // Use existing cursor-agent-exec infrastructure!
        const agentExecService = vscode.cursor.getAgentExecService();
        const session = await agentExecService.createSession(
            sessionId,
            approvalHandler,
            elicitationHandler,
            { acpProviderId }  // Pass ACP provider config
        );

        return await streamACPSession(session, messages, options);
    }

    // Otherwise, use normal Cursor backend
    return await originalSendChatRequest(messages, options, token, cancellation);
}
```

**Key Simplification:**
Instead of implementing ACP protocol from scratch, **spawn the ACP agent and let cursor-agent-exec handle everything**:
1. The ACP agent subprocess handles AI model calls
2. When agent needs tools, it requests via ACP protocol
3. cursor-agent-exec executes tools locally (already implemented!)
4. Results flow back to ACP agent
5. Agent responses stream to UI

**Minimal Message Conversion:**
```javascript
// Just extract latest user message and workspace context
const latestMessage = messages[messages.length - 1].text;
const workspaceRoot = vscode.workspace.rootPath;

// Send to ACP agent via stdio (JSON-RPC)
acpProcess.stdin.write(JSON.stringify({
    "jsonrpc": "2.0",
    "method": "session/prompt",
    "params": {
        "sessionId": sessionId,
        "message": { "type": "text", "text": latestMessage }
    }
}));

// Stream responses back
acpProcess.stdout.on('data', (response) => {
    const update = JSON.parse(response);
    if (update.method === 'session/update') {
        stream.emitOne({ text: update.params.update.text });
    }
});
```

### 4. Direct File Patching Approach

**Use Custom CSS and JS Loader Pattern:**
Similar to `vscode-custom-css` extension, we'll create a VSCode extension that:
1. Injects JavaScript into `workbench.desktop.main.js`
2. Patches specific functions to add ACP support
3. Fixes checksums to prevent corruption warnings
4. Auto-reapplies after Cursor updates

**Extension Structure:**
```
cursor-acp-extension/
├── package.json          # VSCode extension manifest
├── extension.js          # Main extension logic
├── patcher.js            # File patching utilities
├── checksum-fixer.js     # Checksum update logic
└── patches/
    ├── acp-service.js    # ACP provider management
    ├── model-patch.js    # Model selector integration
    └── chat-patch.js     # Chat routing to ACP
```

**Patch Injection Code:**
```javascript
// patcher.js - Inject code into workbench
const fs = require('fs');
const path = require('path');

function injectACPSupport() {
    const workbenchPath = path.join(
        vscode.env.appRoot,
        'out/vs/workbench/workbench.desktop.main.js'
    );

    // Read existing workbench
    let content = fs.readFileSync(workbenchPath, 'utf8');

    // Inject ACP service code at the end
    const acpServiceCode = fs.readFileSync('./patches/acp-service.js', 'utf8');
    const modelPatchCode = fs.readFileSync('./patches/model-patch.js', 'utf8');
    const chatPatchCode = fs.readFileSync('./patches/chat-patch.js', 'utf8');

    content += `\n// ACP Integration\n${acpServiceCode}\n${modelPatchCode}\n${chatPatchCode}`;

    // Backup original
    fs.writeFileSync(workbenchPath + '.backup', content);

    // Write patched version
    fs.writeFileSync(workbenchPath, content);
}
```

**Checksum Fixing:**
```javascript
// checksum-fixer.js
const crypto = require('crypto');
const productPath = path.join(vscode.env.appRoot, 'product.json');

function fixChecksums() {
    const product = JSON.parse(fs.readFileSync(productPath, 'utf8'));

    // Calculate new checksum for modified workbench
    const workbenchPath = 'out/vs/workbench/workbench.desktop.main.js';
    const content = fs.readFileSync(path.join(vscode.env.appRoot, workbenchPath));
    const checksum = crypto.createHash('md5').update(content).digest('hex');

    // Update product.json checksums
    product.checksums[workbenchPath] = checksum;

    fs.writeFileSync(productPath, JSON.stringify(product, null, '\t'));
}
```

### 5. Implementation Steps (Simplified!)

**Phase 1: Create Extension Structure**
1. Create extension directory: `cursor-acp-extension/`
2. Set up `package.json` with activation events and commands:
   - `acp.enable` - Apply patches
   - `acp.disable` - Remove patches
   - `acp.reload` - Reapply patches
3. Implement `extension.js` with activation logic

**Phase 2: Build File Patcher**
1. Create `patcher.js` with injection logic
2. Locate workbench file: `out/vs/workbench/workbench.desktop.main.js`
3. Create backup before modifications
4. Append patch code to end of workbench file
5. Implement `checksum-fixer.js` to update product.json checksums

**Phase 3: Create ACP Provider Management**
1. Write `patches/acp-service.js`:
   - Load providers from `~/.cursor/acp-providers.json`
   - Spawn ACP subprocess (spawn with stdio)
   - JSON-RPC communication layer
   - Session management
   - Provider status tracking

**Phase 4: Model Selector Integration**
1. Write `patches/model-patch.js`:
   - Hook into existing model loading code (line 257589)
   - Add ACP providers to available models list
   - Set capabilities based on provider config
   - Prefix models with "acp:" for identification

**Phase 5: Chat Message Routing**
1. Write `patches/chat-patch.js`:
   - Hook `sendChatRequest()` at line 761781
   - Detect "acp:" prefix in model name
   - Route to ACP subprocess instead of Cursor backend
   - Stream responses back to UI
   - **Tool calls handled automatically by cursor-agent-exec!**

**Phase 6: Configuration**
1. Create `~/.cursor/acp-providers.json` template
2. Document configuration format
3. Add provider examples (Claude Code, etc.)

**Phase 7: Testing**
1. Enable extension → patches applied
2. Restart Cursor (no corruption warning due to checksum fix)
3. Add test ACP provider to config
4. Verify provider appears in model dropdown
5. Select ACP provider and test chat
6. Verify tool calls work through existing infrastructure
7. Test error handling and recovery

## Critical Files to Modify

### Via Monkey Patching:
1. **ModelConfigService** - Add ACP providers to model list
   - File: `workbench.beautified.js:216345`
   - Method: `getAvailableModelsReactiveWithStatus()`

2. **LanguageModelProvider** - Intercept chat requests
   - File: `workbench.beautified.js:761781`
   - Method: `$registerLanguageModelChat()` → `sendChatRequest()`

3. **AIService** (optional) - For base URL override if needed
   - File: `workbench.beautified.js:426875`

### New Files to Create:
1. `~/.cursor-acp-integration/browser.js` - Main patches
2. `~/.cursor-acp-integration/acp-service.js` - ACP management
3. `~/.cursor-acp-integration/acp-client.js` - Protocol implementation
4. `~/.cursor/acp-providers.json` - User configuration

## Data Structures

### ACP Provider Configuration
```typescript
interface ACPProvider {
    id: string;
    displayName: string;
    type: 'stdio' | 'http';

    // For stdio providers
    command?: string;
    args?: string[];
    env?: Record<string, string>;

    // For HTTP providers
    url?: string;
    headers?: Record<string, string>;

    // Capabilities
    capabilities: {
        supportsAgent: boolean;
        supportsMaxMode: boolean;
        supportsImages: boolean;
        supportsThinking: boolean;
    };

    // Status
    status?: 'disconnected' | 'connecting' | 'connected' | 'error';
    lastError?: string;
}
```

### ACP Session State
```typescript
interface ACPSession {
    sessionId: string;
    providerId: string;
    process?: ChildProcess;
    conversationHistory: Message[];
    toolCallsPending: Map<string, ToolCall>;
}
```

## Research References

Implementation based on analysis of existing VSCode monkey patching extensions:

1. **[Custom CSS and JS Loader](https://github.com/be5invis/vscode-custom-css)** - Direct file patching pattern
2. **[Fix VSCode Checksums](https://github.com/lehni/vscode-fix-checksums)** - Checksum update mechanism
3. **[APC Extension](https://github.com/drcika/apc-extension)** - Auto-reapply patches after updates
4. **[iocave/monkey-patch](https://github.com/iocave/monkey-patch)** - Alternative injection approach

## Why This Approach Works

**Leverage 90% of Existing Infrastructure:**
- Cursor already has full ACP implementation in `cursor-agent-exec`
- Tool execution, permissions, session management all ready
- We only add: subprocess spawning + UI integration

**Simple File Patching:**
- Inject ~500 lines of code into workbench
- Update checksums to suppress warnings
- Auto-reapply on updates (like APC extension)

**Minimal Conversion Layer:**
- ACP agents handle AI model calls
- cursor-agent-exec handles tool execution
- Just bridge the two with stdio communication

## Success Criteria

1. ✅ ACP providers configurable via JSON file
2. ✅ ACP providers appear in model selector dropdown
3. ✅ Selecting ACP provider routes messages to local subprocess
4. ✅ Conversation history preserved across turns
5. ✅ Tool calls execute through cursor-agent-exec
6. ✅ Responses stream back to UI in real-time
7. ✅ Errors handled gracefully with fallback to Cursor backend

## Risks & Mitigations

**Risk:** Cursor updates break monkey patches
- Mitigation: Use version detection, maintain patches per version

**Risk:** ACP subprocess crashes
- Mitigation: Automatic restart, error messages to user, fallback to normal models

**Risk:** Performance overhead
- Mitigation: Lazy loading, process pooling, connection reuse

**Risk:** Message format incompatibility
- Mitigation: Thorough format conversion layer, validation, extensive testing

## Future Enhancements

1. UI for ACP provider configuration (similar to MCP settings page)
2. Provider marketplace/discovery
3. Multi-agent orchestration
4. ACP provider health monitoring dashboard
5. Support for ACP server-side tool execution

## Quick Start Summary

**What we're building:**
A VSCode extension that patches Cursor to add ACP provider support

**Core components:**
1. Extension that injects code into workbench file
2. ACP provider config file (`~/.cursor/acp-providers.json`)
3. Three patch files: acp-service, model-patch, chat-patch
4. Checksum fixer to prevent warnings

**How it works:**
1. User configures ACP providers in JSON
2. Providers appear in model dropdown (prefixed with "acp:")
3. When selected, chat messages route to ACP subprocess
4. ACP agent handles AI, cursor-agent-exec handles tools
5. Responses stream back to UI

**Key files to create:**
- `cursor-acp-extension/extension.js` - Main extension
- `cursor-acp-extension/patcher.js` - File patching
- `cursor-acp-extension/checksum-fixer.js` - Fix checksums
- `cursor-acp-extension/patches/acp-service.js` - Provider management
- `cursor-acp-extension/patches/model-patch.js` - Model selector
- `cursor-acp-extension/patches/chat-patch.js` - Message routing

**Estimated LOC:** ~800 lines total (much simpler than original plan!)

**Next steps:** Begin with Phase 1 - create extension structure

---

## Testing Instructions (Manual Testing After Each Phase)

### Phase 1: Extension Structure - Testing

**After completing Phase 1, test:**

1. **Verify extension loads:**
   ```bash
   cd cursor-acp-extension
   code .  # Open in Cursor
   F5      # Launch extension development host
   ```

2. **Check commands are registered:**
   - Press `Cmd+Shift+P` (Mac) or `Ctrl+Shift+P` (Windows/Linux)
   - Type "ACP"
   - Verify you see:
     - "ACP: Enable"
     - "ACP: Disable"
     - "ACP: Reload"

3. **Test activation:**
   - Open Developer Tools: `Cmd+Option+I`
   - Go to Console tab
   - Look for: "cursor-acp-extension activated"

**Expected results:**
- ✅ Extension shows in extensions list
- ✅ Commands appear in command palette
- ✅ No errors in console
- ✅ Extension activates on startup

---

### Phase 2: File Patcher - Testing

**After completing Phase 2, test:**

1. **Run enable command:**
   - `Cmd+Shift+P` → "ACP: Enable"
   - Check for success message

2. **Verify backup created:**
   ```bash
   ls -la /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/
   # Should see: workbench.desktop.main.js.backup
   ```

3. **Check patch was applied:**
   ```bash
   tail -20 /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js
   # Should see: "// ACP Integration" comment at end
   ```

4. **Verify checksums fixed:**
   ```bash
   cat /Applications/Cursor.app/Contents/Resources/app/product.json | grep -A2 checksums
   # Should see updated checksum for workbench file
   ```

5. **Test reload:**
   - Restart Cursor completely (Quit and reopen)
   - Verify NO "[Unsupported]" warning in title bar
   - Verify NO corruption dialog appears

6. **Test disable command:**
   - `Cmd+Shift+P` → "ACP: Disable"
   - Verify backup is restored
   - Restart Cursor
   - Verify back to normal

**Expected results:**
- ✅ Backup file created before patching
- ✅ Patch code appended to workbench file
- ✅ Checksums updated in product.json
- ✅ No corruption warnings after restart
- ✅ Disable command restores original state

---

### Phase 3: ACP Provider Management - Testing

**After completing Phase 3, test:**

1. **Create test config:**
   ```bash
   mkdir -p ~/.cursor
   cat > ~/.cursor/acp-providers.json << 'EOF'
   {
     "acpProviders": {
       "test-agent": {
         "displayName": "Test ACP Agent",
         "type": "stdio",
         "command": "echo",
         "args": ["Hello from ACP"],
         "capabilities": {
           "supportsAgent": true,
           "supportsImages": false
         }
       }
     }
   }
   EOF
   ```

2. **Enable patches and restart:**
   - `Cmd+Shift+P` → "ACP: Enable"
   - Restart Cursor
   - Open Developer Console

3. **Test provider loading:**
   - In console, run:
     ```javascript
     window.acpService.getProviders()
     ```
   - Should return array with "test-agent"

4. **Test subprocess spawn (dry run):**
   - In console, run:
     ```javascript
     window.acpService.testSpawn('test-agent')
     ```
   - Check console for subprocess output

**Expected results:**
- ✅ Config file loads without errors
- ✅ Providers accessible via `window.acpService`
- ✅ Can spawn test subprocess
- ✅ Process management works (spawn/kill)

---

### Phase 4: Model Selector Integration - Testing

**After completing Phase 4, test:**

1. **Open Composer:**
   - Press `Cmd+I` (Mac) or `Ctrl+I` (Windows/Linux)
   - Click on model dropdown

2. **Verify ACP providers appear:**
   - Look for "Test ACP Agent (ACP)" in model list
   - Should be prefixed with "acp:test-agent" internally

3. **Test model selection:**
   - Select the ACP provider from dropdown
   - Check Developer Console for selection event
   - Verify model config updated:
     ```javascript
     // In console
     modelConfigService.getModelConfig('composer')
     // Should return: { modelName: "acp:test-agent", maxMode: false }
     ```

4. **Test persistence:**
   - Select ACP provider
   - Restart Cursor
   - Open Composer
   - Verify ACP provider still selected

**Expected results:**
- ✅ ACP providers appear in model dropdown
- ✅ Can select ACP provider
- ✅ Selection persists to storage
- ✅ Selection survives restart

---

### Phase 5: Chat Message Routing - Testing

**Setup for Phase 5:**

First, create a **real ACP test agent** (simple echo agent):

```bash
mkdir -p ~/acp-test-agent
cat > ~/acp-test-agent/agent.js << 'EOF'
#!/usr/bin/env node
const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

let sessionId = null;

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);

    if (msg.method === 'initialize') {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: 1,
          agentInfo: { name: 'test-agent', version: '1.0.0' },
          agentCapabilities: { tools: [], sessionModes: ['chat'] }
        }
      }));
    }

    if (msg.method === 'session/create') {
      sessionId = msg.params.sessionId;
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { sessionId: sessionId }
      }));
    }

    if (msg.method === 'session/prompt') {
      const userMessage = msg.params.message.text;

      // Send update notification
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: sessionId,
          update: {
            type: 'text',
            text: `Echo: ${userMessage}`
          }
        }
      }));

      // Send completion
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: msg.id,
        result: { stopReason: 'endTurn' }
      }));
    }
  } catch (e) {
    console.error('Error:', e);
  }
});
EOF

chmod +x ~/acp-test-agent/agent.js
```

**Update config to use real agent:**
```bash
cat > ~/.cursor/acp-providers.json << 'EOF'
{
  "acpProviders": {
    "test-agent": {
      "displayName": "Test ACP Agent",
      "type": "stdio",
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/acp-test-agent/agent.js"],
      "capabilities": {
        "supportsAgent": true,
        "supportsImages": false
      }
    }
  }
}
EOF
```

**Testing Phase 5:**

1. **Enable patches and restart:**
   - `Cmd+Shift+P` → "ACP: Reload"
   - Restart Cursor

2. **Open Composer and select ACP agent:**
   - `Cmd+I` to open Composer
   - Select "Test ACP Agent (ACP)" from model dropdown

3. **Send test message:**
   - Type: "Hello, ACP!"
   - Press Enter or click Send

4. **Verify response:**
   - Should see: "Echo: Hello, ACP!" in chat
   - Check Developer Console for:
     - ACP subprocess spawn log
     - JSON-RPC messages sent/received
     - Stream events

5. **Test multi-turn conversation:**
   - Send: "First message"
   - Wait for response
   - Send: "Second message"
   - Verify both work

6. **Test error handling:**
   - Kill the ACP process manually:
     ```bash
     pkill -f "acp-test-agent"
     ```
   - Try sending another message
   - Should see error message in UI
   - Should auto-reconnect on retry

**Expected results:**
- ✅ Selecting ACP provider spawns subprocess
- ✅ Messages route to ACP agent (not Cursor backend)
- ✅ Responses stream back to UI
- ✅ Multi-turn conversation works
- ✅ Error handling graceful
- ✅ Process cleanup on close

---

### Phase 6: Configuration - Testing

**After completing Phase 6, test:**

1. **Try multiple providers:**
   ```json
   {
     "acpProviders": {
       "test-agent-1": {
         "displayName": "Test Agent 1",
         "type": "stdio",
         "command": "node",
         "args": ["/path/to/agent1.js"],
         "capabilities": { "supportsAgent": true }
       },
       "test-agent-2": {
         "displayName": "Test Agent 2",
         "type": "stdio",
         "command": "node",
         "args": ["/path/to/agent2.js"],
         "capabilities": { "supportsAgent": true }
       }
     }
   }
   ```

2. **Verify both appear in dropdown**

3. **Test switching between providers:**
   - Select Agent 1, send message
   - Select Agent 2, send message
   - Verify each uses correct subprocess

**Expected results:**
- ✅ Multiple providers supported
- ✅ Can switch between providers
- ✅ Each provider maintains own session

---

### Phase 7: Integration Testing

**Complete end-to-end tests:**

1. **Test with real ACP agent (if available):**
   - Install Claude Code or another real ACP agent
   - Configure in `acp-providers.json`
   - Test full conversation with tool calls

2. **Test tool execution:**
   - Ask agent to "read package.json"
   - Verify file read tool executes
   - Verify approval dialog appears (if not in yolo mode)
   - Verify file contents returned to agent

3. **Test all tool types:**
   - File operations (read, write, edit)
   - Terminal commands
   - Search operations
   - Verify all work through cursor-agent-exec

4. **Stress testing:**
   - Long conversation (20+ turns)
   - Large file operations
   - Multiple concurrent tool calls
   - Verify stability

5. **Update testing:**
   - Disable patches
   - Update Cursor to new version
   - Re-enable patches
   - Verify everything still works

**Expected results:**
- ✅ Real ACP agents work
- ✅ Tool calls execute through cursor-agent-exec
- ✅ All tool types supported
- ✅ Stable under load
- ✅ Survives Cursor updates

---

## Debugging Tips

**If patches don't apply:**
- Check file permissions on Cursor.app
- May need to run with sudo on macOS
- Check console for error messages

**If ACP agent doesn't spawn:**
- Check command path is correct
- Test command manually in terminal
- Check stderr output in console
- Verify node/runtime is in PATH

**If messages don't route:**
- Verify model name starts with "acp:"
- Check sendChatRequest is properly hooked
- Look for errors in Developer Console
- Test with echo agent first

**If tool calls fail:**
- Verify cursor-agent-exec extension is active
- Check approval handler is working
- Test with simple file read first
- Check ACP protocol messages in console

**Common issues:**
- Cursor shows "[Unsupported]" → Checksums not fixed correctly
- Extension doesn't load → Check package.json activation events
- Model doesn't appear → Check provider config file path
- No response → Check ACP subprocess stderr for errors
