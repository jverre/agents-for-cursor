// ACP Service - Provider Management
window.acpLog?.('INFO', "[ACP] Loading ACP Service...");

try {
  class ACPService {
    constructor() {
      this.providers = new Map();
      this.sessions = new Map();
      this.slashCommands = new Map(); // Map<providerId, AvailableCommand[]>
      window.acpLog?.('INFO', "[ACP] ACPService initialized");

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
      window.acpLog?.('INFO', "[ACP] Added test provider:", testProvider.id);
      // Note: Slash commands are lazy-loaded when user types '/' in composer
    }

    // Get all providers
    getProviders() {
      return Array.from(this.providers.values());
    }

    // Get provider by ID
    getProvider(providerId) {
      return this.providers.get(providerId);
    }

    // Initialize session and fetch slash commands from extension backend
    async initSession(providerId) {
      const provider = this.getProvider(providerId);
      if (!provider) {
        window.acpLog?.('ERROR', '[ACP] No provider found for:', providerId);
        return [];
      }

      if (window.acpExtensionBridge && window.acpExtensionBridge.initSession) {
        try {
          window.acpLog?.('INFO', '[ACP] Initializing session for:', providerId);
          const result = await window.acpExtensionBridge.initSession(provider);
          if (result.commands) {
            this.slashCommands.set(providerId, result.commands);
            window.acpLog?.('INFO', '[ACP] Got slash commands from init:', result.commands.length);
          }
          return result.commands || [];
        } catch (error) {
          window.acpLog?.('ERROR', '[ACP] Error initializing session:', error);
          return [];
        }
      }
      return [];
    }

    // Fetch slash commands from extension backend (cached)
    async fetchSlashCommands(providerId) {
      if (window.acpExtensionBridge && window.acpExtensionBridge.getSlashCommands) {
        try {
          const commands = await window.acpExtensionBridge.getSlashCommands(providerId);
          this.slashCommands.set(providerId, commands);
          window.acpLog?.('INFO', '[ACP] Fetched slash commands for', providerId, ':', commands.length, 'commands');
          return commands;
        } catch (error) {
          window.acpLog?.('ERROR', '[ACP] Error fetching slash commands:', error);
          return [];
        }
      }
      return [];
    }

    // Get cached slash commands for a provider
    getSlashCommands(providerId) {
      return this.slashCommands.get(providerId) || [];
    }

    // Handle ACP request (called from chat-patch.js)
    async handleRequest(modelName, message, composerId) {
      window.acpLog?.('INFO', '[ACP] Handling request for model:', modelName, 'composerId:', composerId);
      window.acpLog?.('INFO', '[ACP] Message:', message);

      // Extract provider ID from model name
      // "Claude Code (ACP)" -> "claude-code"
      // "acp:claude-code" -> "claude-code"
      let providerId = modelName.replace('acp:', '').replace(' (ACP)', '').toLowerCase().replace(/\s+/g, '-');

      const provider = this.getProvider(providerId);

      if (!provider) {
        window.acpLog?.('ERROR', '[ACP] No provider found for:', providerId);
        return {
          error: true,
          message: `ACP provider "${providerId}" not found`
        };
      }

      try {
        window.acpLog?.('INFO', '[ACP] Checking for extension bridge...');

        // Check if extension bridge is available
        if (window.acpExtensionBridge && window.acpExtensionBridge.sendMessage) {
          window.acpLog?.('INFO', '[ACP] Extension bridge found, calling sendMessage...');
          const response = await window.acpExtensionBridge.sendMessage(provider, message, composerId);
          window.acpLog?.('INFO', '[ACP] Got response from extension:', response);
          return response;
        } else {
          // Fallback to mock if extension bridge not available
          window.acpLog?.('WARN', '[ACP] Extension bridge not available, using mock response');
          window.acpLog?.('WARN', '[ACP] window.acpExtensionBridge =', window.acpExtensionBridge);
          return {
            id: 'acp-' + Date.now(),
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: modelName,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: `[ACP Mock Response]\n\nProvider: ${provider.displayName}\nCommand: ${provider.command} ${provider.args?.join(' ')}\n\nYour message: "${message}"\n\nNote: Extension bridge not available. Make sure the extension is loaded.`
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
        window.acpLog?.('ERROR', '[ACP] Error calling extension:', error);
        return {
          error: true,
          message: `ACP error: ${error.message}`
        };
      }
    }

    // Get or create session ID for a composer
    getSessionId(composerId) {
      return this.sessions.get(composerId)?.sessionId;
    }

    // Store session ID for a composer
    setSessionId(composerId, sessionId) {
      this.sessions.set(composerId, { sessionId });
    }
  }

  // Create global ACP service instance
  if (!window.acpService) {
    window.acpService = new ACPService();
    window.acpLog?.('INFO', "[ACP] ACP Service ready - window.acpService available");
    window.acpLog?.('INFO', "[ACP] Try: window.acpService.getProviders()");
    window.acpLog?.('INFO', "[ACP] Try: window.acpService.enable() to enable ACP routing");
  } else {
    window.acpLog?.('INFO', "[ACP] ACP Service already exists");
  }

  // ACP routing is automatic based on model name prefix "acp:"
  window.acpLog?.('INFO', '[ACP] 🟢 ACP routing ready - models starting with "acp:" will use ACP providers');
  window.acpLog?.('INFO', '[ACP] 🔵 All other models will use normal Cursor backend');

} catch (error) {
  console.error("[ACP] FATAL ERROR loading ACP Service:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
