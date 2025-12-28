// Extension Bridge - Simple HTTP-based IPC
console.log("[ACP] Loading extension-bridge.js...");

try {
  // Simple bridge using HTTP localhost communication
  // Extension will run a local server on port 37842

  window.acpExtensionBridge = {
    async sendMessage(provider, messages) {
      console.log('[ACP Bridge] sendMessage called with provider:', provider.id);

      try {
        const response = await fetch('http://localhost:37842/acp/sendMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            provider: provider,
            messages: messages
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('[ACP Bridge] Got response:', result);
        return result;

      } catch (error) {
        console.error('[ACP Bridge] Error:', error);

        return {
          error: true,
          message: `Bridge communication failed: ${error.message}. Is the extension running?`
        };
      }
    }
  };

  console.log("[ACP] Extension bridge installed - using HTTP on localhost:37842");

} catch (error) {
  console.error("[ACP] FATAL ERROR in extension-bridge.js:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
