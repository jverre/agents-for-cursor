// ACP Service - Provider Management
console.log("[ACP] Loading ACP Service...");

try {
  class ACPService {
    constructor() {
      this.providers = new Map();
      this.sessions = new Map();
      console.log("[ACP] ACPService initialized");

      // Add test provider (will load from config file later)
      this.addTestProvider();
    }

    // Add a test provider (hardcoded for testing)
    addTestProvider() {
      const testProvider = {
        id: 'claude-code',
        displayName: 'Claude Code',
        type: 'stdio',
        command: 'npx',  // Use npx to auto-install claude-code-acp
        args: ['--yes', '@zed-industries/claude-code-acp'],
        capabilities: {
          supportsAgent: true,
          supportsImages: false,
          supportsThinking: true
        },
        status: 'disconnected',
        env: {
          // ANTHROPIC_API_KEY inherited from parent process
        }
      };

      this.providers.set('claude-code', testProvider);
      console.log("[ACP] Added test provider:", testProvider.id);
    }

    // Get all providers
    getProviders() {
      return Array.from(this.providers.values());
    }

    // Get provider by ID
    getProvider(providerId) {
      return this.providers.get(providerId);
    }

    // Handle ACP request (called from chat-patch.js)
    async handleRequest(modelName, messages) {
      console.log('[ACP] Handling request for model:', modelName);
      console.log('[ACP] Messages:', messages);

      // Extract provider ID from model name
      // "Claude Code (ACP)" -> "claude-code"
      // "acp:claude-code" -> "claude-code"
      let providerId = modelName.replace('acp:', '').replace(' (ACP)', '').toLowerCase().replace(/\s+/g, '-');

      const provider = this.getProvider(providerId);

      if (!provider) {
        console.error('[ACP] No provider found for:', providerId);
        return {
          error: true,
          message: `ACP provider "${providerId}" not found`
        };
      }

      try {
        console.log('[ACP] Checking for extension bridge...');

        // Check if extension bridge is available
        if (window.acpExtensionBridge && window.acpExtensionBridge.sendMessage) {
          console.log('[ACP] Extension bridge found, calling sendMessage...');
          const response = await window.acpExtensionBridge.sendMessage(provider, messages);
          console.log('[ACP] Got response from extension:', response);
          return response;
        } else {
          // Fallback to mock if extension bridge not available
          console.warn('[ACP] Extension bridge not available, using mock response');
          console.warn('[ACP] window.acpExtensionBridge =', window.acpExtensionBridge);
          return {
            id: 'acp-' + Date.now(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: `[ACP Mock Response]\n\nProvider: ${provider.displayName}\nCommand: ${provider.command} ${provider.args?.join(' ')}\n\nYour message: "${messages[messages.length - 1]?.content || 'unknown'}"\n\nNote: Extension bridge not available. Make sure the extension is loaded.`
              },
              finish_reason: 'stop'
            }],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150
            }
          };
        }
      } catch (error) {
        console.error('[ACP] Error calling extension:', error);
        return {
          error: true,
          message: `ACP error: ${error.message}`
        };
      }
    }
  }

  // Create global ACP service instance
  if (!window.acpService) {
    window.acpService = new ACPService();
    console.log("[ACP] ACP Service ready - window.acpService available");
    console.log("[ACP] Try: window.acpService.getProviders()");
    console.log("[ACP] Try: window.acpService.enable() to enable ACP routing");
  } else {
    console.log("[ACP] ACP Service already exists");
  }

  // ACP routing is automatic based on model name prefix "acp:"
  console.log('[ACP] 🟢 ACP routing ready - models starting with "acp:" will use ACP providers');
  console.log('[ACP] 🔵 All other models will use normal Cursor backend');

} catch (error) {
  console.error("[ACP] FATAL ERROR loading ACP Service:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
