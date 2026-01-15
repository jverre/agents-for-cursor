const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) Plan Mode', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    await cursor.launch();
    await cursor.screenshot('12-plan-mode-1-launched.png');
    await cursor.sleep(3000);
  }, 120000);

  afterAll(async () => {
    await cursor?.close();
  });

  test('Plan mode returns TRUE when asked', async () => {

    await cursor.openChat();
    await cursor.screenshot('12-plan-mode-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '12-plan-mode-3');
    // Open mode dropdown and verify Ask/Debug are hidden for ACP
    await cursor.mainWindow.evaluate(() => {
      const candidates = [
        document.querySelector('.composer-unified-dropdown-model'),
        document.querySelector('[data-testid="composer-model"]'),
        document.querySelector('.composer-unified-dropdown-model .monaco-highlighted-label'),
        document.querySelector('.composer-unified-dropdown-model span')
      ].filter(Boolean);
      return candidates.map(el => (el.textContent || '').trim()).find(text => text) || '';
    });

    await cursor.mainWindow.click(
      '.composer-unified-dropdown[data-mode], [data-mode].composer-unified-dropdown',
      { force: true }
    );
    await cursor.sleep(300);

    const modeItems = await cursor.mainWindow.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll(
          '.composer-unified-context-menu-item, .monaco-action-bar .action-item, [role="menuitem"]'
        )
      );
      const labels = nodes
        .filter(node => {
          const style = window.getComputedStyle(node);
          return node.offsetParent !== null && style.display !== 'none' && style.visibility !== 'hidden';
        })
        .map(node => (node.textContent || '').trim())
        .filter(text => text.length > 0);

      return labels.filter(label =>
        ['Agent', 'Plan', 'Ask', 'Debug'].some(keyword => label.startsWith(keyword))
      );
    });


    expect(modeItems.some(label => label.startsWith('Agent'))).toBe(true);
    expect(modeItems.some(label => label.startsWith('Plan'))).toBe(true);
    expect(modeItems).not.toContain('Ask');
    expect(modeItems).not.toContain('Debug');

    await cursor.mainWindow.keyboard.press('Escape');
    await cursor.sleep(200);

    await cursor.selectMode('Plan', '12-plan-mode-4');
    await cursor.screenshot('12-plan-mode-5-mode-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    await cursor.sendChatMessage('Respond with TRUE if you are in plan mode');
    await cursor.screenshot('12-plan-mode-6-message-sent.png');

    await cursor.waitForChatResponse(60000);
    await cursor.screenshot('12-plan-mode-7-response-complete.png');

    const responseText = await cursor.mainWindow.evaluate(() => {
      const sections = document.querySelectorAll('section.markdown-section');
      return Array.from(sections).map(s => s.textContent || '').join('\n');
    });

    await cursor.screenshot('12-plan-mode-8-final.png');
    expect(responseText).toContain('TRUE');
  }, 120000);
});
