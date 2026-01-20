const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');
const fs = require('fs');

describe('E2E: Token Counting', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('token-counting-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Token Counting Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('counts input and output tokens for simple text message', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('token-counting-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', 'token-counting-3');
    await cursor.screenshot('token-counting-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Clear logs before test
    cursor.clearAcpLogs();

    console.log('[Test] Sending simple message...');
    await cursor.sendChatMessage('Hello'); // ~5 chars = ~2 tokens
    await cursor.screenshot('token-counting-5-message-sent.png');

    const response = await cursor.waitForChatResponse(60000);
    await cursor.screenshot('token-counting-6-response-received.png');

    console.log('[Test] Response:', response.substring(0, 100));

    // Check logs for token counting
    const logs = cursor.getAcpLogs();
    console.log('[Test] ACP Logs:', logs.substring(0, 500));

    // Verify input tokens were counted
    expect(logs).toContain('Input tokens:');
    expect(logs).toMatch(/Input tokens: [0-9]+/);

    // Verify output breakdown was logged
    expect(logs).toContain('Output breakdown:');
    expect(logs).toMatch(/text=[0-9]+/);

    // Verify token usage was logged at completion
    expect(logs).toContain('Token usage:');
  }, 120000);

  test('counts tool input and output tokens for file read', async () => {
    // Create a test file with known content
    const testFilePath = path.join(__dirname, '..', '..', 'test-token-file.txt');
    const testContent = 'This is test content with exactly 40 chars'; // 40 chars = 10 tokens
    fs.writeFileSync(testFilePath, testContent);

    console.log('[Test] Created test file:', testFilePath);

    // Start a new chat
    await cursor.openChat();
    await cursor.selectModel('Claude Code (ACP)', 'token-tool-test');
    await cursor.sleep(5000);

    // Clear logs before test
    cursor.clearAcpLogs();

    console.log('[Test] Sending message to read file...');
    await cursor.sendChatMessage('Read the file test-token-file.txt');
    await cursor.screenshot('token-tool-1-message-sent.png');

    const response = await cursor.waitForChatResponse(60000);
    await cursor.screenshot('token-tool-2-response-received.png');

    console.log('[Test] Response:', response.substring(0, 100));

    // Check logs for token counting
    const logs = cursor.getAcpLogs();
    console.log('[Test] Tool token logs (first 1000 chars):', logs.substring(0, 1000));

    // Verify tool input tokens were counted
    expect(logs).toMatch(/Tool input tokens: [0-9]+/);

    // Verify tool output tokens were counted
    expect(logs).toMatch(/Tool output tokens: [0-9]+/);

    // Verify final breakdown includes all token types
    expect(logs).toMatch(/Output breakdown: text=[0-9]+ toolInput=[0-9]+ toolOutput=[0-9]+ total=[0-9]+/);

    // Parse and verify reasonable token counts
    const toolOutputMatch = logs.match(/Tool output tokens: ([0-9]+)/);
    if (toolOutputMatch) {
      const toolOutputTokens = parseInt(toolOutputMatch[1]);
      console.log('[Test] Tool output tokens:', toolOutputTokens);
      // Should be around 10 tokens for 40 chars
      expect(toolOutputTokens).toBeGreaterThan(5);
      expect(toolOutputTokens).toBeLessThan(20);
    }

    // Clean up test file
    fs.unlinkSync(testFilePath);
  }, 120000);

  test('counts multiple tool calls correctly', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.selectModel('Claude Code (ACP)', 'token-multi-tool');
    await cursor.sleep(5000);

    // Clear logs before test
    cursor.clearAcpLogs();

    console.log('[Test] Sending message that will trigger multiple tools...');
    // This should trigger search/grep tools
    await cursor.sendChatMessage('Find all occurrences of "test" in this codebase');
    await cursor.screenshot('token-multi-1-message-sent.png');

    const response = await cursor.waitForChatResponse(90000); // Longer timeout for search
    await cursor.screenshot('token-multi-2-response-received.png');

    console.log('[Test] Response length:', response.length);

    // Check logs for token counting
    const logs = cursor.getAcpLogs();

    // Should have multiple tool input/output entries
    const toolInputMatches = logs.match(/Tool input tokens: [0-9]+/g);
    const toolOutputMatches = logs.match(/Tool output tokens: [0-9]+/g);

    console.log('[Test] Tool input matches:', toolInputMatches?.length || 0);
    console.log('[Test] Tool output matches:', toolOutputMatches?.length || 0);

    // At least one tool call
    expect(toolInputMatches?.length).toBeGreaterThan(0);

    // Final breakdown should sum everything
    expect(logs).toMatch(/Output breakdown: text=[0-9]+ toolInput=[0-9]+ toolOutput=[0-9]+ total=[0-9]+/);

    // Parse final token counts
    const breakdownMatch = logs.match(/Output breakdown: text=([0-9]+) toolInput=([0-9]+) toolOutput=([0-9]+) total=([0-9]+)/);
    if (breakdownMatch) {
      const [_, text, toolInput, toolOutput, total] = breakdownMatch;
      console.log('[Test] Final breakdown - text:', text, 'toolInput:', toolInput, 'toolOutput:', toolOutput, 'total:', total);

      // Total should equal sum of parts
      expect(parseInt(total)).toBe(parseInt(text) + parseInt(toolInput) + parseInt(toolOutput));
    }
  }, 150000);
});
