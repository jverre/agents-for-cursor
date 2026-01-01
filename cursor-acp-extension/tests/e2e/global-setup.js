const CursorAutomation = require('../helpers/playwright-helpers');
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

    // Verify HTTP server is running
    console.log('[Global Setup] Verifying ACP bridge is running...');
    const running = await cursor.waitForHttpServer();
    if (!running) {
      throw new Error('ACP bridge failed to start');
    }

    console.log('[Global Setup] ACP enabled successfully');

    // Close Cursor (keep patched user-data directory)
    console.log('[Global Setup] Closing Cursor...');
    await cursor.close();
    await cursor.sleep(2000);

    console.log('[Global Setup] Environment setup complete!');
    console.log(`[Global Setup] Patched user-data directory: ${userDataDir}`);

  } catch (error) {
    console.error('[Global Setup] Setup failed:', error);
    await cursor.close();
    throw error;
  }
};
