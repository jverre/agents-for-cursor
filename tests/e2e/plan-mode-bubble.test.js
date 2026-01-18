const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');
describe('E2E: Plan Mode Bubble Rendering', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    await cursor.launch();
    await cursor.screenshot('16-plan-bubble-1-launched.png');
    await cursor.sleep(3000);
  }, 120000);

  afterAll(async () => {
    await cursor?.close();
  });

  test('Plan bubble appears with Build button and todos', async () => {
    await cursor.openChat();
    await cursor.screenshot('16-plan-bubble-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '16-plan-bubble-3');
    await cursor.screenshot('16-plan-bubble-4-model-selected.png');

    await cursor.selectMode('Plan', '16-plan-bubble-4');
    await cursor.screenshot('16-plan-bubble-4-mode-selected.png');

    await cursor.sleep(5000);

    await cursor.sendChatMessage('Create plan to improve readme. Keep it very basic');
    await cursor.screenshot('16-plan-bubble-5-message-sent.png');

    await cursor.waitForChatResponse(120000);
    await cursor.screenshot('16-plan-bubble-6-response-complete.png');

    const planBubbleSelector = '.composer-create-plan-container';
    await cursor.mainWindow.waitForSelector(planBubbleSelector, { timeout: 30000 });

    const buildButtonExists = await cursor.mainWindow.evaluate(() => {
      const button = document.querySelector('.composer-create-plan-build-button');
      return Boolean(button && button.textContent && button.textContent.includes('Build'));
    });

    const todoCount = await cursor.mainWindow.evaluate(() => {
      return document.querySelectorAll('.composer-create-plan-todo-item').length;
    });

    await cursor.screenshot('16-plan-bubble-7-final.png');

    expect(buildButtonExists).toBe(true);
    expect(todoCount).toBeGreaterThanOrEqual(1);
  }, 180000);
});
