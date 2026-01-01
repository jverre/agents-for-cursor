const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) Model', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('acp-01-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[ACP Model Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('Claude Code (ACP) model works', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('acp-02-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', 'acp-03');
    await cursor.screenshot('acp-04-acp-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    await cursor.sendChatMessage('Who are you ?');
    await cursor.screenshot('acp-05-message-sent.png');

    const response = await cursor.waitForChatResponse(60000);
    await cursor.screenshot('acp-06-response-received.png');

    expect(response.length).toBeGreaterThan(0);
    expect(response.toLowerCase()).toContain('claude');
  }, 90000);
});
