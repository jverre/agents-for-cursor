const CursorAutomation = require('../helpers/playwright-helpers');
const { setupTestAuth } = require('../helpers/setup-test-auth');
const path = require('path');
const fs = require('fs');

module.exports = async () => {
  console.log('[Global Setup] Starting e2e environment setup...');

  const userDataDir = path.join(__dirname, '..', 'e2e-user-data');
  const extensionPath = path.join(__dirname, '..', '..');

  // Clean old user-data directory
  if (fs.existsSync(userDataDir)) {
    console.log('[Global Setup] Cleaning up old user-data directory...');
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }

  // Setup test auth (creates user-data dir with auth tokens if provided)
  console.log('[Global Setup] Setting up test authentication...');
  setupTestAuth();

  const cursor = new CursorAutomation({ extensionPath, userDataDir });

  try {
    // Launch Cursor with extension
    console.log('[Global Setup] Launching Cursor...');
    await cursor.launch();
    await cursor.sleep(3000);

    // Wait for extension to activate
    console.log('[Global Setup] Waiting for extension to activate...');
    await cursor.sleep(5000);

    // Enable ACP (applies patches and restarts)
    console.log('[Global Setup] Enabling ACP...');
    await cursor.enableACP();

    // Close Cursor (keep patched user-data directory)
    console.log('[Global Setup] Closing Cursor...');
    await cursor.close();

    console.log('[Global Setup] Environment setup complete!');
    console.log(`[Global Setup] Patched user-data directory: ${userDataDir}`);

  } catch (error) {
    console.error('[Global Setup] Setup failed:', error);
    await cursor.close();
    throw error;
  }
};
