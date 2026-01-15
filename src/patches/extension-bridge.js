// Extension Bridge - Simple HTTP-based IPC
window.ACP_DEBUG = {{ACP_DEBUG}};

window.acpLog?.('INFO', "[ACP] Loading extension-bridge.js...");

try {
  // Global logging function - sends logs to extension for file-based logging
  window.acpLog = (level, ...args) => {
    if (level === 'DEBUG' && !window.ACP_DEBUG) return;
    const msg = args.join(' ');
    if (window.ACP_DEBUG || level !== 'DEBUG') {
      console.log(`[ACP] ${msg}`);
    }
    fetch('http://localhost:37842/acp/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message: msg })
    }).catch(() => {}); // Fire and forget
  };

  // Simple bridge using HTTP localhost communication
  // Extension will run a local server on port 37842

  window.acpExtensionBridge = {
    async sendMessage(provider, message, composerId, callbacks) {
      window.acpLog?.('INFO', '[ACP Bridge] sendMessage called with provider:', provider.id, 'composerId:', composerId);

      try {
        const response = await fetch('http://localhost:37842/acp/sendMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            provider: provider,
            message: message,
            composerId: composerId,
            stream: !!callbacks  // Enable streaming if callbacks provided
          })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        if (callbacks) {
          // Streaming mode - read NDJSON chunks
          const streamStart = Date.now();
          window.acpLog?.('INFO', '[ACP Bridge] 📡 Starting streaming response...');
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';
          let fullText = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.trim()) continue;
              try {
                const data = JSON.parse(line);
                window.acpLog?.('INFO', '[ACP Bridge] Stream chunk:', data.type);

                if (data.type === 'text' && callbacks.onTextChunk) {
                  if (window.ACP_DEBUG) {
                    console.log(`[ACP Bridge] 📝 Received chunk seq=${data.seq} len=${data.content?.length} preview="${data.content?.slice(0, 30).replace(/\n/g, '\\n')}..."`);
                  }
                  fullText += data.content;
                  callbacks.onTextChunk(data.content);
                } else if (data.type === 'tool' && callbacks.onToolCall) {
                  window.acpLog?.('INFO', '[ACP Bridge] 🔧 Tool event:', data.sessionUpdate, '| id:', data.toolCallId?.slice(0, 8), '| status:', data.status, '| kind:', data.kind);
                  callbacks.onToolCall(data);
                } else if (data.type === 'done') {
                  window.acpLog?.('INFO', '[ACP Bridge] ✅ Stream done marker received');
                }
              } catch (e) {
                window.acpLog?.('ERROR', '[ACP Bridge] Error parsing chunk:', e);
              }
            }
          }

          const streamDuration = Date.now() - streamStart;
          window.acpLog?.('INFO', '[ACP Bridge] 📡 Stream completed in', streamDuration, 'ms | text length:', fullText.length);
          return { text: fullText };
        } else {
          // Non-streaming mode
          const result = await response.json();
          window.acpLog?.('INFO', '[ACP Bridge] Got response:', result);
          return result;
        }

      } catch (error) {
        window.acpLog?.('ERROR', '[ACP Bridge] Error:', error);

        return {
          error: true,
          message: `Bridge communication failed: ${error.message}. Is the extension running?`
        };
      }
    },

    async getSlashCommands(providerId) {
      window.acpLog?.('INFO', '[ACP Bridge] getSlashCommands called for provider:', providerId);

      try {
        const response = await fetch(`http://localhost:37842/acp/getSlashCommands?providerId=${encodeURIComponent(providerId)}`);

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const commands = await response.json();
        window.acpLog?.('INFO', '[ACP Bridge] Got slash commands:', commands.length, 'commands');
        return commands;

      } catch (error) {
        window.acpLog?.('ERROR', '[ACP Bridge] Error fetching slash commands:', error);
        return [];
      }
    },

    async initSession(provider) {
      window.acpLog?.('INFO', '[ACP Bridge] initSession called for provider:', provider.id);

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
        window.acpLog?.('INFO', '[ACP Bridge] Session initialized, got', result.commands?.length || 0, 'commands');
        return result;

      } catch (error) {
        window.acpLog?.('ERROR', '[ACP Bridge] Error initializing session:', error);
        return { error: true, message: error.message, commands: [] };
      }
    },

    // Get or create session for a composer (fast, no slash command wait)
    async getSession(provider, composerId) {
      window.acpLog?.('INFO', '[ACP Bridge] getSession called for provider:', provider.id, 'composerId:', composerId);

      try {
        const response = await fetch('http://localhost:37842/acp/getSession', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider, composerId })
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        window.acpLog?.('INFO', '[ACP Bridge] Got session:', result.sessionId);
        return result;

      } catch (error) {
        window.acpLog?.('ERROR', '[ACP Bridge] Error getting session:', error);
        return { error: true, message: error.message };
      }
    }
  };

  window.acpLog?.('INFO', "[ACP] Extension bridge installed - using HTTP on localhost:37842");

} catch (error) {
  window.acpLog?.('ERROR', "[ACP] FATAL ERROR in extension-bridge.js:", error);
  window.acpLog?.('ERROR', "[ACP] Stack trace:", error.stack);
}
