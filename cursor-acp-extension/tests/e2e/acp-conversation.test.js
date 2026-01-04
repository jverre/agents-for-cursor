const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) Conversation History', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('4-acp-conversation-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[ACP Conversation Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('Claude Code (ACP) maintains conversation history', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('4-acp-conversation-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '4-acp-conversation-3');
    await cursor.screenshot('4-acp-conversation-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // First message: establish context
    console.log('[Test] Sending first message to establish context...');
    await cursor.sendChatMessage('I am Alice');
    await cursor.screenshot('4-acp-conversation-5-first-message-sent.png');

    const response1 = await cursor.waitForChatResponse(60000);
    await cursor.screenshot('4-acp-conversation-6-first-response-received.png');

    expect(response1.length).toBeGreaterThan(0);
    console.log('[Test] First response:', response1.substring(0, 100));

    // Second message: test if context is remembered
    console.log('[Test] Sending second message to test context...');
    await cursor.sendChatMessage('Who am I?');
    await cursor.screenshot('4-acp-conversation-7-second-message-sent.png');

    const response2 = await cursor.waitForChatResponse(60000);
    await cursor.screenshot('4-acp-conversation-8-second-response-received.png');

    console.log('[Test] Second response:', response2.substring(0, 100));

    // Verify Claude remembers the name
    expect(response2.length).toBeGreaterThan(0);
    expect(response2.toLowerCase()).toContain('alice');
  }, 120000);
});
