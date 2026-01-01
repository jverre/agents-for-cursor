const fs = require('fs').promises;
const path = require('path');
const vscode = require('vscode');

/**
 * Patcher for Cursor ACP Integration
 *
 * Approach: Single-attempt, fail-fast file operations (no retry/polling)
 * This matches the battle-tested pattern from the Monkey Patch extension (200K+ downloads)
 *
 * Files are assumed to be accessible when activate() is called because:
 * - Extensions activate AFTER the app is fully loaded
 * - File locking is rare on macOS/Linux
 * - If files aren't accessible, we fail immediately with a clear error
 */

// Get the Cursor app root path
function getCursorAppRoot() {
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
        const content = await fs.readFile(getWorkbenchPath(), 'utf8');
        const mainContent = await fs.readFile(getMainWorkbenchPath(), 'utf8');
        return content.includes('// ACP Integration') && mainContent.includes('/* ACP CHAT INTERCEPTION */');
    } catch {
        return false;
    }
}

// Apply patches to workbench file
async function applyPatches() {
    const workbenchPath = getWorkbenchPath();
    const backupPath = getBackupPath();

    const content = await fs.readFile(workbenchPath, 'utf8');

    // Create backup if it doesn't exist
    try {
        await fs.access(backupPath);
    } catch {
        await fs.writeFile(backupPath, content, 'utf8');
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
        '\n' +
        extensionBridgePatch + '\n\n' +
        acpServicePatch + '\n\n' +
        modelPatch + '\n' +
        '})();\n' +
        '\n' +
        content;

    await fs.writeFile(workbenchPath, patchedContent, 'utf8');
    await patchMainWorkbench();
}

// Patch the main workbench file to inject ACP routing directly into submitChatMaybeAbortCurrent
async function patchMainWorkbench() {
    const mainWorkbenchPath = getMainWorkbenchPath();
    const mainBackupPath = getMainBackupPath();

    let mainContent = await fs.readFile(mainWorkbenchPath, 'utf8');

    // Check if already patched
    if (mainContent.includes('/* ACP CHAT INTERCEPTION */')) {
        return;
    }

    // Create backup
    try {
        await fs.access(mainBackupPath);
    } catch {
        await fs.writeFile(mainBackupPath, mainContent, 'utf8');
    }

    // Find and patch submitChatMaybeAbortCurrent function
    // Note: \s* allows for spaces and newlines in formatted/minified code
    const searchRegex = /async submitChatMaybeAbortCurrent\((\w),\s*(\w),\s*(\w),\s*(\w)\s*=\s*(\w+)\)\s*\{\s*let\s+(\w)\s*=\s*(\w+)\(\);?\s*\4\.setAttribute\(\s*"requestId"\s*,\s*\6\s*\);/;
    const match = mainContent.match(searchRegex);

    if (match) {
        const [, e, t, n, s, defaultVal, r, ssFunc] = match;
        const searchPattern = match[0];

        // Read chat interception template and substitute variables
        const chatInterceptionTemplate = await readPatchFile(path.join(__dirname, 'patches', 'chat-interception.js'));
        const acpInterceptionCode = chatInterceptionTemplate
            .replace(/\{\{e\}\}/g, e)
            .replace(/\{\{t\}\}/g, t)
            .replace(/\{\{n\}\}/g, n)
            .replace(/\{\{s\}\}/g, s)
            .replace(/\{\{defaultVal\}\}/g, defaultVal)
            .replace(/\{\{r\}\}/g, r)
            .replace(/\{\{ssFunc\}\}/g, ssFunc)
            .trimEnd() + '\n      ';

        mainContent = mainContent.replace(searchPattern, acpInterceptionCode);
    }

    // Inject ACP model into getAvailableDefaultModels getter
    const acpModelDef = '{defaultOn:!0,name:"acp:claude-code",clientDisplayName:"Claude Code (ACP)",serverModelName:"acp:claude-code",supportsAgent:!0,supportsMaxMode:!0,supportsNonMaxMode:!0,supportsThinking:!0,supportsImages:!1,isRecommendedForBackgroundComposer:!1,inputboxShortModelName:"Claude Code"}';
    const getterRegex = /\.length===0\?\[\.\.\.(\w+)\]:(\w)\}/;
    const getterMatch = mainContent.match(getterRegex);

    if (getterMatch) {
        const [fullMatch, fallbackVar, returnVar] = getterMatch;
        const getterReplace = `.length===0?[${acpModelDef},...${fallbackVar}]:[${acpModelDef},...${returnVar}]}`;
        mainContent = mainContent.replace(fullMatch, getterReplace);
    }

    // Add Agents section template (for future use)
    const templateSearch = 'nBf=be("<div class=settings-menu-hoverable><div></div><div>API Keys")';
    const templateReplace = 'nBf=be("<div class=settings-menu-hoverable><div></div><div>API Keys"),acpAgentsBf=be("<div class=settings-menu-hoverable><div></div><div>Agents")';

    if (mainContent.includes(templateSearch)) {
        mainContent = mainContent.replace(templateSearch, templateReplace);
    }

    await fs.writeFile(mainWorkbenchPath, mainContent, 'utf8');
}

// Remove patches from workbench files
async function removePatches() {
    try {
        const backupContent = await fs.readFile(getBackupPath(), 'utf8');
        await fs.writeFile(getWorkbenchPath(), backupContent, 'utf8');
    } catch {}

    try {
        const mainBackupContent = await fs.readFile(getMainBackupPath(), 'utf8');
        await fs.writeFile(getMainWorkbenchPath(), mainBackupContent, 'utf8');
    } catch {}
}

// Helper to read patch files
async function readPatchFile(filePath) {
    try {
        return await fs.readFile(filePath, 'utf8');
    } catch {
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
