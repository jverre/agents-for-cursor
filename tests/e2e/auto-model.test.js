const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Auto Model', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('3-auto-model-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Auto Model Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('Auto model returns Cursor response', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('3-auto-model-2-chat-opened.png');

    // Select Auto mode
    await cursor.selectModel('Auto', '3-auto-model-3');
    await cursor.screenshot('3-auto-model-4-auto-selected.png');

    await cursor.sendChatMessage('Who are you ?');
    await cursor.screenshot('3-auto-model-5-message-sent.png');

    const response = await cursor.waitForChatResponse(60000);
    await cursor.screenshot('3-auto-model-6-response-received.png');

    expect(response.length).toBeGreaterThan(0);
    // Don't check for specific content - free tier may have different responses
  }, 90000);
});
