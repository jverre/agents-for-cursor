const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) BashOutput Tool', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('15-bashoutput-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[BashOutput Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('BashOutput tool shows tool call bubble for background command output', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('15-bashoutput-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '15-bashoutput-3');
    await cursor.screenshot('15-bashoutput-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a background command and then reads its output
    // This is a two-step process: first start a background command, then read its output
    console.log('[Test] Sending message to start background command and read output...');
    const bashOutputMessage = 'Run "sleep 2 && echo done" in the background, then check its output after it completes.';
    await cursor.sendChatMessage(bashOutputMessage);
    await cursor.screenshot('15-bashoutput-5-message-sent.png');

    // Wait for the response to complete (may take longer due to background command)
    await cursor.waitForChatResponse(120000);
    await cursor.screenshot('15-bashoutput-6-response-complete.png');

    // Check that there's a response
    const hasResponse = await cursor.mainWindow.evaluate(() => {
      const assistantMessages = document.querySelectorAll('[data-message-kind="assistant"]');
      return assistantMessages.length > 0;
    });

    console.log('[Test] Has response:', hasResponse);
    
    // Debug: Log all message elements in the DOM
    const messageElements = await cursor.mainWindow.evaluate(() => {
      const elements = document.querySelectorAll('[data-message-kind]');
      return Array.from(elements).map(el => ({
        tagName: el.tagName,
        dataMessageKind: el.getAttribute('data-message-kind'),
        hasToolCallId: !!el.getAttribute('data-tool-call-id'),
        textPreview: el.textContent?.substring(0, 100)
      }));
    });
    console.log('[Test] Message elements in DOM:', JSON.stringify(messageElements, null, 2));
    await cursor.screenshot('15-bashoutput-7-check.png');

    // Check if there's a tool call (at least one bash-related tool should be used)
    const toolCallSelector = 'div[data-tool-call-id][data-message-kind="tool"]';
    const toolCallExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, toolCallSelector);

    console.log('[Test] Tool call element exists:', toolCallExists);

    await cursor.screenshot('15-bashoutput-8-final.png');

    // Assertions - tool bubble must exist (either bash or bash_output)
    expect(hasResponse).toBe(true);
    expect(toolCallExists).toBe(true);
  }, 180000); // 3 minute timeout for the full test
});
