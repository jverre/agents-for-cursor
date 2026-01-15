const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) WebFetch Tool', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('14-webfetch-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[WebFetch Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('WebFetch tool shows tool call bubble for URL fetch', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('14-webfetch-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '14-webfetch-3');
    await cursor.screenshot('14-webfetch-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a URL fetch (not a search)
    console.log('[Test] Sending message to trigger URL fetch...');
    const webFetchMessage = 'Fetch the content from https://httpbin.org/json and tell me what JSON data it returns.';
    await cursor.sendChatMessage(webFetchMessage);
    await cursor.screenshot('14-webfetch-5-message-sent.png');

    // Wait for the response to complete
    await cursor.waitForChatResponse(120000); // URL fetch may take longer
    await cursor.screenshot('14-webfetch-6-response-complete.png');

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
    await cursor.screenshot('14-webfetch-7-check.png');

    // Check if there's a tool call (WebFetch tool should be used)
    const toolCallSelector = 'div[data-tool-call-id][data-message-kind="tool"]';
    const toolCallExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, toolCallSelector);

    console.log('[Test] Tool call element exists:', toolCallExists);

    await cursor.screenshot('14-webfetch-8-final.png');

    // Assertions - tool bubble must exist
    expect(hasResponse).toBe(true);
    expect(toolCallExists).toBe(true);
  }, 180000); // 3 minute timeout for the full test
});
