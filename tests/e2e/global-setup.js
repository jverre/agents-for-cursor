const CursorAutomation = require('../helpers/playwright-helpers');
const CursorInstaller = require('../helpers/cursor-installer');
const { setupTestAuth } = require('../helpers/setup-test-auth');
const path = require('path');
const fs = require('fs');

/**
 * Global setup for e2e tests
 * 
 * Modes:
 * - LOCAL mode (LOCAL=true): Uses isolated Cursor at ~/.cursor-test-installation
 *   - Reuses existing installation if present (fast)
 *   - Reuses patches if already applied
 *   - Uses cached downloads
 * 
 * - CI mode (CI=true or default): Uses system Cursor installation
 *   - Fresh install each time
 *   - Expects Cursor to be pre-installed by CI workflow
 */
module.exports = async () => {
  const isLocal = process.env.LOCAL === 'true';
  const isCI = process.env.CI === 'true';
  
  console.log('[Global Setup] Starting e2e environment setup...');
  console.log(`[Global Setup] Mode: ${isLocal ? 'LOCAL' : isCI ? 'CI' : 'DEFAULT'}`);

  const userDataDir = path.join(__dirname, '..', 'e2e-user-data');
  const extensionPath = path.join(__dirname, '..', '..');

  // Use isolated installation for local development, system installation for CI
  const useIsolated = isLocal;
  
  console.log(`[Global Setup] Using ${useIsolated ? 'isolated' : 'system'} Cursor installation`);
  const installer = new CursorInstaller({ useIsolated });

  // Step 1: Ensure Cursor installation exists
  if (!installer.isInstalled()) {
    if (isCI) {
      // In CI, Cursor should be pre-installed by the workflow
      throw new Error('Cursor not installed. CI workflow should install Cursor before running tests.');
    }
    
    console.log('[Global Setup] Cursor not found. Installing...');
    console.log(`[Global Setup] Install directory: ${installer.installDir}`);
    
    try {
      const installInfo = await installer.install();
      console.log(`[Global Setup] Cursor ${installInfo.version} installed successfully`);
    } catch (error) {
      console.error('[Global Setup] Failed to install Cursor:', error.message);
      throw error;
    }
  } else {
    console.log(`[Global Setup] Cursor already installed at: ${installer.installDir}`);
    console.log(`[Global Setup] Version: ${installer.getVersion()}`);
  }

  // Step 2: Clean old user-data directory (always fresh for reliable tests)
  if (fs.existsSync(userDataDir)) {
    console.log('[Global Setup] Cleaning up old user-data directory...');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  // Step 3: Setup test auth
  console.log('[Global Setup] Setting up test authentication...');
  setupTestAuth();

  // Step 4: Create CursorAutomation
  const cursor = new CursorAutomation({ 
    extensionPath, 
    userDataDir,
    useIsolated
  });

  try {
    // Step 5: Check if patches are already applied (skip enable if so)
    const patchesApplied = await cursor.arePatchesApplied();
    
    // Always re-apply patches to ensure latest code is used
    console.log('[Global Setup] Launching Cursor...');
    await cursor.launch();
    await cursor.sleep(3000);

    console.log('[Global Setup] Waiting for extension to activate...');
    await cursor.sleep(5000);

    if (patchesApplied) {
      // Disable first to ensure clean re-apply
      console.log('[Global Setup] Patches already applied, disabling first...');
      await cursor.executeCommand('Agents for Cursor: Disable');
      await cursor.sleep(3000);
    }

    console.log('[Global Setup] Enabling ACP via extension command...');
    await cursor.enableACP();

    console.log('[Global Setup] Closing Cursor...');
    await cursor.close();

    console.log('[Global Setup] Environment setup complete!');
    console.log(`[Global Setup] Cursor: ${installer.installDir}`);
    console.log(`[Global Setup] User data: ${userDataDir}`);

  } catch (error) {
    console.error('[Global Setup] Setup failed:', error);
    await cursor.close();
    throw error;
  }
};
