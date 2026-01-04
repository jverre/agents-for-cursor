const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: ACP Bridge', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('1-bridge-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Bridge Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('bridge is working', async () => {
    const running = await cursor.waitForHttpServer();
    expect(running).toBe(true);
  }, 30000);
});
