// Chat Patch - Route messages to ACP providers
console.log("[ACP] Loading chat-patch.js...");

try {
  console.log("[ACP] Setting up chat message routing...");

  // Store original fetch for fallback
  const originalFetch = window.fetch;

  // Intercept fetch calls to route ACP messages
  window.fetch = async function(...args) {
    const [url, options] = args;

    // Log ALL fetch requests to see what Cursor is using
    if (url && typeof url === 'string') {
      console.log('[ACP] Fetch called:', url.substring(0, 100));
    }

    // Check if this is a chat completion request
    if (url && typeof url === 'string' && (url.includes('/chat/completions') || url.includes('chat') || url.includes('completion'))) {
      console.log('[ACP] MATCHED - Intercepted chat request:', url);

      // Parse the request body to check the model
      let requestModel = null;
      let messages = [];
      try {
        const body = options?.body ? JSON.parse(options.body) : {};
        requestModel = body.model;
        messages = body.messages || [];
        console.log('[ACP] Request model from body:', requestModel);
        console.log('[ACP] Messages:', messages.length, 'messages');
      } catch (e) {
        console.log('[ACP] Could not parse request body');
      }

      // Check if ACP routing is enabled
      const isACPRequest = window.acpService?.enabled === true;

      if (isACPRequest) {
        console.log('[ACP] ✅ This is an ACP request! Routing to ACP provider...');

        try {
          // Call ACP service to handle the request
          const response = await window.acpService.handleRequest(requestModel, messages);

          console.log('[ACP] ACP response:', response);

          // Return a mock Response object
          return new Response(JSON.stringify(response), {
            status: 200,
            headers: {
              'Content-Type': 'application/json'
            }
          });

        } catch (error) {
          console.error('[ACP] Error routing to ACP:', error);
          // Fall through to original fetch
        }
      } else {
        console.log('[ACP] Not an ACP request, using normal backend');
      }
    }

    // Not an ACP request or error occurred, use original fetch
    return originalFetch.apply(this, args);
  };

  console.log("[ACP] Chat routing installed - fetch intercepted");

  // Also watch for message submissions (for debugging)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      const composerInput = document.querySelector('[contenteditable="true"]');
      if (composerInput && document.activeElement === composerInput) {
        const message = composerInput.textContent || composerInput.innerText;
        if (message.trim()) {
          console.log('[ACP] Message submitted via Enter:', message.substring(0, 50));
        }
      }
    }
  }, true);

  console.log("[ACP] Message submit observer installed");
  console.log("[ACP] chat-patch.js loaded successfully");

  // Expose helper for testing
  window.testACPRouting = function() {
    console.log('[ACP Test] ===== ACP Routing Test =====');
    console.log('[ACP Test] Service available:', !!window.acpService);
    console.log('[ACP Test] ACP enabled:', window.acpService?.enabled);
    console.log('[ACP Test] Providers:', window.acpService?.getProviders());
    console.log('[ACP Test]');
    console.log('[ACP Test] ⚡ Quick Test:');
    console.log('[ACP Test] 1. Run: window.acpService.enable()');
    console.log('[ACP Test] 2. Send ANY message in Composer');
    console.log('[ACP Test] 3. Check console for [ACP] routing logs');
    console.log('[ACP Test] 4. Run: window.acpService.disable() to turn off');
  };

  // Auto-run test on load
  console.log('[ACP]');
  console.log('[ACP] 📋 Quick Start:');
  console.log('[ACP] Run: window.testACPRouting()');
  console.log('[ACP]');

} catch (error) {
  console.error("[ACP] FATAL ERROR in chat-patch.js:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
