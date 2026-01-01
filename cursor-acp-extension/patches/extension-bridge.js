// Extension Bridge - Simple HTTP-based IPC
console.log("[ACP] Loading extension-bridge.js...");

try {
  // Simple bridge using HTTP localhost communication
  // Extension will run a local server on port 37842

  window.acpExtensionBridge = {
    async sendMessage(provider, message, composerId) {
      console.log('[ACP Bridge] sendMessage called with provider:', provider.id, 'composerId:', composerId);

      try {
        const response = await fetch('http://localhost:37842/acp/sendMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            provider: provider,
            message: message,
            composerId: composerId
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
    },

    async getSlashCommands(providerId) {
      console.log('[ACP Bridge] getSlashCommands called for provider:', providerId);

      try {
        const response = await fetch(`http://localhost:37842/acp/getSlashCommands?providerId=${encodeURIComponent(providerId)}`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const commands = await response.json();
        console.log('[ACP Bridge] Got slash commands:', commands.length, 'commands');
        return commands;

      } catch (error) {
        console.error('[ACP Bridge] Error fetching slash commands:', error);
        return [];
      }
    },

    async initSession(provider) {
      console.log('[ACP Bridge] initSession called for provider:', provider.id);

      try {
        const response = await fetch('http://localhost:37842/acp/initSession', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ provider })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        console.log('[ACP Bridge] Session initialized, got', result.commands?.length || 0, 'commands');
        return result;

      } catch (error) {
        console.error('[ACP Bridge] Error initializing session:', error);
        return { error: true, message: error.message, commands: [] };
      }
    }
  };

  console.log("[ACP] Extension bridge installed - using HTTP on localhost:37842");

} catch (error) {
  console.error("[ACP] FATAL ERROR in extension-bridge.js:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
