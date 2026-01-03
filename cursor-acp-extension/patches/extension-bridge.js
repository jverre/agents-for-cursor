// Extension Bridge - Simple HTTP-based IPC
console.log("[ACP] Loading extension-bridge.js...");

try {
  // Simple bridge using HTTP localhost communication
  // Extension will run a local server on port 37842

  window.acpExtensionBridge = {
    async sendMessage(provider, message, composerId, callbacks) {
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
          console.log('[ACP Bridge] 📡 Starting streaming response...');
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
                console.log('[ACP Bridge] Stream chunk:', data.type);

                if (data.type === 'text' && callbacks.onTextChunk) {
                  console.log(`[ACP Bridge] 📝 Received chunk seq=${data.seq} len=${data.content?.length} preview="${data.content?.slice(0, 30).replace(/\n/g, '\\n')}..."`);
                  fullText += data.content;
                  callbacks.onTextChunk(data.content);
                } else if (data.type === 'tool' && callbacks.onToolCall) {
                  console.log('[ACP Bridge] 🔧 Tool event:', data.sessionUpdate, '| id:', data.toolCallId?.slice(0, 8), '| status:', data.status, '| kind:', data.kind);
                  callbacks.onToolCall(data);
                } else if (data.type === 'done') {
                  console.log('[ACP Bridge] ✅ Stream done marker received');
                }
              } catch (e) {
                console.error('[ACP Bridge] Error parsing chunk:', e);
              }
            }
          }

          const streamDuration = Date.now() - streamStart;
          console.log('[ACP Bridge] 📡 Stream completed in', streamDuration, 'ms | text length:', fullText.length);
          return { text: fullText };
        } else {
          // Non-streaming mode
          const result = await response.json();
          console.log('[ACP Bridge] Got response:', result);
          return result;
        }

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
    },

    // Get or create session for a composer (fast, no slash command wait)
    async getSession(provider, composerId) {
      console.log('[ACP Bridge] getSession called for provider:', provider.id, 'composerId:', composerId);

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
        console.log('[ACP Bridge] Got session:', result.sessionId);
        return result;

      } catch (error) {
        console.error('[ACP Bridge] Error getting session:', error);
        return { error: true, message: error.message };
      }
    },

    // Subscribe to streaming updates via fetch with ReadableStream
    // Returns a Promise that resolves with an abort controller
    subscribeToStream(sessionId, callbacks) {
      console.log('[ACP Bridge] 🔵 Subscribing to stream for session:', sessionId);

      return new Promise(async (resolve, reject) => {
        const url = `http://localhost:37842/acp/stream/${encodeURIComponent(sessionId)}`;
        console.log('[ACP Bridge] 🔵 Opening fetch stream to:', url);

        const abortController = new AbortController();

        try {
          const response = await fetch(url, { signal: abortController.signal });

          if (!response.ok) {
            reject(new Error(`HTTP ${response.status}`));
            return;
          }

          console.log('[ACP Bridge] ✅ Stream connected for session:', sessionId);
          if (callbacks.onConnected) callbacks.onConnected();

          // Return abort controller so caller can close the stream
          resolve({ close: () => abortController.abort() });

          // Read the stream
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });

            // Process complete SSE messages (end with \n\n)
            const messages = buffer.split('\n\n');
            buffer = messages.pop() || ''; // Keep incomplete message in buffer

            for (const msg of messages) {
              if (!msg.trim()) continue;

              // Parse SSE format: "data: {...}"
              const dataMatch = msg.match(/^data:\s*(.+)$/m);
              if (!dataMatch) continue;

              try {
                const data = JSON.parse(dataMatch[1]);
                console.log('[ACP Bridge] Stream message:', data.type);

                if (data.type === 'agent_message_chunk' && callbacks.onTextChunk) {
                  callbacks.onTextChunk(data.content);
                } else if ((data.type === 'tool_call' || data.type === 'tool_call_update') && callbacks.onToolCall) {
                  callbacks.onToolCall(data);
                }
              } catch (e) {
                console.error('[ACP Bridge] Error parsing stream data:', e);
              }
            }
          }
        } catch (error) {
          if (error.name === 'AbortError') {
            console.log('[ACP Bridge] Stream aborted');
          } else {
            console.error('[ACP Bridge] Stream error:', error);
            reject(error);
          }
        }
      });
    },

    // Legacy method for backwards compatibility
    subscribeToToolCalls(sessionId, onToolCall) {
      return this.subscribeToStream(sessionId, { onToolCall });
    }
  };

  console.log("[ACP] Extension bridge installed - using HTTP on localhost:37842");

} catch (error) {
  console.error("[ACP] FATAL ERROR in extension-bridge.js:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
