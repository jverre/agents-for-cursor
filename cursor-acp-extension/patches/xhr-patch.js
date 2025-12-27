// XHR Patch - Try intercepting XMLHttpRequest instead of fetch
console.log("[ACP] Loading xhr-patch.js...");

try {
  console.log("[ACP] Setting up XMLHttpRequest interception...");

  // Store original XMLHttpRequest
  const OriginalXHR = window.XMLHttpRequest;

  // Create wrapper
  window.XMLHttpRequest = function() {
    const xhr = new OriginalXHR();

    const originalOpen = xhr.open;
    const originalSend = xhr.send;

    let method, url;

    xhr.open = function(m, u, ...args) {
      method = m;
      url = u;
      console.log('[ACP XHR] Request:', method, url);
      return originalOpen.apply(this, [m, u, ...args]);
    };

    xhr.send = function(body) {
      console.log('[ACP XHR] Send:', method, url);
      console.log('[ACP XHR] Body:', body ? body.substring(0, 200) : 'no body');

      // Check if ACP is enabled and this is a chat request
      if (window.acpService?.enabled && url && (url.includes('chat') || url.includes('completion'))) {
        console.log('[ACP XHR] ✅ Intercepting chat request!');

        try {
          const requestBody = body ? JSON.parse(body) : {};
          const messages = requestBody.messages || [];

          // Prevent the real request
          setTimeout(async () => {
            const response = await window.acpService.handleRequest(requestBody.model || 'unknown', messages);

            // Fake success response
            Object.defineProperty(xhr, 'status', { value: 200, writable: false });
            Object.defineProperty(xhr, 'responseText', { value: JSON.stringify(response), writable: false });
            Object.defineProperty(xhr, 'readyState', { value: 4, writable: false });

            const event = new Event('readystatechange');
            xhr.dispatchEvent(event);

            console.log('[ACP XHR] Sent mock response');
          }, 0);

          return; // Don't call original send
        } catch (error) {
          console.error('[ACP XHR] Error:', error);
        }
      }

      return originalSend.apply(this, arguments);
    };

    return xhr;
  };

  console.log("[ACP] XMLHttpRequest intercepted");

} catch (error) {
  console.error("[ACP] FATAL ERROR in xhr-patch.js:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
