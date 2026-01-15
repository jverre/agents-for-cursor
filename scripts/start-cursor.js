#!/usr/bin/env node

/**
 * Start Cursor with the extension for manual testing
 * 
 * This script:
 * 1. Ensures isolated Cursor is installed
 * 2. Sets up test auth (copies from system Cursor)
 * 3. Applies patches if needed (disable + enable)
 * 4. Launches Cursor and keeps it running
 */

const CursorAutomation = require('../tests/helpers/playwright-helpers');
const CursorInstaller = require('../tests/helpers/cursor-installer');
const { setupTestAuth } = require('../tests/helpers/setup-test-auth');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

async function main() {
  // Always use isolated installation for local dev
  process.env.LOCAL = 'true';
  
  console.log('[Start] Setting up isolated Cursor for testing...');

  const userDataDir = path.join(__dirname, '..', 'tests', 'e2e-user-data');
  const extensionPath = path.join(__dirname, '..');

  const installer = new CursorInstaller({ useIsolated: true });

  // Step 1: Ensure Cursor is installed
  if (!installer.isInstalled()) {
    console.log('[Start] Cursor not found. Installing...');
    try {
      const installInfo = await installer.install();
      console.log(`[Start] Cursor ${installInfo.version} installed successfully`);
    } catch (error) {
      console.error('[Start] Failed to install Cursor:', error.message);
      process.exit(1);
    }
  } else {
    console.log(`[Start] Cursor already installed: ${installer.getVersion()}`);
  }

  // Step 2: Setup user data directory
  if (fs.existsSync(userDataDir)) {
    console.log('[Start] Cleaning up old user-data directory...');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  console.log('[Start] Setting up test authentication...');
  setupTestAuth();

  // Step 3: Apply patches via Playwright
  const cursor = new CursorAutomation({ 
    extensionPath, 
    userDataDir,
    useIsolated: true
  });

  const patchesApplied = await cursor.arePatchesApplied();

  console.log('[Start] Launching Cursor to apply patches...');
  await cursor.launch();
  await cursor.sleep(3000);

  console.log('[Start] Waiting for extension to activate...');
  await cursor.sleep(5000);

  if (patchesApplied) {
    console.log('[Start] Disabling existing patches...');
    await cursor.executeCommand('Agents for Cursor: Disable');
    await cursor.sleep(3000);
  }

  console.log('[Start] Enabling ACP...');
  await cursor.executeCommand('Agents for Cursor: Enable');
  
  console.log('[Start] Waiting for patches to be applied...');
  await cursor.sleep(5000);

  console.log('[Start] Closing Playwright-controlled Cursor...');
  await cursor.close();

  // Step 4: Launch Cursor for manual use via open command on macOS
  console.log('[Start] Launching Cursor for manual testing...');
  
  const executablePath = installer.getCursorExecutablePath();
  
  if (process.platform === 'darwin') {
    // On macOS, use 'open' command which properly launches the app
    const { execSync } = require('child_process');
    execSync(`open -a "${installer.installDir}" --args "${extensionPath}" --user-data-dir="${userDataDir}" --extensionDevelopmentPath="${extensionPath}"`);
  } else {
    // On Linux/Windows, spawn detached
    const cursorProcess = spawn(executablePath, [
      extensionPath,
      `--user-data-dir=${userDataDir}`,
      `--extensionDevelopmentPath=${extensionPath}`,
    ], {
      detached: true,
      stdio: 'ignore'
    });
    cursorProcess.unref();
  }

  console.log('');
  console.log('[Start] ✅ Cursor is now running!');
  console.log(`[Start] Executable: ${executablePath}`);
  console.log(`[Start] User data: ${userDataDir}`);
}

main().catch(error => {
  console.error('[Start] Error:', error);
  process.exit(1);
});
