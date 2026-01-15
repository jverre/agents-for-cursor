const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) Glob Tool', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('9-glob-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Glob Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('Glob tool shows tool call bubble with file results', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('9-glob-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '9-glob-3');
    await cursor.screenshot('9-glob-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a glob search
    console.log('[Test] Sending message to trigger glob search...');
    const globMessage = 'Find all JavaScript files in the src/patches directory using glob pattern "*.js"';
    await cursor.sendChatMessage(globMessage);
    await cursor.screenshot('9-glob-5-message-sent.png');

    // Wait for the response to complete
    await cursor.waitForChatResponse(90000);
    await cursor.screenshot('9-glob-6-response-complete.png');

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
    await cursor.screenshot('9-glob-7-tool-call-check.png');

    // Find and click on the "Globbed" or "Found" collapsed component to expand it
    // First scroll up to make sure the component is visible
    await cursor.mainWindow.evaluate(() => {
      const chatContainer = document.querySelector('.monaco-scrollable-element');
      if (chatContainer) chatContainer.scrollTop = 0;
    });
    await cursor.sleep(300);
    
    // Use Playwright's locator to find and click the glob results to expand
    // The glob tool bubble shows "Searched files" header that needs to be clicked
    const clickLocatorWithRetry = async (locator, label, attempts = 3) => {
      for (let i = 0; i < attempts; i++) {
        try {
          await locator.waitFor({ state: 'attached', timeout: 3000 });
          await locator.scrollIntoViewIfNeeded();
          await locator.click({ timeout: 3000 });
          console.log(`[Test] Clicked on "${label}" to expand`);
          return true;
        } catch (err) {
          const message = String(err?.message || err);
          if (!message.includes('Element is not attached to the DOM')) {
            throw err;
          }
          await cursor.sleep(300);
        }
      }
      return false;
    };

    let globClicked = false;
    try {
      // Try clicking on "Searched files" which is the glob header
      const searchedFilesLocator = cursor.mainWindow.locator('text=/Searched files/i').first();
      globClicked = await clickLocatorWithRetry(searchedFilesLocator, 'Searched files');
    } catch (e) {
      console.log('[Test] Could not click "Searched files", trying fallback...');
      try {
        // Fallback: try "Globbed" or "Found files"
        const globLocator = cursor.mainWindow.locator('text=/Globbed|Found.*files|glob/i').first();
        globClicked = await clickLocatorWithRetry(globLocator, 'Globbed/Found files');
      } catch (e2) {
        console.log('[Test] Could not click with locator, trying fallback...');
        // Fallback: click on any tool bubble
        globClicked = await cursor.mainWindow.evaluate(() => {
          const toolBubbles = document.querySelectorAll('[data-message-kind="tool"]');
          for (const bubble of toolBubbles) {
            const clickable = bubble.querySelector('[style*="cursor: pointer"], [role="button"]');
            if (clickable) {
              clickable.click();
              return true;
            }
          }
          // Try clicking the first tool bubble directly
          if (toolBubbles.length > 0) {
            toolBubbles[0].click();
            return true;
          }
          return false;
        });
      }
    }

    console.log('[Test] Glob component clicked:', globClicked);
    await cursor.sleep(1000); // Wait for expand animation
    await cursor.screenshot('9-glob-8-expanded.png');

    // Get the content of the expanded glob results
    const globResultsContent = await cursor.mainWindow.evaluate(() => {
      // Look for the expanded content area with file results
      const contextList = document.querySelector('.context-list--new-conversation, .context-list-item');
      if (contextList) {
        return {
          found: true,
          text: contextList.textContent,
          hasNoResults: contextList.textContent.toLowerCase().includes('no results'),
          hasFiles: contextList.textContent.includes('.js')
        };
      }
      
      // Look for tool bubbles with tool content
      const toolBubbles = document.querySelectorAll('[data-message-kind="tool"]');
      for (const bubble of toolBubbles) {
        const content = bubble.textContent;
        // Check for glob-specific content: file paths or "Searched files" header
        if (content.includes('.js') || content.includes('Searched files') || content.includes('files in')) {
          return {
            found: true,
            text: content.slice(0, 500),
            hasNoResults: content.toLowerCase().includes('no results found'),
            hasFiles: content.includes('.js')
          };
        }
      }
      
      // Also check the assistant messages for file list (Claude may render as text)
      const assistantMessages = document.querySelectorAll('[data-message-kind="assistant"]');
      for (const msg of assistantMessages) {
        const content = msg.textContent;
        if ((content.includes('.js') && content.includes('Found')) || 
            (content.includes('src/patches') && content.includes('.js'))) {
          return {
            found: true,
            text: content.slice(0, 500),
            hasNoResults: content.toLowerCase().includes('no results found'),
            hasFiles: content.includes('.js')
          };
        }
      }
      
      return { found: false, text: '', hasNoResults: true, hasFiles: false };
    });

    console.log('[Test] Glob results found:', globResultsContent.found);
    console.log('[Test] Glob results preview:', globResultsContent.text?.slice(0, 200));
    console.log('[Test] Has "no results":', globResultsContent.hasNoResults);
    console.log('[Test] Has .js files:', globResultsContent.hasFiles);
    await cursor.screenshot('9-glob-9-final.png');

    // Assertions
    expect(toolCallExists).toBe(true);
    expect(globResultsContent.found).toBe(true);
    // CRITICAL: Should NOT show "no results found"
    expect(globResultsContent.hasNoResults).toBe(false);
  }, 180000); // 3 minute timeout for the test
});
