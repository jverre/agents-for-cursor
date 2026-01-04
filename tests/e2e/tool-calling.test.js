const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) Tool Calling', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('6-tool-calling-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Tool Calling Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('Tool call bubble appears when running a bash command', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('6-tool-calling-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '6-tool-calling-3');
    await cursor.screenshot('6-tool-calling-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a tool call
    console.log('[Test] Sending message to trigger tool call...');
    await cursor.sendChatMessage("Run the command 'echo test'");
    await cursor.screenshot('6-tool-calling-5-message-sent.png');

    // Wait for the response to complete
    await cursor.waitForChatResponse(60000);
    await cursor.screenshot('6-tool-calling-6-response-complete.png');

    // Check that a tool call element exists
    const toolCallSelector = 'div[data-tool-call-id][data-message-kind="tool"]';
    const toolCallExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, toolCallSelector);

    console.log('[Test] Tool call element exists:', toolCallExists);
    await cursor.screenshot('6-tool-calling-7-final.png');

    expect(toolCallExists).toBe(true);
  }, 120000);
});
