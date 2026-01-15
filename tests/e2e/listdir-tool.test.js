const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) ListDir Tool', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('10-listdir-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[ListDir Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('ListDir tool shows tool call bubble with directory listing', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('10-listdir-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '10-listdir-3');
    await cursor.screenshot('10-listdir-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a list_dir
    console.log('[Test] Sending message to trigger list_dir...');
    const listDirMessage = 'List the contents of the src directory';
    await cursor.sendChatMessage(listDirMessage);
    await cursor.screenshot('10-listdir-5-message-sent.png');

    // Wait for the response to complete
    await cursor.waitForChatResponse(90000);
    await cursor.screenshot('10-listdir-6-response-complete.png');

    // Check that a tool call element exists with data-message-kind="tool"
    const toolCallSelector = 'div[data-tool-call-id][data-message-kind="tool"]';
    const toolCallExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, toolCallSelector);

    console.log('[Test] Tool call element exists:', toolCallExists);
    
    // Debug: Log all tool-related elements in the DOM
    const toolElements = await cursor.mainWindow.evaluate(() => {
      const elements = document.querySelectorAll('[data-tool-call-id], [data-message-kind]');
      return Array.from(elements).map(el => ({
        tagName: el.tagName,
        dataToolCallId: el.getAttribute('data-tool-call-id'),
        dataMessageKind: el.getAttribute('data-message-kind'),
        className: el.className.substring(0, 100)
      }));
    });
    console.log('[Test] Tool elements in DOM:', JSON.stringify(toolElements, null, 2));
    await cursor.screenshot('10-listdir-7-tool-call-check.png');

    // Find and click on the "Listed" or "Listing" collapsed component to expand it
    // First scroll up to make sure the component is visible
    await cursor.mainWindow.evaluate(() => {
      const chatContainer = document.querySelector('.monaco-scrollable-element');
      if (chatContainer) chatContainer.scrollTop = 0;
    });
    await cursor.sleep(300);
    
    // Use Playwright's locator to find and click the list_dir results to expand
    let listDirClicked = false;
    try {
      // Try clicking on "Listed" or similar text which is the list_dir header
      const listDirLocator = cursor.mainWindow.locator('text=/Listed|List.*directory|src\\//i').first();
      await listDirLocator.waitFor({ timeout: 5000 });
      await listDirLocator.click();
      listDirClicked = true;
    } catch (e) {
      console.log('[Test] Could not click ListDir with locator, trying fallback...');
      // Fallback: click on any tool bubble
      listDirClicked = await cursor.mainWindow.evaluate(() => {
        const toolBubbles = document.querySelectorAll('[data-message-kind="tool"]');
        for (const bubble of toolBubbles) {
          const clickable = bubble.querySelector('[class*="collapsed"], [class*="header"], button, [role="button"]');
          if (clickable) {
            clickable.click();
            return true;
          }
          // Try clicking the bubble itself
          bubble.click();
          return true;
        }
        return false;
      });
    }
    
    console.log('[Test] ListDir component clicked:', listDirClicked);
    await cursor.sleep(500);
    await cursor.screenshot('10-listdir-8-expanded.png');

    // Get the content of the expanded list_dir results
    const listDirResultsContent = await cursor.mainWindow.evaluate(() => {
      // Look for content in the tool bubble itself
      const toolBubble = document.querySelector('[data-message-kind="tool"]');
      if (toolBubble) {
        const content = toolBubble.textContent;
        // Check for various indicators of list_dir results
        // Could be showing folders like patches/, or files
        return {
          found: true,
          text: content?.substring(0, 200),
          hasNoResults: content?.toLowerCase().includes('no results') || content?.toLowerCase().includes('empty'),
          hasDirContent: content?.includes('/') || content?.includes('.js') || content?.includes('patches')
        };
      }
      
      // Fallback: look for any element that might contain the directory listing
      const possibleContainers = document.querySelectorAll('.context-list-item, .file-list, [class*="tree"]');
      for (const container of possibleContainers) {
        const content = container.textContent;
        if (content && (content.includes('/') || content.includes('.js'))) {
          return {
            found: true,
            text: content?.substring(0, 200),
            hasNoResults: false,
            hasDirContent: true
          };
        }
      }
      
      return { found: false, text: '', hasNoResults: true, hasDirContent: false };
    });

    console.log('[Test] ListDir results found:', listDirResultsContent.found);
    console.log('[Test] ListDir results preview:', listDirResultsContent.text);
    console.log('[Test] Has "no results":', listDirResultsContent.hasNoResults);
    console.log('[Test] Has directory content:', listDirResultsContent.hasDirContent);

    await cursor.screenshot('10-listdir-9-final.png');

    // Assertions
    expect(toolCallExists).toBe(true);
    expect(listDirClicked).toBe(true);
    expect(listDirResultsContent.found).toBe(true);
    expect(listDirResultsContent.hasNoResults).toBe(false);
  }, 180000); // 3 minute timeout for the full test
});
