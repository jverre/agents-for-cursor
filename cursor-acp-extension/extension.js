const vscode = require('vscode');
const patcher = require('./patcher');
const checksumFixer = require('./checksum-fixer');

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {
    console.log('cursor-acp-extension activated');

    // Register enable command
    let enableCommand = vscode.commands.registerCommand('acp.enable', async () => {
        try {
            // Show which path we're patching
            const workbenchPath = require('./patcher').getWorkbenchPath();
            vscode.window.showInformationMessage(`Patching: ${workbenchPath}`);

            vscode.window.showInformationMessage('Enabling ACP integration...');

            // Apply patches
            await patcher.applyPatches();

            // Fix checksums to prevent corruption warnings
            await checksumFixer.fixChecksums();

            vscode.window.showInformationMessage(
                'ACP integration enabled! Please restart Cursor for changes to take effect.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to enable ACP: ${error.message}`);
            console.error('ACP enable error:', error);
        }
    });

    // Register disable command
    let disableCommand = vscode.commands.registerCommand('acp.disable', async () => {
        try {
            vscode.window.showInformationMessage('Disabling ACP integration...');

            // Remove patches
            await patcher.removePatches();

            // Restore original checksums
            await checksumFixer.restoreChecksums();

            vscode.window.showInformationMessage(
                'ACP integration disabled! Please restart Cursor for changes to take effect.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to disable ACP: ${error.message}`);
            console.error('ACP disable error:', error);
        }
    });

    // Register reload command
    let reloadCommand = vscode.commands.registerCommand('acp.reload', async () => {
        try {
            vscode.window.showInformationMessage('Reloading ACP integration...');

            // Remove old patches
            await patcher.removePatches();

            // Reapply patches
            await patcher.applyPatches();

            // Fix checksums
            await checksumFixer.fixChecksums();

            vscode.window.showInformationMessage(
                'ACP integration reloaded! Please restart Cursor for changes to take effect.',
                'Restart Now'
            ).then(selection => {
                if (selection === 'Restart Now') {
                    vscode.commands.executeCommand('workbench.action.reloadWindow');
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to reload ACP: ${error.message}`);
            console.error('ACP reload error:', error);
        }
    });

    context.subscriptions.push(enableCommand, disableCommand, reloadCommand);
}

function deactivate() {
    console.log('cursor-acp-extension deactivated');
}

module.exports = {
    activate,
    deactivate
};
