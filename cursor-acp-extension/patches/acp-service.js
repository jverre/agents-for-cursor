// ACP Service - Provider Management
console.log("[ACP] Loading ACP Service...");

try {
  class ACPService {
    constructor() {
      this.providers = new Map();
      this.sessions = new Map();
      this.slashCommands = new Map(); // Map<providerId, AvailableCommand[]>
      this.activeStreams = new Map(); // Map<sessionId, EventSource>
      this.streamCallbacks = new Map(); // Map<sessionId, {onTextChunk, onToolCall}>
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
        console.error('[ACP] No provider found for:', providerId);
        return [];
      }

      if (window.acpExtensionBridge && window.acpExtensionBridge.initSession) {
        try {
          console.log('[ACP] Initializing session for:', providerId);
          const result = await window.acpExtensionBridge.initSession(provider);
          if (result.commands) {
            this.slashCommands.set(providerId, result.commands);
            console.log('[ACP] Got slash commands from init:', result.commands.length);
          }
          return result.commands || [];
        } catch (error) {
          console.error('[ACP] Error initializing session:', error);
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
          console.log('[ACP] Fetched slash commands for', providerId, ':', commands.length, 'commands');
          return commands;
        } catch (error) {
          console.error('[ACP] Error fetching slash commands:', error);
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
      console.log('[ACP] Handling request for model:', modelName, 'composerId:', composerId);
      console.log('[ACP] Message:', message);

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
          const response = await window.acpExtensionBridge.sendMessage(provider, message, composerId);
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
        console.error('[ACP] Error calling extension:', error);
        return {
          error: true,
          message: `ACP error: ${error.message}`
        };
      }
    }

    // Set callbacks for streaming updates (keyed by sessionId)
    setStreamCallbacks(sessionId, callbacks) {
      console.log('[ACP] Setting stream callbacks for session:', sessionId?.slice(0, 12));
      this.streamCallbacks.set(sessionId, callbacks);
    }

    // Legacy method for backwards compatibility
    setToolCallListener(sessionId, callback) {
      const existing = this.streamCallbacks.get(sessionId) || {};
      this.streamCallbacks.set(sessionId, { ...existing, onToolCall: callback });
    }

    // Start streaming updates for a session
    // Returns a Promise that resolves when stream is connected
    async startStreaming(sessionId) {
      // Close existing stream if any
      this.stopStreaming(sessionId);

      if (!window.acpExtensionBridge?.subscribeToStream) {
        console.warn('[ACP] Extension bridge does not support streaming');
        return;
      }

      console.log('[ACP] Starting stream for session:', sessionId?.slice(0, 12));

      const stream = await window.acpExtensionBridge.subscribeToStream(sessionId, {
        onTextChunk: (content) => {
          console.log('[ACP Service] onTextChunk:', content?.length, 'chars');
          const callbacks = this.streamCallbacks.get(sessionId);
          console.log('[ACP Service] Callbacks found:', !!callbacks?.onTextChunk);
          if (callbacks?.onTextChunk) {
            callbacks.onTextChunk(content);
          }
        },
        onToolCall: (toolCall) => {
          console.log('[ACP Service] onToolCall:', toolCall.name || toolCall.tool);
          const callbacks = this.streamCallbacks.get(sessionId);
          if (callbacks?.onToolCall) {
            callbacks.onToolCall(toolCall);
          }
        }
      });

      this.activeStreams.set(sessionId, stream);
      console.log('[ACP] Stream connected for session:', sessionId?.slice(0, 12));
    }

    // Stop streaming for a session
    stopStreaming(sessionId) {
      const stream = this.activeStreams.get(sessionId);
      if (stream) {
        console.log('[ACP] Stopping stream for session:', sessionId?.slice(0, 12));
        if (stream.close) stream.close();
        this.activeStreams.delete(sessionId);
      }
      this.streamCallbacks.delete(sessionId);
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
