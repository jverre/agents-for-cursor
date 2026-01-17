const fs = require('fs').promises;
const path = require('path');
const vscode = require('vscode');

// Get extension version from package.json
function getExtensionVersion() {
    const packageJson = require('../package.json');
    return packageJson.version;
}

// Token used to identify ACP patches - based on extension version
function getAcpToken() {
    return `/* ACP_PATCH_${getExtensionVersion()} */`;
}

// ACP debug flag injected into renderer patches
function getAcpDebugFlag() {
    return process.env.ACP_DEBUG === 'true';
}

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
    return getWorkbenchPath() + '.acp-backup';
}

// Get path to main workbench backup file
function getMainBackupPath() {
    return getMainWorkbenchPath() + '.acp-backup';
}

// Check if patches are valid (token with current version exists in both patched files)
async function isPatchValid() {
    try {
        const token = getAcpToken();
        const content = await fs.readFile(getWorkbenchPath(), 'utf8');
        const mainContent = await fs.readFile(getMainWorkbenchPath(), 'utf8');
        return content.includes(token) && mainContent.includes(token);
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
    const debugFlag = getAcpDebugFlag() ? 'true' : 'false';
    const extensionBridgePatch = (await readPatchFile(path.join(patchesDir, 'extension-bridge.js')))
        .replace(/\{\{ACP_DEBUG\}\}/g, debugFlag);
    const slashCommandPatch = await readPatchFile(path.join(patchesDir, 'slash-command-patch.js'));

    // Prepend patches to bootstrap workbench
    const patchedContent = getAcpToken() + '\n' +
        '// ACP Integration - DO NOT EDIT MANUALLY\n' +
        '(function() {\n' +
        '  "use strict";\n' +
        '\n' +
        extensionBridgePatch + '\n\n' +
        acpServicePatch + '\n\n' +
        slashCommandPatch + '\n\n' +
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

    // If already patched (any ACP version), restore from backup to reapply latest patch content
    if (mainContent.includes('ACP_PATCH_')) {
        try {
            const mainBackupContent = await fs.readFile(getMainBackupPath(), 'utf8');
            mainContent = mainBackupContent;
            console.log('[ACP Patcher] Restored main workbench backup to reapply patches');
        } catch {
            console.log('[ACP Patcher] Main workbench backup not found; proceeding with existing content');
        }
    }

    // Load patch patterns from JSON file
    const patterns = await loadPatchPatterns();

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
        const debugFlag = getAcpDebugFlag() ? 'true' : 'false';
        const acpInterceptionCode = chatInterceptionTemplate
            .replace(/\{\{ACP_TOKEN\}\}/g, getAcpToken())
            .replace(/\{\{ACP_DEBUG\}\}/g, debugFlag)
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
    const getterRegex = /\.length===0\?\[\.\.\.(\w+)\]:(\w)\}/;
    const getterMatch = mainContent.match(getterRegex);

    if (getterMatch) {
        const [fullMatch, fallbackVar, returnVar] = getterMatch;
        const getterReplace = `.length===0?[${patterns.acpModelDef},...${fallbackVar}]:[${patterns.acpModelDef},...${returnVar}]}`;
        mainContent = mainContent.replace(fullMatch, getterReplace);
    }

    // Add Agents section template (for future use)
    if (mainContent.includes(patterns.templateSearch)) {
        mainContent = mainContent.replace(patterns.templateSearch, patterns.templateReplace);
    }

    // Patch cursorCommandsService.getCommands to inject ACP commands
    if (mainContent.includes(patterns.cursorCommandsSearch)) {
        // Read and process the cursor commands patch template
        const cursorCommandsTemplate = await readPatchFile(path.join(__dirname, 'patches', 'cursor-commands-patch.template.js'));
        const minified = minifyTemplate(cursorCommandsTemplate);
        const cursorCommandsReplace = minified.replace('{{ORIGINAL_BODY}}', patterns.cursorCommandsLoopBody);
        mainContent = mainContent.replace(patterns.cursorCommandsSearch, cursorCommandsReplace);
        console.log('[ACP Patcher] Patched cursorCommandsService.getCommands');
    }

    // Patch ChatSlashCommandService.getCommands to inject ACP slash commands
    if (mainContent.includes(patterns.chatSlashSearch)) {
        // Read and process the chat slash command patch template
        const chatSlashTemplate = await readPatchFile(path.join(__dirname, 'patches', 'chat-slash-command-patch.template.js'));
        const minifiedChatSlash = minifyTemplate(chatSlashTemplate);
        const chatSlashReplace = minifiedChatSlash.replace('{{ORIGINAL_BODY}}', patterns.chatSlashOriginalBody);
        mainContent = mainContent.replace(patterns.chatSlashSearch, chatSlashReplace);
        console.log('[ACP Patcher] Patched ChatSlashCommandService.getCommands');
    }

    // Patch async cursorCommandsService.getCommands (used by composer dropdown)
    if (mainContent.includes(patterns.asyncCursorCmdsSearch)) {
        // Read and process the async cursor commands patch template
        const asyncCursorCmdsTemplate = await readPatchFile(path.join(__dirname, 'patches', 'async-cursor-commands-patch.template.js'));
        const minifiedAsyncCursorCmds = minifyTemplate(asyncCursorCmdsTemplate);
        const asyncCursorCmdsReplace = minifiedAsyncCursorCmds.replace('{{ORIGINAL_BODY}}', patterns.asyncCursorCmdsOriginalBody);
        mainContent = mainContent.replace(patterns.asyncCursorCmdsSearch, asyncCursorCmdsReplace);
        console.log('[ACP Patcher] Patched async cursorCommandsService.getCommands');
    }

    // Patch the dropdown call site to filter ACP commands based on composer's model
    // This filters out isACP commands unless the composer is using an ACP model
    if (mainContent.includes(patterns.dropdownCallSearch)) {
        mainContent = mainContent.replace(patterns.dropdownCallSearch, patterns.dropdownCallReplace);
        console.log('[ACP Patcher] Patched dropdown to filter ACP commands by model');
    }

    // Patch tool review service to handle ACP tool type (90)
    // This makes type 90 bubbles skip the review model (no approval UI needed)
    if (mainContent.includes(patterns.acpToolReviewSearch)) {
        mainContent = mainContent.replace(patterns.acpToolReviewSearch, patterns.acpToolReviewReplace);
        console.log('[ACP Patcher] Patched tool review service for ACP type 90');
    }

    // Patch tool bubble rendering to treat ACP type 90 like MCP tools
    // This makes ACP tool bubbles render with the MCP-style component
    if (mainContent.includes(patterns.acpToolBubbleRenderSearch)) {
        mainContent = mainContent.replaceAll(patterns.acpToolBubbleRenderSearch, patterns.acpToolBubbleRenderReplace);
        console.log('[ACP Patcher] Patched tool bubble rendering for ACP type 90');
    }

    // Register ACP_TOOL (90) in the bt enum (tool types)
    if (mainContent.includes(patterns.btEnumSearch)) {
        mainContent = mainContent.replace(patterns.btEnumSearch, patterns.btEnumReplace);
        console.log('[ACP Patcher] Registered ACP_TOOL (90) in bt enum');
    }

    // Add verb labels for ACP_TOOL in pN function (loading/completed text)
    if (mainContent.includes(patterns.verbLabelsSearch)) {
        mainContent = mainContent.replace(patterns.verbLabelsSearch, patterns.verbLabelsReplace);
        console.log('[ACP Patcher] Added verb labels for ACP_TOOL');
    }

    // Add ACP_TOOL to tool name mapping (returns "ACP" for display)
    if (mainContent.includes(patterns.toolNameSearch)) {
        mainContent = mainContent.replace(patterns.toolNameSearch, patterns.toolNameReplace);
        console.log('[ACP Patcher] Added ACP_TOOL to tool name mapping');
    }

    // Add ACP templates and _acpTool function (before _6f)
    if (mainContent.includes(patterns.acpTemplatesSearch)) {
        mainContent = mainContent.replace(patterns.acpTemplatesSearch, patterns.acpTemplatesReplace);
        console.log('[ACP Patcher] Added ACP templates and _acpTool function');
    }

    // Insert custom ACP tool component into Smo (after CALL_MCP_TOOL, before CREATE_PLAN)
    if (mainContent.includes(patterns.acpComponentSearch)) {
        mainContent = mainContent.replace(patterns.acpComponentSearch, patterns.acpComponentReplace);
        console.log('[ACP Patcher] Inserted custom ACP tool component into Smo');
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

// Minify template code: remove comments, newlines, and extra spaces
function minifyTemplate(template) {
    return template
        .replace(/\/\/.*$/gm, '') // remove single-line comments
        .replace(/\s+/g, ' ')     // collapse whitespace
        .replace(/\s*{\s*/g, '{') // remove space around braces
        .replace(/\s*}\s*/g, '}')
        .replace(/\s*\(\s*/g, '(')
        .replace(/\s*\)\s*/g, ')')
        .replace(/\s*,\s*/g, ',')
        .replace(/\s*;\s*/g, ';')
        .replace(/\s*=\s*/g, '=')
        .replace(/\s*:\s*/g, ':')
        .replace(/\s*\|\|\s*/g, '||')
        .replace(/\s*\?\.\s*/g, '?.')
        .replace(/\s*=>\s*/g, '=>')
        .replace(/\s*\.\.\.\s*/g, '...')
        .trim();
}

// Load patch patterns from JSON file
async function loadPatchPatterns() {
    const patternsPath = path.join(__dirname, 'patches', 'patch-patterns.json');
    const content = await fs.readFile(patternsPath, 'utf8');
    return JSON.parse(content);
}

module.exports = {
    applyPatches,
    removePatches,
    isPatchValid,
    getWorkbenchPath,
    getBackupPath
};
