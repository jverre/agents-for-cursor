const fs = require('fs').promises;
const path = require('path');
const vscode = require('vscode');

// Get the Cursor app root path
function getCursorAppRoot() {
    // vscode.env.appRoot points to the app's Resources/app directory
    return vscode.env.appRoot;
}

// Get path to bootstrap workbench file
function getWorkbenchPath() {
    return path.join(getCursorAppRoot(), 'out/vs/code/electron-sandbox/workbench/workbench.js');
}

// Get path to main workbench file
function getMainWorkbenchPath() {
    return path.join(getCursorAppRoot(), 'out/vs/workbench/workbench.desktop.main.js');
}

// Get path to backup file
function getBackupPath() {
    return getWorkbenchPath() + '.backup';
}

// Get path to main workbench backup file
function getMainBackupPath() {
    return getMainWorkbenchPath() + '.acp-backup';
}

// Check if patches are already applied
async function isPatchApplied() {
    try {
        console.log('[Patcher] isPatchApplied() started');

        // Check bootstrap workbench
        const workbenchPath = getWorkbenchPath();
        console.log('[Patcher] Reading bootstrap workbench:', workbenchPath);
        const content = await fs.readFile(workbenchPath, 'utf8');
        const bootstrapPatched = content.includes('// ACP Integration');
        console.log(`[Patcher] Bootstrap patched: ${bootstrapPatched}`);

        // Check main workbench
        const mainWorkbenchPath = getMainWorkbenchPath();
        console.log('[Patcher] Reading main workbench:', mainWorkbenchPath);
        const mainContent = await fs.readFile(mainWorkbenchPath, 'utf8');
        const mainPatched = mainContent.includes('/* ACP CHAT INTERCEPTION */');
        console.log(`[Patcher] Main patched: ${mainPatched}`);

        console.log(`[Patcher] Bootstrap patched: ${bootstrapPatched}, Main patched: ${mainPatched}`);

        return bootstrapPatched && mainPatched;
    } catch (error) {
        console.error('[Patcher] Error checking if patched:', error);
        return false;
    }
}

// Apply patches to workbench file
async function applyPatches() {
    try {
        console.log('[Patcher] applyPatches() started');

        console.log('[Patcher] Getting workbench path...');
        const workbenchPath = getWorkbenchPath();
        console.log('[Patcher] Got workbench path:', workbenchPath);

        const backupPath = getBackupPath();
        console.log('[Patcher] Got backup path:', backupPath);

        console.log('Workbench path:', workbenchPath);
        console.log('Backup path:', backupPath);
        
        
        // Check if already patched
        // console.log('[Patcher] Checking if already patched...');
        // if (await isPatchApplied()) {
        //     console.log('Patches already applied, skipping...');
        //     return;
        // }
        console.log('[Patcher] Not yet patched, proceeding...');

        // Read the original workbench file
        let content;
        try {
            content = await fs.readFile(workbenchPath, 'utf8');
            console.log(`Read workbench file: ${content.length} bytes`);
        } catch (error) {
            throw new Error(`Failed to read workbench file: ${error.message}`);
        }
        // Create backup if it doesn't exist
        try {
            await fs.access(backupPath);
            console.log('Backup already exists');
        } catch {
            console.log('Creating backup...');
            await fs.writeFile(backupPath, content, 'utf8');
            console.log('Backup created');
        }

        // Read patch files for bootstrap workbench
        const patchesDir = path.join(__dirname, 'patches');
        const acpServicePatch = await readPatchFile(path.join(patchesDir, 'acp-service.js'));
        const modelPatch = await readPatchFile(path.join(patchesDir, 'model-patch.js'));
        const extensionBridgePatch = await readPatchFile(path.join(patchesDir, 'extension-bridge.js'));

        // Prepend patches to bootstrap workbench
        const patchedContent = '// ACP Integration - DO NOT EDIT MANUALLY\n' +
            '(function() {\n' +
            '  "use strict";\n' +
            '  console.log("[ACP] Initializing ACP integration patches...");\n' +
            '\n' +
            extensionBridgePatch + '\n\n' +
            acpServicePatch + '\n\n' +
            modelPatch + '\n' +
            '  console.log("[ACP] ACP integration patches loaded in bootstrap");\n' +
            '})();\n' +
            '\n' +
            content;

        // Write patched workbench
        try {
            await fs.writeFile(workbenchPath, patchedContent, 'utf8');
            console.log('[Patcher] Bootstrap workbench patches applied successfully');
        } catch (error) {
            // Try to restore backup if write failed
            try {
                await fs.writeFile(workbenchPath, content, 'utf8');
            } catch (restoreError) {
                console.error('Failed to restore original file:', restoreError);
            }
            throw new Error(`Failed to write patched workbench: ${error.message}`);
        }

        // Also patch main workbench with string replacement for model injection
        console.log('[Patcher] Calling patchMainWorkbench()...');
        await patchMainWorkbench();
        console.log('[Patcher] applyPatches() completed successfully');
    } catch (error) {
        console.error('[Patcher] applyPatches() failed:', error);
        throw error;
    }
}

// Patch the main workbench file to inject ACP routing directly into submitChatMaybeAbortCurrent
async function patchMainWorkbench() {
    try {
        const mainWorkbenchPath = getMainWorkbenchPath();
        const mainBackupPath = getMainBackupPath();

        console.log('Main workbench path:', mainWorkbenchPath);
        console.log('Main backup path:', mainBackupPath);

        // Read main workbench
        let mainContent;
        try {
            mainContent = await fs.readFile(mainWorkbenchPath, 'utf8');
            console.log(`Read main workbench file: ${mainContent.length} bytes`);
        } catch (error) {
            throw new Error(`Failed to read main workbench file: ${error.message}`);
        }

        // Check if already patched
        if (mainContent.includes('/* ACP CHAT INTERCEPTION */')) {
            console.log('Main workbench already patched, skipping...');
            return;
        }

        // Create backup
        try {
            await fs.access(mainBackupPath);
            console.log('Main workbench backup already exists');
        } catch {
            console.log('Creating main workbench backup...');
            await fs.writeFile(mainBackupPath, mainContent, 'utf8');
            console.log('Main workbench backup created');
        }

    // Find and patch submitChatMaybeAbortCurrent function
    // Use regex to handle different minified variable names across platforms
    console.log('[Patcher] Searching for submitChatMaybeAbortCurrent pattern...');
    const searchRegex = /async submitChatMaybeAbortCurrent\((\w),(\w),(\w),(\w)=(\w+)\)\{let (\w)=(\w+)\(\);\4\.setAttribute\("requestId",\6\);/;
    const match = mainContent.match(searchRegex);

    if (!match) {
        console.warn('⚠️  Could not find submitChatMaybeAbortCurrent pattern with regex');
        console.warn('⚠️  Cursor version may have changed - ACP interception will NOT work');
    } else {
        console.log('Found submitChatMaybeAbortCurrent with variables:', match.slice(1, 8).join(', '));
        // Extract the captured variable names
        const [, e, t, n, s, defaultVal, r, ssFunc] = match;
        const searchPattern = match[0];

        const acpInterceptionCode = `async submitChatMaybeAbortCurrent(${e}, ${t}, ${n}, ${s} = ${defaultVal}) {
      let ${r} = ${ssFunc}();
      ${s}.setAttribute("requestId", ${r});

      /* === ACP CHAT INTERCEPTION === */
      const composerHandle = this._composerDataService.getWeakHandleOptimistic(${e});
      const modelName = ${n}?.modelOverride || composerHandle?.data?.modelConfig?.modelName || '';

      if (modelName.startsWith('acp:')) {
        console.log('[ACP] 🎯 Intercepting message for ACP model:', modelName);

        try {
          if (!composerHandle) {
            throw new Error('No composer handle');
          }

          const shouldClearText = !${n}?.isResume && !${n}?.skipClearInput && !${n}?.bubbleId;

          const humanBubble = {
            bubbleId: ${ssFunc}(),
            type: 1,
            text: ${t} || '',
            richText: ${n}?.richText ?? ${t},
            codeBlocks: [],
            createdAt: new Date().toISOString(),
            requestId: ${r},
            modelInfo: { modelName: modelName || '' }
          };
          this._composerDataService.appendComposerBubbles(composerHandle, [humanBubble]);

          shouldClearText && this._composerUtilsService.clearText(${e});
          ${n}?.skipFocusAfterSubmission || this._composerViewsService.focus(${e}, !0);

          const aiBubbleId = ${ssFunc}();
          this._composerDataService.updateComposerDataSetStore(${e}, o => {
            o("status", "generating");
            o("generatingBubbleIds", [aiBubbleId]);
            o("currentBubbleId", void 0);
            o("isDraft", !1);
          });

          const acpMessages = [{ role: 'user', content: ${t} || '' }];
          const acpResponse = await window.acpService.handleRequest(modelName, acpMessages);

          if (acpResponse.error) {
            throw new Error(acpResponse.message || 'ACP error');
          }

          const responseText = acpResponse.choices?.[0]?.message?.content || '[No response]';

          const aiBubble = {
            bubbleId: aiBubbleId,
            type: 2,
            text: responseText,
            codeBlocks: [],
            richText: responseText,
            createdAt: new Date().toISOString()
          };
          this._composerDataService.appendComposerBubbles(composerHandle, [aiBubble]);

          this._composerDataService.updateComposerDataSetStore(${e}, o => {
            o("status", "completed");
            o("generatingBubbleIds", []);
            o("chatGenerationUUID", void 0);
          });

          console.log('[ACP] ✅ Message handled by ACP');
          return;

        } catch (acpError) {
          console.error('[ACP] ❌ Error:', acpError);
          this._composerDataService.updateComposerDataSetStore(${e}, o => o("status", "aborted"));
          throw acpError;
        }
      }

      console.log('[ACP] 🔵 Normal Cursor model, using standard flow:', modelName);
      `;

        console.log('Applying ACP interception patch...');
        mainContent = mainContent.replace(searchPattern, acpInterceptionCode);
    }

    // === PATCH: Inject ACP model into getAvailableDefaultModels getter ===
    // The getter returns: e.length===0?[...XX]:e  (where XX is the fallback array variable)
    // We patch it to always prepend ACP model to the returned array
    console.log('[Patcher] Searching for model getter pattern...');
    const acpModelDef = '{defaultOn:!0,name:"acp:claude-code",clientDisplayName:"Claude Code (ACP)",serverModelName:"acp:claude-code",supportsAgent:!0,supportsMaxMode:!0,supportsNonMaxMode:!0,supportsThinking:!0,supportsImages:!1,isRecommendedForBackgroundComposer:!1,inputboxShortModelName:"Claude Code"}';

    // Use regex to find the pattern with any variable names
    const getterRegex = /\.length===0\?\[\.\.\.(\w+)\]:(\w)\}/;
    const getterMatch = mainContent.match(getterRegex);

    if (getterMatch) {
        const [fullMatch, fallbackVar, returnVar] = getterMatch;
        console.log(`Found getAvailableDefaultModels getter with vars: fallback=${fallbackVar}, return=${returnVar}`);
        const getterReplace = `.length===0?[${acpModelDef},...${fallbackVar}]:[${acpModelDef},...${returnVar}]}`;
        mainContent = mainContent.replace(fullMatch, getterReplace);
        console.log('✅ ACP model will be injected into model list');
    } else {
        console.warn('⚠️  Could not find getter pattern with regex');
    }

    // === PATCH: Add Agents section template (for future use) ===
    // Note: The ACP model will appear in the regular model list for now.
    // A separate "Agents" section UI can be added in a future enhancement.
    const templateSearch = 'nBf=be("<div class=settings-menu-hoverable><div></div><div>API Keys")';
    const templateReplace = 'nBf=be("<div class=settings-menu-hoverable><div></div><div>API Keys"),acpAgentsBf=be("<div class=settings-menu-hoverable><div></div><div>Agents")';

    if (mainContent.includes(templateSearch)) {
        console.log('Found API Keys template, adding Agents section template...');
        mainContent = mainContent.replace(templateSearch, templateReplace);
        console.log('✅ Agents section template added (for future use)');
    } else {
        console.warn('⚠️  Could not find API Keys template pattern');
        console.warn('⚠️  Agents section template not added');
    }

    console.log('ℹ️  Note: Claude Code (ACP) will appear in the regular model list');

        // Write all patches
        console.log('[Patcher] Writing patched content to file...');
        try {
            await fs.writeFile(mainWorkbenchPath, mainContent, 'utf8');
            console.log('✅ Main workbench patched successfully');
        } catch (error) {
            console.error('[Patcher] Write failed:', error);
            throw new Error(`Failed to write patched main workbench: ${error.message}`);
        }
        console.log('[Patcher] patchMainWorkbench() completed');
    } catch (error) {
        console.error('[Patcher] patchMainWorkbench() failed:', error);
        throw error;
    }
}

// Remove patches from workbench files
async function removePatches() {
    const workbenchPath = getWorkbenchPath();
    const backupPath = getBackupPath();
    const mainWorkbenchPath = getMainWorkbenchPath();
    const mainBackupPath = getMainBackupPath();

    console.log('Removing patches...');

    // Restore bootstrap workbench
    try {
        await fs.access(backupPath);
        const backupContent = await fs.readFile(backupPath, 'utf8');
        await fs.writeFile(workbenchPath, backupContent, 'utf8');
        console.log('Bootstrap workbench restored from backup');
    } catch (error) {
        console.log('No bootstrap backup found or failed to restore:', error.message);
    }

    // Restore main workbench
    try {
        await fs.access(mainBackupPath);
        const mainBackupContent = await fs.readFile(mainBackupPath, 'utf8');
        await fs.writeFile(mainWorkbenchPath, mainBackupContent, 'utf8');
        console.log('Main workbench restored from backup');
    } catch (error) {
        console.log('No main workbench backup found or failed to restore:', error.message);
    }
}

// Helper to read patch files
async function readPatchFile(filePath) {
    try {
        const content = await fs.readFile(filePath, 'utf8');
        return content;
    } catch (error) {
        // If patch file doesn't exist yet, return empty placeholder
        console.warn(`Patch file not found: ${filePath}, using placeholder`);
        return `  // Placeholder for ${path.basename(filePath)}`;
    }
}

module.exports = {
    applyPatches,
    removePatches,
    isPatchApplied,
    getWorkbenchPath,
    getBackupPath
};
