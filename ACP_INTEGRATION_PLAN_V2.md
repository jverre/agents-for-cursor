# ACP Integration Plan V2 - Clean Architecture Approach

## Executive Summary

Integrate ACP (Agent Client Protocol) providers into Cursor by patching at the correct abstraction points based on deep analysis of Cursor's decompiled codebase.

**Status**: Phases 1-2 complete, Phase 3 blocked. New approach designed based on architecture analysis.

## Problem Statement

**Current Issue**: ACP models not appearing in Cursor's model dropdown despite:
- ✅ Extension structure working
- ✅ File patching applied to bootstrap workbench.js
- ✅ ACPService class created and accessible as `window.acpService`
- ✅ Fetch interception working
- ❌ **BLOCKER**: Can't find `reactiveStorageService` via window property search

**Root Cause**: Services are in closures, not exposed as window properties. Current approach of searching window at runtime is unreliable.

## Architecture Analysis Summary

### Cursor's Model System Architecture

**File**: `/Users/jacquesverre/Documents/code/opencursor/cursor-decompiled/workbench.beautified.js`

#### 1. Model Initialization Flow
```
Application Start (line ~181415)
  ↓
Default Models Defined (line 216337)
  ↓
refreshDefaultModels() called (line 873541)
  ↓
AI Client fetches available models
  ↓
Storage: setApplicationUserPersistentStorage("availableDefaultModels2", models)
  ↓
getAvailableModelsReactiveWithStatus() filters models (line 257595)
  ↓
Model Dropdown Renders (lines 690263-691913)
```

#### 2. Model Storage Structure
```javascript
availableDefaultModels2: [{
  name: "default",
  clientDisplayName: "Claude Sonnet 4.5",
  defaultOn: true,
  supportsAgent: true,
  supportsMaxMode: true,
  supportsNonMaxMode: true,
  supportsThinking: false,
  supportsImages: true
}]
```

#### 3. Chat Request Flow
```
User sends message (line 970107)
  ↓
userSelectedModelId attached to request
  ↓
invokeAgent() called (line 318312)
  ↓
getAgentStreamResponse() (line 922577)
  ↓
modelDetails.modelName used to route request
  ↓
streamResponse() to backend (line 922607)
```

### Cursor's Existing ACP Infrastructure

**Already Implemented in Cursor** (we can leverage):
- **MCPService** (line 418036) - Spawns stdio subprocesses, manages lifecycle
- **composerAgentService** (line 420166) - Agent execution engine
- **subagentsService** (line 420020) - Subagent coordination
- **Protocol Buffers** (lines 94126-141330) - Agent communication format

## Solution: Two-File Patching Strategy

### Current Files Being Patched

1. **Bootstrap Workbench** (15KB): `/Applications/Cursor.app/Contents/Resources/app/out/vs/code/electron-sandbox/workbench/workbench.js`
   - **Purpose**: Early initialization, loads main workbench
   - **Current Patch**: Prepends ACP service code
   - **Status**: ✅ Working

2. **Main Workbench** (27MB): `/Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js`
   - **Purpose**: Contains all application logic, model system, services
   - **Current Patch**: Not patched
   - **Status**: ❌ **THIS IS THE PROBLEM**

### New Approach: Patch Main Workbench Directly

Instead of searching for services at runtime, **inject ACP models at initialization time** by patching the main workbench file.

## Implementation Plan

### Phase 3A: Direct Model Initialization Patch

**Target File**: `workbench.desktop.main.js`

**Target Pattern** (appears exactly once at line ~452):
```javascript
availableDefaultModels2:[{defaultOn:!0,name:"default",supportsAgent:!0,isRecommendedForBackgroundComposer:!0}]
```

**Replacement Strategy**:
```javascript
availableDefaultModels2:(function(){
  const defaults=[{defaultOn:!0,name:"default",supportsAgent:!0,isRecommendedForBackgroundComposer:!0}];
  try{
    if(window.acpService){
      const acpProviders=window.acpService.getProviders()||[];
      const acpModels=acpProviders.map(p=>({
        name:`acp:${p.id}`,
        clientDisplayName:`${p.displayName} (ACP)`,
        defaultOn:!1,
        supportsAgent:p.capabilities?.supportsAgent??!0,
        supportsMaxMode:!1,
        supportsNonMaxMode:!0,
        supportsThinking:p.capabilities?.supportsThinking??!1,
        supportsImages:p.capabilities?.supportsImages??!1,
        isACPProvider:!0,
        acpProviderId:p.id
      }));
      return[...defaults,...acpModels]
    }
  }catch(e){console.error('[ACP] Failed to inject models:',e)}
  return defaults
})()
```

**Why This Works**:
- Executes when initial storage value is read
- `window.acpService` already exists (set by bootstrap patch)
- Falls back gracefully if ACP service not available
- Single-line change, minimal risk
- No runtime service discovery needed

**Implementation Location**: `/Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension/patcher.js`

```javascript
async function applyPatches() {
    // ... existing bootstrap patching ...

    // NEW: Patch main workbench
    const mainWorkbenchPath = path.join(
        getCursorAppRoot(),
        'out/vs/workbench/workbench.desktop.main.js'
    );
    const mainBackupPath = mainWorkbenchPath + '.acp-backup';

    let mainContent = await fs.readFile(mainWorkbenchPath, 'utf8');

    // Check if already patched
    if (!mainContent.includes('/* ACP Model Injection */')) {
        // Create backup
        if (!fs.existsSync(mainBackupPath)) {
            await fs.writeFile(mainBackupPath, mainContent, 'utf8');
        }

        // Find and replace
        const searchPattern = /availableDefaultModels2:\[\{defaultOn:!0,name:"default",supportsAgent:!0,isRecommendedForBackgroundComposer:!0\}\]/;

        if (searchPattern.test(mainContent)) {
            mainContent = mainContent.replace(searchPattern, REPLACEMENT_CODE);
            await fs.writeFile(mainWorkbenchPath, mainContent, 'utf8');
            console.log('[ACP] Main workbench patched successfully');
        } else {
            console.warn('[ACP] Pattern not found - Cursor version may have changed');
        }
    }

    // Update checksums for BOTH files
    await fixChecksums();
}
```

### Phase 3B: Update Checksum Fixer

**File**: `/Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension/checksum-fixer.js`

**Update**: Calculate checksums for **both** patched files:

```javascript
async function fixChecksums() {
    const productJsonPath = getProductJsonPath();
    const product = JSON.parse(await fs.readFile(productJsonPath, 'utf8'));

    // Create backup
    const backupPath = productJsonPath + '.backup';
    if (!fs.existsSync(backupPath)) {
        await fs.writeFile(backupPath, JSON.stringify(product, null, '\t'), 'utf8');
    }

    // Update checksum for bootstrap workbench
    const bootstrapPath = 'vs/code/electron-sandbox/workbench/workbench.js';
    const bootstrapChecksum = await calculateSHA256Base64(
        path.join(vscode.env.appRoot, 'out', bootstrapPath)
    );
    product.checksums[bootstrapPath] = bootstrapChecksum;

    // Update checksum for main workbench
    const mainPath = 'vs/workbench/workbench.desktop.main.js';
    const mainChecksum = await calculateSHA256Base64(
        path.join(vscode.env.appRoot, 'out', mainPath)
    );
    product.checksums[mainPath] = mainChecksum;

    // Write updated product.json
    await fs.writeFile(productJsonPath, JSON.stringify(product, null, '\t'), 'utf8');
    console.log('[ACP] Checksums updated for both workbench files');
}
```

### Phase 3C: Update Chat Routing

**File**: `/Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension/patches/chat-patch.js`

**Current Status**: Fetch interception works, but needs to check request body model field

**Update** (line 20-31):
```javascript
// Check if this is a chat completion request
if (url && typeof url === 'string' && (url.includes('/chat/completions') || url.includes('chat') || url.includes('completion'))) {
    console.log('[ACP] MATCHED - Intercepted chat request:', url);

    // Parse the request body to check the model
    let requestModel = null;
    try {
        const body = options?.body ? JSON.parse(options.body) : {};
        requestModel = body.model;  // Model name is in request body
        console.log('[ACP] Request model from body:', requestModel);
    } catch (e) {
        console.log('[ACP] Could not parse request body');
    }

    // Check if this is an ACP model request
    const isACPRequest = requestModel && requestModel.startsWith('acp:');

    if (isACPRequest) {
        const acpProviderId = requestModel.replace('acp:', '');
        console.log('[ACP] Routing to ACP provider:', acpProviderId);

        // Return mock response (TODO: real ACP subprocess communication)
        // ...
    }
}
```

### Phase 4: Cleanup Old Code

**File**: `/Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension/patches/acp-service.js`

**Remove**: Lines 79-206 (reactive storage search code)

**Keep**:
- ACPService class (lines 5-92)
- Provider management methods
- Test provider setup

## Testing Strategy

### Test 1: Pattern Match Verification
```bash
# Verify pattern exists exactly once
grep -c 'availableDefaultModels2:\[{defaultOn:!0,name:"default"' \
  /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js

# Expected: 1
```

### Test 2: Patch Application
```bash
# Run from extension
cd /Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension
npm run reload  # (need to add this script)

# Or manually via Cursor:
# Cmd+Shift+P → "ACP: Reload Patches"
# Restart Cursor
```

### Test 3: Verify Patch Applied
```bash
# Check for ACP injection marker
grep '/* ACP Model Injection */' \
  /Applications/Cursor.app/Contents/Resources/app/out/vs/workbench/workbench.desktop.main.js

# Should return the replacement code if successfully patched
```

### Test 4: Console Verification
After Cursor restarts, open DevTools (`Cmd+Option+I`):

```javascript
// 1. Verify ACP service exists
window.acpService
// Should return: ACPService {providers: Map, sessions: Map}

// 2. Check providers
window.acpService.getProviders()
// Should return: [{id: "test-agent", displayName: "Test ACP Agent", ...}]

// 3. Check models (new approach - should work now)
window.acpModels
// Should return array with ACP models
```

### Test 5: UI Verification
1. Open Composer (`Cmd+I`)
2. Click model dropdown
3. **Look for**: "Test ACP Agent (ACP)" in the list
4. Select it
5. Verify selection persists

### Test 6: Chat Routing
1. With ACP model selected, send a test message: "Hello"
2. Check console for:
   - `[ACP] MATCHED - Intercepted chat request`
   - `[ACP] Request model from body: acp:test-agent`
   - `[ACP] Routing to ACP provider: test-agent`
3. Mock response should appear in chat

## File Structure

```
/Users/jacquesverre/Documents/code/opencursor/
├── cursor-acp-extension/
│   ├── package.json              # ✅ Working
│   ├── extension.js              # ✅ Working
│   ├── patcher.js                # 🔧 NEEDS UPDATE (add main workbench patching)
│   ├── checksum-fixer.js         # 🔧 NEEDS UPDATE (add main workbench checksum)
│   └── patches/
│       ├── acp-service.js        # 🔧 NEEDS CLEANUP (remove search code)
│       ├── model-patch.js        # ✅ Can keep as-is (debugging helpers)
│       └── chat-patch.js         # ✅ Working (minor enhancement possible)
│
├── cursor-decompiled/
│   └── workbench.beautified.js   # 📖 Reference only
│
└── investigations/
    ├── ACP_INTEGRATION.md        # 📖 Background research
    └── ACP_INTEGRATION_PLAN.md   # 📖 Original plan (outdated)
```

## Critical Code Changes Required

### 1. `/Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension/patcher.js`

**Add after line 97** (after bootstrap patching):

```javascript
// Also patch main workbench
const mainWorkbenchPath = path.join(getCursorAppRoot(), 'out/vs/workbench/workbench.desktop.main.js');
const mainBackupPath = mainWorkbenchPath + '.acp-backup';

console.log('[ACP] Patching main workbench at:', mainWorkbenchPath);

let mainContent = await fs.readFile(mainWorkbenchPath, 'utf8');

if (!mainContent.includes('/* ACP Model Injection */')) {
    try {
        await fs.access(mainBackupPath);
    } catch {
        await fs.writeFile(mainBackupPath, mainContent, 'utf8');
        console.log('[ACP] Created main workbench backup');
    }

    const searchPattern = /availableDefaultModels2:\[\{defaultOn:!0,name:"default",supportsAgent:!0,isRecommendedForBackgroundComposer:!0\}\]/;

    const replacementCode = `availableDefaultModels2:(function(){/* ACP Model Injection */const defaults=[{defaultOn:!0,name:"default",supportsAgent:!0,isRecommendedForBackgroundComposer:!0}];try{if(window.acpService){const acpProviders=window.acpService.getProviders()||[];const acpModels=acpProviders.map(p=>({name:\`acp:\${p.id}\`,clientDisplayName:\`\${p.displayName} (ACP)\`,defaultOn:!1,supportsAgent:p.capabilities?.supportsAgent??!0,supportsMaxMode:!1,supportsNonMaxMode:!0,supportsThinking:p.capabilities?.supportsThinking??!1,supportsImages:p.capabilities?.supportsImages??!1,isACPProvider:!0,acpProviderId:p.id}));return[...defaults,...acpModels]}}catch(e){console.error('[ACP] Failed to inject models:',e)}return defaults})()`;

    if (searchPattern.test(mainContent)) {
        mainContent = mainContent.replace(searchPattern, replacementCode);
        await fs.writeFile(mainWorkbenchPath, mainContent, 'utf8');
        console.log('[ACP] Main workbench patched successfully');
    } else {
        console.warn('[ACP] Could not find model initialization pattern');
        console.warn('[ACP] Cursor version may have changed - pattern matching failed');
    }
} else {
    console.log('[ACP] Main workbench already patched');
}
```

**Update removePatches()** function to restore main workbench:

```javascript
async function removePatches() {
    const workbenchPath = getWorkbenchPath();
    const backupPath = getBackupPath();
    const mainWorkbenchPath = path.join(getCursorAppRoot(), 'out/vs/workbench/workbench.desktop.main.js');
    const mainBackupPath = mainWorkbenchPath + '.acp-backup';

    try {
        await fs.access(backupPath);
        await fs.writeFile(workbenchPath, await fs.readFile(backupPath, 'utf8'), 'utf8');
        console.log('Restored bootstrap workbench');
    } catch {}

    try {
        await fs.access(mainBackupPath);
        await fs.writeFile(mainWorkbenchPath, await fs.readFile(mainBackupPath, 'utf8'), 'utf8');
        console.log('Restored main workbench');
    } catch {}
}
```

### 2. `/Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension/checksum-fixer.js`

**Update fixChecksums()** (lines 37-86):

```javascript
async function fixChecksums() {
    const productJsonPath = getProductJsonPath();
    const backupPath = getProductJsonBackupPath();

    console.log('Fixing checksums in product.json...');

    let product;
    try {
        const content = await fs.readFile(productJsonPath, 'utf8');
        product = JSON.parse(content);
    } catch (error) {
        throw new Error(`Failed to read product.json: ${error.message}`);
    }

    // Create backup
    try {
        await fs.access(backupPath);
        console.log('product.json backup already exists');
    } catch {
        console.log('Creating product.json backup...');
        await fs.writeFile(backupPath, JSON.stringify(product, null, '\t'), 'utf8');
    }

    // Update bootstrap workbench checksum
    const bootstrapKey = 'vs/code/electron-sandbox/workbench/workbench.js';
    const bootstrapPath = path.join(vscode.env.appRoot, 'out', bootstrapKey);
    const bootstrapChecksum = await calculateSHA256Base64(bootstrapPath);
    console.log('Bootstrap checksum:', bootstrapChecksum);
    console.log('Old bootstrap checksum:', product.checksums[bootstrapKey]);
    product.checksums[bootstrapKey] = bootstrapChecksum;

    // Update main workbench checksum
    const mainKey = 'vs/workbench/workbench.desktop.main.js';
    const mainPath = path.join(vscode.env.appRoot, 'out', mainKey);
    const mainChecksum = await calculateSHA256Base64(mainPath);
    console.log('Main checksum:', mainChecksum);
    console.log('Old main checksum:', product.checksums[mainKey]);
    product.checksums[mainKey] = mainChecksum;

    // Write updated product.json
    try {
        await fs.writeFile(productJsonPath, JSON.stringify(product, null, '\t'), 'utf8');
        console.log('Checksums updated successfully');
    } catch (error) {
        throw new Error(`Failed to write product.json: ${error.message}`);
    }
}
```

### 3. `/Users/jacquesverre/Documents/code/opencursor/cursor-acp-extension/patches/acp-service.js`

**DELETE lines 79-206** (entire reactive storage search section)

**Keep everything else** (ACPService class, provider management)

## Success Criteria

After implementing these changes:

1. ✅ Extension activates without errors
2. ✅ Both workbench files patched successfully
3. ✅ Both checksums updated in product.json
4. ✅ No "[Unsupported]" warning after Cursor restart
5. ✅ **ACP models appear in model dropdown**
6. ✅ Can select ACP model
7. ✅ Selection persists across restarts
8. ✅ Sending message with ACP model triggers fetch interception
9. ✅ Mock response appears in chat

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Pattern not found (Cursor updated) | Regex test fails gracefully, logs warning, doesn't break |
| Main workbench too large to parse | Use streaming file operations if needed |
| Checksum calculation slow | Calculate in background, cache results |
| Cursor version changes pattern | Add version detection, maintain pattern library |
| Patch breaks Cursor | Backups created automatically, restore with "ACP: Disable" |

## Timeline Estimate

- **Phase 3A** (Main workbench patching): 30 min implementation + 15 min testing
- **Phase 3B** (Checksum updates): 15 min implementation + 10 min testing
- **Phase 3C** (Chat routing enhancement): 10 min implementation + 10 min testing
- **Phase 4** (Cleanup): 10 min

**Total**: ~90 minutes to working model dropdown

## Next Steps After Model Dropdown Works

Once ACP models appear in dropdown and can be selected:

1. **Phase 5**: Real ACP subprocess communication
   - Spawn stdio process when ACP model selected
   - Implement JSON-RPC message protocol
   - Stream responses back to UI

2. **Phase 6**: Leverage Cursor's MCP infrastructure
   - Register ACP providers as MCP stdio servers
   - Let MCPService handle subprocess management
   - Reduce code duplication

3. **Phase 7**: Settings UI
   - Add "ACP Providers" section to settings
   - Provider enable/disable toggles
   - Connection status indicators

## References

- **Cursor Decompiled Code**: `/Users/jacquesverre/Documents/code/opencursor/cursor-decompiled/workbench.beautified.js`
- **Model System**: Lines 216337, 257595, 873541
- **Chat Flow**: Lines 970107, 922577, 922607
- **MCP Service**: Lines 417919-419391
- **Existing Plan**: `/Users/jacquesverre/Documents/code/opencursor/investigations/ACP_INTEGRATION_PLAN.md`
