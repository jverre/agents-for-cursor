const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');
const fs = require('fs');
const os = require('os');

describe('E2E: Claude Code (ACP) File Edit Tool', () => {
  let cursor;
  let tmpFilePath;

  beforeAll(async () => {
    // Create a temporary file for the test
    const tmpDir = path.join(os.tmpdir(), 'cursor-test-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    tmpFilePath = path.join(tmpDir, 'test-file.txt');
    fs.writeFileSync(tmpFilePath, 'Hello World\nThis is a test file.\nLine three.');

    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('7-file-edit-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[File Edit Test] Cursor launched with patched user-data');
    console.log('[File Edit Test] Temp file path:', tmpFilePath);
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
    
    // Clean up temp file
    if (tmpFilePath) {
      try {
        fs.unlinkSync(tmpFilePath);
        fs.rmdirSync(path.dirname(tmpFilePath));
      } catch (e) {
        // Ignore cleanup errors
      }
    }
  });

  test('File edit tool shows tool call bubble with diff view', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('7-file-edit-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '7-file-edit-3');
    await cursor.screenshot('7-file-edit-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a file edit
    console.log('[Test] Sending message to trigger file edit...');
    const editMessage = `Edit the file at ${tmpFilePath} and add a new line at the end that says "// Added by Claude"`;
    await cursor.sendChatMessage(editMessage);
    await cursor.screenshot('7-file-edit-5-message-sent.png');

    // Wait for the response to complete
    await cursor.waitForChatResponse(90000);
    await cursor.screenshot('7-file-edit-6-response-complete.png');

    // Check that a tool call element exists with data-message-kind="tool"
    const toolCallSelector = 'div[data-tool-call-id][data-message-kind="tool"]';
    const toolCallExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, toolCallSelector);

    console.log('[Test] Tool call element exists:', toolCallExists);
    await cursor.screenshot('7-file-edit-7-tool-call-check.png');

    // Check for the diff view component (monaco-diff-editor)
    const diffEditorSelector = '.monaco-diff-editor';
    const diffEditorExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, diffEditorSelector);

    console.log('[Test] Diff editor exists:', diffEditorExists);

    // Check for the code block container with file info
    const codeBlockSelector = '.composer-code-block-container';
    const codeBlockExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, codeBlockSelector);

    console.log('[Test] Code block container exists:', codeBlockExists);

    // Check for line diff indicators (added/removed lines)
    const lineDiffSelector = '.cdr.line-insert, .cdr.char-insert, .gutter-insert, .gutter-delete';
    const lineDiffExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, lineDiffSelector);

    console.log('[Test] Line diff indicators exist:', lineDiffExists);
    await cursor.screenshot('7-file-edit-8-final.png');

    // Assertions
    expect(toolCallExists).toBe(true);
    expect(diffEditorExists).toBe(true);
    expect(codeBlockExists).toBe(true);
    expect(lineDiffExists).toBe(true);
  }, 180000); // 3 minute timeout for the test
});
