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

// Wait for a file to become accessible with retry logic
async function waitForFileAccessible(filePath, maxRetries = 20, retryDelay = 500) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            // Try to open file for reading to check accessibility
            const handle = await fs.open(filePath, 'r');
            await handle.close();
            return true;
        } catch (error) {
            // Check if error is transient (file locked/busy) vs fatal (permission denied)
            if (error.code === 'EBUSY' || error.code === 'EAGAIN' || error.code === 'ENOENT') {
                // Transient error - file is locked or not ready yet, retry
                console.log(`[ACP] File not ready (${error.code}), retry ${i + 1}/${maxRetries}: ${filePath}`);
                await new Promise(resolve => setTimeout(resolve, retryDelay));
                continue;
            } else {
                // Fatal error (EACCES, etc.)
                console.error(`[ACP] Fatal error accessing file:`, error);
                throw error;
            }
        }
    }
    throw new Error(`File not accessible after ${maxRetries * retryDelay}ms: ${filePath}`);
}

// Ensure workbench files are ready before patching
async function ensureFilesReady() {
    const workbenchPath = getWorkbenchPath();
    const mainWorkbenchPath = getMainWorkbenchPath();

    console.log('[ACP] Checking workbench file accessibility...');

    try {
        await Promise.all([
            waitForFileAccessible(workbenchPath),
            waitForFileAccessible(mainWorkbenchPath)
        ]);
        console.log('[ACP] Workbench files are accessible and ready');
        return true;
    } catch (error) {
        console.error('[ACP] Workbench files not accessible:', error);
        throw new Error(`Cannot access Cursor workbench files: ${error.message}`);
    }
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
    // Wait for files to become accessible before proceeding
    await ensureFilesReady();

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
    const searchRegex = /async submitChatMaybeAbortCurrent\((\w),(\w),(\w),(\w)=(\w+)\)\{let (\w)=(\w+)\(\);\4\.setAttribute\("requestId",\6\);/;
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
    const acpModelDef = '{defaultOn:!0,name:"acp:claude-code",clientDisplayName:"Claude Code (ACP)",serverModelName:"acp:claude-code",supportsAgent:!0,supportsMaxMode:!0,supportsNonMaxMode:!0,supportsThinking:!0,supportsImages:!1,supportsDebugMode:!1,isRecommendedForBackgroundComposer:!1,inputboxShortModelName:"Claude Code"}';
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
