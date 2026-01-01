const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: ACP Slash Commands', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('slash-01-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Slash Commands Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('ACP slash commands appear when typing "/" with Claude Code model', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('slash-02-chat-opened.png');

    // Select Claude Code (ACP) model
    await cursor.selectModel('Claude Code (ACP)', 'slash-03');
    await cursor.screenshot('slash-04-acp-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Type "/" to trigger slash command dropdown (don't press Enter)
    await cursor.typeInChat('/');
    await cursor.screenshot('slash-05-slash-typed.png');

    // Wait for dropdown to appear and lazy-load commands
    await cursor.sleep(3000);
    await cursor.screenshot('slash-06-after-wait.png');

    // Check if pr-comments command appears in the dropdown
    const hasPrComments = await cursor.hasTextInDropdown('pr-comments', 10000);
    await cursor.screenshot('slash-07-final.png');

    expect(hasPrComments).toBe(true);
  }, 90000);
});
