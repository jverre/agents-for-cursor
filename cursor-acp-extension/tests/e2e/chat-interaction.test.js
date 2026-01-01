const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Cursor ACP Extension', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with extension
    await cursor.launch();
    await cursor.screenshot('01-launched.png');

    // Wait for app UI to initialize (keep 3s for Electron/UI stability)
    await cursor.sleep(3000);
    await cursor.screenshot('01b-after-ui-ready.png');

    // Enable ACP and restart (extension activates with onStartupFinished)
    await cursor.enableACP();
    await cursor.screenshot('03-acp-enabled.png');
  }, 180000);

  afterAll(async () => {
    await cursor?.close();
  });

  test('bridge is working', async () => {
    const running = await cursor.waitForHttpServer();
    expect(running).toBe(true);
  }, 30000);

  test('Auto model returns Cursor response', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('04a-chat-opened.png');

    // Select Auto mode
    await cursor.selectModel('Auto', '04');
    await cursor.screenshot('04d-auto-selected.png');

    await cursor.sendChatMessage('Who are you ?');
    await cursor.screenshot('05-auto-message-sent.png');

    const response = await cursor.waitForChatResponse(60000);
    await cursor.screenshot('06-auto-response-received.png');

    expect(response.length).toBeGreaterThan(0);
    // Don't check for specific content - free tier may have different responses
  }, 90000);

  test('Claude Code (ACP) model works', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('07a-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '07');
    await cursor.screenshot('07d-acp-model-selected.png');

    await cursor.sendChatMessage('Who are you ?');
    await cursor.screenshot('08-acp-message-sent.png');

    const response = await cursor.waitForChatResponse(60000);
    await cursor.screenshot('09-acp-response-received.png');

    expect(response.length).toBeGreaterThan(0);
    expect(response.toLowerCase()).toContain('claude');
  }, 90000);
});
