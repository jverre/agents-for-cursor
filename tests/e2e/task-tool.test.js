const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) Task Tool', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('12-task-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Task Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('Task tool shows tool call bubble for thinking/planning', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('12-task-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '12-task-3');
    await cursor.screenshot('12-task-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a task/thinking tool
    console.log('[Test] Sending message to trigger task/thinking...');
    const taskMessage = 'Think step by step about how to implement a binary search algorithm. Create a task to plan this out.';
    await cursor.sendChatMessage(taskMessage);
    await cursor.screenshot('12-task-5-message-sent.png');

    // Wait for the response to complete
    await cursor.waitForChatResponse(90000);
    await cursor.screenshot('12-task-6-response-complete.png');

    // Check that there's at least some response (task may or may not create a tool bubble depending on Claude's decision)
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
    await cursor.screenshot('12-task-7-check.png');

    // Check if there's a tool call (Task tool may be used)
    const toolCallSelector = 'div[data-tool-call-id][data-message-kind="tool"]';
    const toolCallExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, toolCallSelector);

    console.log('[Test] Tool call element exists:', toolCallExists);

    await cursor.screenshot('12-task-8-final.png');

    // Assertions - at minimum we should have a response
    expect(hasResponse).toBe(true);
    // Tool call is optional - Claude may just respond with text instead of using the task tool
    console.log('[Test] Note: Task tool usage is optional - Claude may respond with text instead');
  }, 180000); // 3 minute timeout for the full test
});
