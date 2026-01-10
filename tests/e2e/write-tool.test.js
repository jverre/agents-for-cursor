const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) Write Tool', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('11-write-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Write Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('Write tool shows tool call bubble for creating new file', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('11-write-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '11-write-3');
    await cursor.screenshot('11-write-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a write (create new file)
    console.log('[Test] Sending message to trigger write (create new file)...');
    const writeMessage = 'Create a new file called tests/temp/hello-world.txt with the content "Hello, World! This is a test file."';
    await cursor.sendChatMessage(writeMessage);
    await cursor.screenshot('11-write-5-message-sent.png');

    // Wait for the response to complete
    await cursor.waitForChatResponse(90000);
    await cursor.screenshot('11-write-6-response-complete.png');

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
    await cursor.screenshot('11-write-7-tool-call-check.png');

    // Find and click on the collapsed component to expand it
    // First scroll up to make sure the component is visible
    await cursor.mainWindow.evaluate(() => {
      const chatContainer = document.querySelector('.monaco-scrollable-element');
      if (chatContainer) chatContainer.scrollTop = 0;
    });
    await cursor.sleep(300);
    
    // Use Playwright's locator to find and click the write results to expand
    let writeClicked = false;
    try {
      // Try clicking on "Edited" or "Created" or file path which is the write header
      const writeLocator = cursor.mainWindow.locator('text=/Edited|Created|Write|hello-world\\.txt/i').first();
      await writeLocator.waitFor({ timeout: 5000 });
      await writeLocator.click();
      writeClicked = true;
    } catch (e) {
      console.log('[Test] Could not click Write with locator, trying fallback...');
      // Fallback: click on any tool bubble
      writeClicked = await cursor.mainWindow.evaluate(() => {
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
    
    console.log('[Test] Write component clicked:', writeClicked);
    await cursor.sleep(500);
    await cursor.screenshot('11-write-8-expanded.png');

    // Get the content of the expanded write results
    const writeResultsContent = await cursor.mainWindow.evaluate(() => {
      // Look for content in the tool bubble itself
      const toolBubble = document.querySelector('[data-message-kind="tool"]');
      if (toolBubble) {
        const content = toolBubble.textContent;
        // Check for various indicators of write results
        return {
          found: true,
          text: content?.substring(0, 200),
          hasNoResults: content?.toLowerCase().includes('no results') || content?.toLowerCase().includes('error'),
          hasFileContent: content?.includes('Hello') || content?.includes('hello-world') || content?.includes('.txt')
        };
      }
      
      return { found: false, text: '', hasNoResults: true, hasFileContent: false };
    });

    console.log('[Test] Write results found:', writeResultsContent.found);
    console.log('[Test] Write results preview:', writeResultsContent.text);
    console.log('[Test] Has "no results":', writeResultsContent.hasNoResults);
    console.log('[Test] Has file content:', writeResultsContent.hasFileContent);

    await cursor.screenshot('11-write-9-final.png');

    // Assertions
    expect(toolCallExists).toBe(true);
    expect(writeClicked).toBe(true);
    expect(writeResultsContent.found).toBe(true);
  }, 180000); // 3 minute timeout for the full test
});
