const CursorAutomation = require('../helpers/playwright-helpers');
const path = require('path');

describe('E2E: Claude Code (ACP) Grep Tool', () => {
  let cursor;

  beforeAll(async () => {
    cursor = new CursorAutomation({
      extensionPath: path.join(__dirname, '..', '..'),
      userDataDir: path.join(__dirname, '..', 'e2e-user-data')
    });

    // Launch Cursor with pre-patched user-data directory
    await cursor.launch();
    await cursor.screenshot('8-grep-1-launched.png');

    // Wait for app to initialize
    await cursor.sleep(3000);
    console.log('[Grep Test] Cursor launched with patched user-data');
  }, 120000); // 2 minute timeout for launch

  afterAll(async () => {
    await cursor?.close();
  });

  test('Grep tool shows tool call bubble with search results', async () => {
    // Start a new chat
    await cursor.openChat();
    await cursor.screenshot('8-grep-2-chat-opened.png');

    await cursor.selectModel('Claude Code (ACP)', '8-grep-3');
    await cursor.screenshot('8-grep-4-model-selected.png');

    // Wait for extension HTTP server to be ready
    await cursor.sleep(5000);

    // Send message that triggers a grep search
    console.log('[Test] Sending message to trigger grep search...');
    const grepMessage = 'Search for "TOOL_FORMER_CAPABILITY" in the src/patches directory using grep';
    await cursor.sendChatMessage(grepMessage);
    await cursor.screenshot('8-grep-5-message-sent.png');

    // Wait for the response to complete
    await cursor.waitForChatResponse(90000);
    await cursor.screenshot('8-grep-6-response-complete.png');

    // Check that a tool call element exists with data-message-kind="tool"
    const toolCallSelector = 'div[data-tool-call-id][data-message-kind="tool"]';
    const toolCallExists = await cursor.mainWindow.evaluate((selector) => {
      return document.querySelector(selector) !== null;
    }, toolCallSelector);

    console.log('[Test] Tool call element exists:', toolCallExists);
    await cursor.screenshot('8-grep-7-tool-call-check.png');

    // Find and click on the "Grepped" collapsed component to expand it
    // First scroll up to make sure the Grepped component is visible
    await cursor.mainWindow.evaluate(() => {
      const chatContainer = document.querySelector('.monaco-scrollable-element');
      if (chatContainer) chatContainer.scrollTop = 0;
    });
    await cursor.sleep(300);
    
    // Use Playwright's locator to find and click the Grepped text
    // The structure is: div[style*="cursor: pointer"] containing span with "Grepped"
    let greppedClicked = false;
    try {
      // Try clicking on the row containing "Grepped" text
      const greppedLocator = cursor.mainWindow.locator('text=Grepped').first();
      await greppedLocator.waitFor({ timeout: 5000 });
      await greppedLocator.click();
      greppedClicked = true;
    } catch (e) {
      console.log('[Test] Could not click Grepped with locator, trying evaluate...');
      // Fallback: use evaluate to find and click
      greppedClicked = await cursor.mainWindow.evaluate(() => {
        // Find all elements and look for one containing exactly "Grepped"
        const allElements = document.querySelectorAll('*');
        for (const el of allElements) {
          if (el.childNodes.length === 1 && 
              el.childNodes[0].nodeType === 3 && 
              el.textContent.trim() === 'Grepped') {
            // Found the span with just "Grepped" text, click its clickable parent
            let clickTarget = el;
            while (clickTarget && clickTarget !== document.body) {
              const style = window.getComputedStyle(clickTarget);
              if (style.cursor === 'pointer') {
                clickTarget.click();
                return true;
              }
              clickTarget = clickTarget.parentElement;
            }
            el.click();
            return true;
          }
        }
        return false;
      });
    }

    console.log('[Test] Grepped component clicked:', greppedClicked);
    await cursor.sleep(1000); // Wait for expand animation
    await cursor.screenshot('8-grep-8-expanded.png');

    // Get the content of the expanded grep results
    const grepResultsContent = await cursor.mainWindow.evaluate(() => {
      // Look for the expanded content area with file results
      const contextList = document.querySelector('.context-list--new-conversation, .context-list-item');
      if (contextList) {
        return {
          found: true,
          text: contextList.textContent,
          hasNoResults: contextList.textContent.toLowerCase().includes('no results')
        };
      }
      
      // Fallback: look for any scrollable content in tool bubbles
      const toolBubbles = document.querySelectorAll('[data-message-kind="tool"]');
      for (const bubble of toolBubbles) {
        const content = bubble.textContent;
        if (content.includes('Grepped')) {
          return {
            found: true,
            text: content.slice(0, 500),
            hasNoResults: content.toLowerCase().includes('no results found')
          };
        }
      }
      
      return { found: false, text: '', hasNoResults: true };
    });

    console.log('[Test] Grep results found:', grepResultsContent.found);
    console.log('[Test] Grep results preview:', grepResultsContent.text?.slice(0, 200));
    console.log('[Test] Has "no results":', grepResultsContent.hasNoResults);
    await cursor.screenshot('8-grep-9-final.png');

    // Assertions
    expect(toolCallExists).toBe(true);
    expect(grepResultsContent.found).toBe(true);
    // CRITICAL: Should NOT show "no results found"
    expect(grepResultsContent.hasNoResults).toBe(false);
  }, 180000); // 3 minute timeout for the test
});
