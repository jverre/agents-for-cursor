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
        const workbenchPath = getWorkbenchPath();
        const content = await fs.readFile(workbenchPath, 'utf8');
        return content.includes('// ACP Integration');
    } catch (error) {
        return false;
    }
}

// Apply patches to workbench file
async function applyPatches() {
    const workbenchPath = getWorkbenchPath();
    const backupPath = getBackupPath();

    console.log('Workbench path:', workbenchPath);
    console.log('Backup path:', backupPath);

    // Check if already patched
    if (await isPatchApplied()) {
        console.log('Patches already applied, skipping...');
        return;
    }

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

    // Prepend patches to bootstrap workbench (provider-patch goes in main workbench)
    const patchedContent = '// ACP Integration - DO NOT EDIT MANUALLY\n' +
        '(function() {\n' +
        '  "use strict";\n' +
        '  console.log("[ACP] Initializing ACP integration patches...");\n' +
        '\n' +
        acpServicePatch + '\n\n' +
        modelPatch + '\n' +
        '  console.log("[ACP] ACP integration patches loaded in bootstrap");\n' +
        '})();\n' +
        '\n' +
        content;

    // Write patched workbench
    try {
        await fs.writeFile(workbenchPath, patchedContent, 'utf8');
        console.log('Bootstrap workbench patches applied successfully');
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
    await patchMainWorkbench();
}

// Patch the main workbench file to inject ACP routing directly into submitChatMaybeAbortCurrent
async function patchMainWorkbench() {
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
    // Pattern: async submitChatMaybeAbortCurrent(e,t,n,s=yj){let r=ss();s.setAttribute("requestId",r);
    const searchPattern = 'async submitChatMaybeAbortCurrent(e,t,n,s=yj){let r=ss();s.setAttribute("requestId",r);';

    const acpInterceptionCode = `async submitChatMaybeAbortCurrent(e, t, n, s = yj) {
      let r = ss();
      s.setAttribute("requestId", r);

      /* === ACP CHAT INTERCEPTION === */
      // Get the model name first
      const composerHandle = this._composerDataService.getWeakHandleOptimistic(e);
      const modelName = n?.modelOverride || composerHandle?.data?.modelConfig?.modelName || '';

      // Only route to ACP if model starts with "acp:"
      if (modelName.startsWith('acp:')) {
        console.log('[ACP] 🎯 Intercepting message for ACP model:', modelName);

        try {
          if (!composerHandle) {
            throw new Error('No composer handle');
          }

          const shouldClearText = !n?.isResume && !n?.skipClearInput && !n?.bubbleId;

          // Create and add human message bubble
          const humanBubble = {
            bubbleId: ss(),
            type: 1,
            text: t || '',
            richText: n?.richText ?? t,
            codeBlocks: [],
            createdAt: new Date().toISOString(),
            requestId: r,
            modelInfo: { modelName: modelName || '' }
          };
          this._composerDataService.appendComposerBubbles(composerHandle, [humanBubble]);

          // Clear input and refocus
          shouldClearText && this._composerUtilsService.clearText(e);
          n?.skipFocusAfterSubmission || this._composerViewsService.focus(e, !0);

          // Set status to generating
          const aiBubbleId = ss();
          this._composerDataService.updateComposerDataSetStore(e, o => {
            o("status", "generating");
            o("generatingBubbleIds", [aiBubbleId]);
            o("currentBubbleId", void 0);
            o("isDraft", !1);
          });

          // Call ACP service
          const acpMessages = [{ role: 'user', content: t || '' }];
          const acpResponse = await window.acpService.handleRequest(modelName, acpMessages);

          if (acpResponse.error) {
            throw new Error(acpResponse.message || 'ACP error');
          }

          const responseText = acpResponse.choices?.[0]?.message?.content || '[No response]';

          // Create and add AI response bubble
          const aiBubble = {
            bubbleId: aiBubbleId,
            type: 2,
            text: responseText,
            codeBlocks: [],
            richText: responseText,
            createdAt: new Date().toISOString()
          };
          this._composerDataService.appendComposerBubbles(composerHandle, [aiBubble]);

          // Set status to completed
          this._composerDataService.updateComposerDataSetStore(e, o => {
            o("status", "completed");
            o("generatingBubbleIds", []);
            o("chatGenerationUUID", void 0);
          });

          console.log('[ACP] ✅ Message handled by ACP');
          return;

        } catch (acpError) {
          console.error('[ACP] ❌ Error:', acpError);
          this._composerDataService.updateComposerDataSetStore(e, o => o("status", "aborted"));
          throw acpError;
        }
      }

      // Not an ACP model - continue with normal Cursor flow
      console.log('[ACP] 🔵 Normal Cursor model, using standard flow:', modelName);
      `;

    if (mainContent.includes(searchPattern)) {
        console.log('Found submitChatMaybeAbortCurrent, applying ACP patch...');
        mainContent = mainContent.replace(searchPattern, acpInterceptionCode);

        try {
            await fs.writeFile(mainWorkbenchPath, mainContent, 'utf8');
            console.log('Main workbench patched successfully - ACP will intercept chat submissions');
        } catch (error) {
            throw new Error(`Failed to write patched main workbench: ${error.message}`);
        }
    } else {
        console.warn('⚠️  Could not find submitChatMaybeAbortCurrent pattern');
        console.warn('⚠️  Cursor version may have changed - ACP interception will NOT work');
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
