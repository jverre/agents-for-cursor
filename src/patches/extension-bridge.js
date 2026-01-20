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

  // Token display UI - we only use real SDK data, no estimation
  const formatTokenCount = (count) => {
    if (count >= 1000000) return (count / 1000000).toFixed(1) + 'm';
    if (count >= 1000) return (count / 1000).toFixed(1) + 'k';
    return count.toString();
  };

  const createTokenDisplay = (id) => {
    const container = document.createElement('div');
    container.id = id;
    container.className = 'acp-token-display';
    container.style.cssText = `
      display: flex;
      align-items: center;
      gap: 2px;
      font-size: 10px;
      font-family: var(--vscode-font-family);
      color: var(--vscode-descriptionForeground);
      opacity: 0.7;
      cursor: default;
      user-select: none;
      white-space: nowrap;
    `;
    container.title = 'Token usage';
    
    // Build DOM elements manually to avoid innerHTML (Trusted Types)
    const upArrow = document.createElement('span');
    upArrow.style.opacity = '0.6';
    upArrow.textContent = '↑';
    
    const inCount = document.createElement('span');
    inCount.className = 'acp-token-in';
    inCount.textContent = '0';
    
    const downArrow = document.createElement('span');
    downArrow.style.opacity = '0.6';
    downArrow.textContent = '↓';
    
    const outCount = document.createElement('span');
    outCount.className = 'acp-token-out';
    outCount.textContent = '0';
    
    // Cost display (hidden by default, shown when SDK provides cost)
    const costSeparator = document.createElement('span');
    costSeparator.className = 'acp-token-cost-sep';
    costSeparator.style.cssText = 'opacity: 0.4; margin-left: 2px; display: none;';
    costSeparator.textContent = '|';
    
    const costDisplay = document.createElement('span');
    costDisplay.className = 'acp-token-cost';
    costDisplay.style.cssText = 'color: var(--vscode-charts-green); display: none;';
    costDisplay.textContent = '';
    
    container.appendChild(upArrow);
    container.appendChild(inCount);
    container.appendChild(downArrow);
    container.appendChild(outCount);
    container.appendChild(costSeparator);
    container.appendChild(costDisplay);
    
    return container;
  };

  const updateSingleDisplay = (display, usage) => {
    if (!display || !usage) return;
    
    const inEl = display.querySelector('.acp-token-in');
    const outEl = display.querySelector('.acp-token-out');
    const costSep = display.querySelector('.acp-token-cost-sep');
    const costEl = display.querySelector('.acp-token-cost');
    
    // Show input tokens from SDK
    if (inEl) {
      inEl.textContent = formatTokenCount(usage.prompt_tokens || 0);
    }
    
    // Show output tokens from SDK
    if (outEl) {
      outEl.textContent = formatTokenCount(usage.completion_tokens || 0);
    }
    
    // Show cost if available from SDK
    if (costSep && costEl && usage.total_cost_usd != null) {
      costSep.style.display = 'inline';
      costEl.style.display = 'inline';
      costEl.textContent = '$' + usage.total_cost_usd.toFixed(4);
    } else if (costSep && costEl) {
      costSep.style.display = 'none';
      costEl.style.display = 'none';
    }
    
    // Update tooltip with detailed breakdown
    const sourceLabel = usage.source === 'cursor' ? 'from Cursor' : 
                       usage.source === 'sdk' || usage.source === 'sdk_final' ? 'from Claude SDK' : 
                       'estimated';
    let tooltip = `Token usage (${sourceLabel})
Input:  ${usage.prompt_tokens || 0}
Output: ${usage.completion_tokens || 0}`;
    
    // Add input breakdown if available (SDK provides base + cache)
    if (usage.input_tokens_base !== undefined || usage.cache_read_tokens || usage.cache_write_tokens) {
      tooltip += `
  Base: ${usage.input_tokens_base || 0}
  Cache read: ${usage.cache_read_tokens || 0}
  Cache write: ${usage.cache_write_tokens || 0}`;
    }
    
    tooltip += `
Total: ${usage.total_tokens || 0}`;
    
    // Add cost if available
    if (usage.total_cost_usd != null) {
      tooltip += `
Cost: $${usage.total_cost_usd.toFixed(4)}`;
    }
    
    display.title = tooltip;
  };

  // Update token display for a specific message ID
  const updateTokenDisplayForMessage = (messageId) => {
    if (!messageId) return;
    
    // Get usage data by message ID
    const usage = window.acpTokenUsage?.[messageId];
    if (!usage) return;
    
    // Sanitize messageId for use in element ID (remove special chars)
    const safeId = messageId.replace(/[^a-zA-Z0-9-]/g, '_');
    const displayId = `acp-token-display-${safeId}`;
    let display = document.getElementById(displayId);
    
    window.acpDebug?.('[ACP] updateTokenDisplayForMessage: messageId=' + messageId?.slice?.(0, 12) + ' displayId=' + displayId + ' existingDisplay=' + !!display);
    
    if (!display) {
      // Try multiple strategies to find the right place to display tokens
      
      // Strategy 1: Find element by data-message-id (exact match)
      let targetElement = document.querySelector(`[data-message-id="${messageId}"]`);
      window.acpDebug?.('[ACP] Strategy 1 (exact data-message-id): found=' + !!targetElement);
      
      // Strategy 2: Find by partial match (messageId might be truncated)
      if (!targetElement) {
        // Try to find any element whose data-message-id starts with our messageId
        const allMessages = document.querySelectorAll('[data-message-id]');
        for (const el of allMessages) {
          const elId = el.getAttribute('data-message-id');
          if (elId?.startsWith(messageId) || messageId?.startsWith(elId?.slice(0, 8))) {
            targetElement = el;
            window.acpDebug?.('[ACP] Strategy 2 (partial match): found=' + elId?.slice(0, 12));
            break;
          }
        }
      }
      
      // If we found an AI message, find the preceding human message
      if (targetElement && targetElement.getAttribute('data-message-role') === 'ai') {
        window.acpDebug?.('[ACP] Found AI message, looking for preceding human message');
        // Look for the human message in the same pair container
        const pairContainer = targetElement.closest('.composer-human-ai-pair-container');
        if (pairContainer) {
          const humanInPair = pairContainer.querySelector('[data-message-role="human"]');
          if (humanInPair) {
            targetElement = humanInPair;
            window.acpDebug?.('[ACP] Found human message in pair: ' + humanInPair.getAttribute('data-message-id')?.slice(0, 12));
          }
        }
      }
      
      // Now find the right container to append our display
      if (targetElement) {
        // Look for .composer-human-message inside, then find .flex.flex-col inside that
        const humanMessage = targetElement.querySelector('.composer-human-message');
        window.acpDebug?.('[ACP] Looking for .composer-human-message: found=' + !!humanMessage);
        
        if (humanMessage) {
          // Find the flex container - it's the div with class containing 'flex' and 'flex-col'
          const flexContainer = humanMessage.querySelector('.flex.flex-col');
          window.acpDebug?.('[ACP] Looking for .flex.flex-col: found=' + !!flexContainer);
          
          if (flexContainer) {
            display = createTokenDisplay(displayId);
            flexContainer.appendChild(display);
            window.acpLog?.('INFO', '[ACP] ✅ Token display attached to human message: ' + messageId?.slice?.(0, 8));
          }
        }
      }
      
      // Strategy 3: Fallback - find the last sticky human message
      if (!display) {
        window.acpDebug?.('[ACP] Strategy 3 (fallback to last sticky human message)');
        const stickyMessages = document.querySelectorAll('.composer-sticky-human-message');
        if (stickyMessages.length > 0) {
          const lastSticky = stickyMessages[stickyMessages.length - 1];
          const humanMessage = lastSticky.querySelector('.composer-human-message');
          const flexContainer = humanMessage?.querySelector('.flex.flex-col');
          if (flexContainer && !flexContainer.querySelector(`#${displayId}`)) {
            display = createTokenDisplay(displayId);
            flexContainer.appendChild(display);
            window.acpLog?.('INFO', '[ACP] ✅ Token display attached to last sticky (fallback): ' + messageId?.slice?.(0, 8));
          }
        }
      }
      
      if (!display) {
        window.acpLog?.('WARN', '[ACP] ⚠️ Could not find place to attach token display for: ' + messageId?.slice?.(0, 12));
      }
    }
    updateSingleDisplay(display, usage);
  };

  // Update token displays for ALL messages that have usage data
  const updateAllTokenDisplays = () => {
    if (!window.acpTokenUsage) return;
    
    const messageIds = Object.keys(window.acpTokenUsage);
    window.acpDebug?.('[ACP] updateAllTokenDisplays: ' + messageIds.length + ' messages with usage data');
    
    for (const messageId of messageIds) {
      updateTokenDisplayForMessage(messageId);
    }
  };

  const updateTokenDisplay = (composerId) => {
    // Get the message ID associated with this composer's current request
    if (!window.acpCurrentMessageId) window.acpCurrentMessageId = {};
    const messageId = window.acpCurrentMessageId[composerId];
    
    // Update the current message
    updateTokenDisplayForMessage(messageId);
    
    // Also update all other messages (in case DOM was re-rendered)
    updateAllTokenDisplays();
  };

  // Expose update functions globally
  window.acpUpdateTokenDisplay = updateTokenDisplay;
  window.acpUpdateAllTokenDisplays = updateAllTokenDisplays;

  const installAcpExtensionBridge = () => {
    window.acpExtensionBridge = {
      async sendMessage(provider, message, composerId, callbacks, options = {}) {
        window.acpLog?.('INFO', '[ACP Bridge] sendMessage called with provider:', provider.id, 'composerId:', composerId);

        // Capture the message ID for this request (from the sticky human message)
        // This associates this request with a specific message bubble
        // Use querySelectorAll and get the LAST one, since new messages are appended at the end
        if (!window.acpCurrentMessageId) window.acpCurrentMessageId = {};
        const stickyHumanMessages = document.querySelectorAll('.composer-sticky-human-message[data-message-id]');
        const stickyHumanMessage = stickyHumanMessages.length > 0 ? stickyHumanMessages[stickyHumanMessages.length - 1] : null;
        const messageId = stickyHumanMessage?.getAttribute('data-message-id');
        
        if (messageId) {
          window.acpCurrentMessageId[composerId] = messageId;
          window.acpLog?.('INFO', '[ACP Bridge] 📍 Associated with message:', messageId);
        }
        
        // Initialize token tracking for THIS MESSAGE (stored by message ID to preserve history)
        if (messageId) {
          if (!window.acpTokenUsage) window.acpTokenUsage = {};
          window.acpTokenUsage[messageId] = {
            prompt_tokens: null,  // Will be set by SDK (null = waiting for data)
            completion_tokens: 0,
            total_tokens: 0,
            source: 'pending'  // Will be overwritten by SDK data
          };
          
          window.acpLog?.('INFO', '[ACP Bridge] 📊 Waiting for SDK usage data...');
          
          // Update UI to show pending state
          updateTokenDisplay(composerId);
        }

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
              stream: !!callbacks,  // Enable streaming if callbacks provided
              modeId: options.modeId
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
            
            // Get the message ID for this request (captured at start of sendMessage)
            const currentMessageId = window.acpCurrentMessageId?.[composerId];

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
                  } else if (data.type === 'plan' && callbacks.onPlan) {
                    window.acpLog?.('INFO', '[ACP Bridge] 🗂️ Plan update received:', data.entries?.length || 0);
                    callbacks.onPlan(data);
                  } else if (data.type === 'mode' && callbacks.onMode) {
                    window.acpLog?.('INFO', '[ACP Bridge] 🧭 Mode update received:', data.currentModeId);
                    callbacks.onMode(data);
                  } else if (data.type === 'usage') {
                    // Real-time usage data from Claude SDK (via patched claude-code-acp)
                    // message_start: input_tokens only (output_tokens excluded as it's always ~1)
                    // message_delta (final): full output_tokens count
                    const usage = data.usage;
                    if (usage && currentMessageId) {
                      // Total input = base input + cache read + cache write
                      // (cached tokens still count as input to the model)
                      const baseInput = usage.input_tokens || 0;
                      const cacheRead = usage.cache_read_input_tokens || 0;
                      const cacheWrite = usage.cache_creation_input_tokens || 0;
                      const totalInput = baseInput + cacheRead + cacheWrite;
                      const totalOutput = usage.output_tokens || 0;
                      
                      window.acpLog?.('INFO', '[ACP Bridge] 📊 Real-time usage: input=' + totalInput + ' (base=' + baseInput + ' cache_read=' + cacheRead + ' cache_write=' + cacheWrite + ') output=' + totalOutput);
                      
                      if (!window.acpTokenUsage) window.acpTokenUsage = {};
                      
                      // Keep higher values (input can change between API calls, output accumulates)
                      const existing = window.acpTokenUsage[currentMessageId] || {};
                      const newInputTokens = Math.max(totalInput, existing.prompt_tokens || 0);
                      const newOutputTokens = Math.max(totalOutput, existing.completion_tokens || 0);
                      
                      window.acpTokenUsage[currentMessageId] = {
                        prompt_tokens: newInputTokens,
                        completion_tokens: newOutputTokens,
                        total_tokens: newInputTokens + newOutputTokens,
                        // Keep raw values for tooltip breakdown (use latest)
                        input_tokens_base: baseInput,
                        cache_read_tokens: cacheRead,
                        cache_write_tokens: cacheWrite,
                        source: 'sdk',
                        streaming: true
                      };
                      
                      // Update UI with real data
                      updateTokenDisplay(composerId);
                    }
                  } else if (data.type === 'done') {
                    window.acpLog?.('INFO', '[ACP Bridge] ✅ Stream done marker received');
                    
                    // Use final SDK usage
                    if (data.usage && currentMessageId) {
                      // Total input = base input + cache read + cache write
                      const baseInput = data.usage.input_tokens || 0;
                      const cacheRead = data.usage.cache_read_input_tokens || 0;
                      const cacheWrite = data.usage.cache_creation_input_tokens || 0;
                      const totalInput = baseInput + cacheRead + cacheWrite;
                      const totalOutput = data.usage.output_tokens || 0;
                      
                      window.acpLog?.('INFO', '[ACP Bridge] 📊 Final SDK usage: input=' + totalInput + ' (base=' + baseInput + ' cache_read=' + cacheRead + ' cache_write=' + cacheWrite + ') output=' + totalOutput + ' cost=$' + (data.total_cost_usd?.toFixed(4) || '?'));
                      
                      if (!window.acpTokenUsage) window.acpTokenUsage = {};
                      window.acpTokenUsage[currentMessageId] = {
                        prompt_tokens: totalInput,
                        completion_tokens: totalOutput,
                        total_tokens: totalInput + totalOutput,
                        input_tokens_base: baseInput,
                        cache_read_tokens: cacheRead,
                        cache_write_tokens: cacheWrite,
                        total_cost_usd: data.total_cost_usd,
                        modelUsage: data.modelUsage,
                        source: 'sdk_final'
                      };
                    }
                    
                    // Update the UI display
                    updateTokenDisplay(composerId);
                    
                    if (callbacks.onDone) {
                      callbacks.onDone(data);
                    }
                  }
                } catch (e) {
                  window.acpLog?.('ERROR', '[ACP Bridge] Error parsing chunk:', e);
                }
              }
            }

            const streamDuration = Date.now() - streamStart;
            window.acpLog?.('INFO', '[ACP Bridge] 📡 Stream completed in', streamDuration, 'ms | text length:', fullText.length);
            return {
              text: fullText,
              usage: (currentMessageId && window.acpTokenUsage?.[currentMessageId]) || {
                prompt_tokens: 0,
                completion_tokens: 0,
                total_tokens: 0
              }
            };
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
  };

  installAcpExtensionBridge();
  // Ensure latest bridge implementation wins even if older patches run later
  setTimeout(installAcpExtensionBridge, 0);

  // Set up a MutationObserver to re-add token displays when DOM changes
  // (Cursor's React UI can re-render and remove our injected elements)
  const setupTokenDisplayObserver = () => {
    const observer = new MutationObserver((mutations) => {
      // Debounce: only update if we have token usage data
      if (!window.acpTokenUsage || Object.keys(window.acpTokenUsage).length === 0) return;
      
      // Check if any human message containers were added/modified
      for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
          // Schedule an update (debounced)
          if (!window._acpTokenDisplayUpdatePending) {
            window._acpTokenDisplayUpdatePending = true;
            requestAnimationFrame(() => {
              window._acpTokenDisplayUpdatePending = false;
              window.acpUpdateAllTokenDisplays?.();
            });
          }
          break;
        }
      }
    });
    
    // Observe the composer pane for changes
    const composerPane = document.querySelector('.composer-pane') || document.body;
    observer.observe(composerPane, { childList: true, subtree: true });
    
    window.acpLog?.('INFO', '[ACP] Token display observer installed');
  };
  
  // Set up observer after a short delay to ensure DOM is ready
  setTimeout(setupTokenDisplayObserver, 1000);

  // ===== CURSOR NATIVE MODEL TOKEN TRACKING =====
  // Hook into composerDataService to capture tokenCount updates from Cursor's native models
  const setupCursorTokenTracking = () => {
    // Find the composerDataService - it's available on window or via React internals
    const findComposerDataService = () => {
      // Try to find it through the React fiber tree or global services
      // Cursor exposes some services globally
      if (window._cursorComposerDataService) {
        return window._cursorComposerDataService;
      }
      return null;
    };

    // Hook updateComposerBubble to capture token updates
    const hookUpdateComposerBubble = (svc) => {
      if (!svc || svc._acpTokenHooked) return;
      
      const originalUpdateBubble = svc.updateComposerBubble?.bind(svc);
      if (!originalUpdateBubble) {
        window.acpLog?.('WARN', '[ACP] updateComposerBubble not found on service');
        return;
      }

      svc.updateComposerBubble = function(composerHandle, bubbleId, updates) {
        // Debug: log ALL bubble updates with full content for debugging
        if (window.ACP_DEBUG) {
          try {
            const safeUpdates = {};
            if (updates) {
              for (const key of Object.keys(updates)) {
                const val = updates[key];
                if (val === null || val === undefined) {
                  safeUpdates[key] = val;
                } else if (typeof val === 'function') {
                  safeUpdates[key] = '[Function]';
                } else if (typeof val === 'object') {
                  try {
                    safeUpdates[key] = JSON.parse(JSON.stringify(val));
                  } catch {
                    safeUpdates[key] = '[Object]';
                  }
                } else {
                  safeUpdates[key] = val;
                }
              }
            }
            window.acpLog?.('DEBUG', '[ACP] [Bridge] updateComposerBubble FULL: ' + JSON.stringify({
              bubbleId: bubbleId,
              updates: safeUpdates
            }, null, 2));
          } catch (e) {
            window.acpLog?.('DEBUG', '[ACP] [Bridge] updateComposerBubble: bubbleId=' + bubbleId + ' (logging error: ' + e.message + ')');
          }
        }
        
        // Check if this update contains tokenCount data
        if (updates?.tokenCount) {
          const { inputTokens, outputTokens } = updates.tokenCount;
          window.acpLog?.('INFO', '[ACP] 📊 Cursor tokenCount update: bubbleId=' + bubbleId?.slice(0, 8) + ' input=' + inputTokens + ' output=' + outputTokens);
          
          // Find the message ID associated with this bubble
          // The bubble might be an AI response bubble, we need to find the associated human message
          const bubble = composerHandle?.data?.conversationMap?.get?.(bubbleId) || 
                        composerHandle?.data?.conversationMap?.[bubbleId];
          
          // Try to find the requestId which links to the human message
          const requestId = bubble?.requestId || bubbleId;
          
          if (window.ACP_DEBUG) {
            window.acpLog?.('DEBUG', '[ACP] [Bridge] Token bubble lookup: requestId=' + (requestId?.slice?.(0, 12) || requestId) + 
              ' bubbleType=' + bubble?.type + ' hasRequestId=' + !!bubble?.requestId);
          }
          
          if (requestId) {
            if (!window.acpTokenUsage) window.acpTokenUsage = {};
            
            // Only update if we don't already have SDK data (ACP models)
            const existing = window.acpTokenUsage[requestId];
            if (!existing || existing.source === 'cursor' || !existing.source) {
              window.acpTokenUsage[requestId] = {
                prompt_tokens: inputTokens || 0,
                completion_tokens: outputTokens || 0,
                total_tokens: (inputTokens || 0) + (outputTokens || 0),
                source: 'cursor'  // Mark as from Cursor's native tracking
              };
              
              if (window.ACP_DEBUG) {
                window.acpLog?.('DEBUG', '[ACP] [Bridge] Stored Cursor token data for ' + requestId?.slice?.(0, 8));
              }
              
              // Update display
              updateTokenDisplayForMessage(requestId);
            } else if (window.ACP_DEBUG) {
              window.acpLog?.('DEBUG', '[ACP] [Bridge] Skipped - already have ' + existing.source + ' data');
            }
          }
        }
        
        // Capture usageUuid for future cost API calls
        if (updates?.usageUuid) {
          window.acpLog?.('INFO', '[ACP] 📋 [Bridge] usageUuid: bubbleId=' + (bubbleId?.slice?.(0, 8) || bubbleId) + ' uuid=' + updates.usageUuid?.slice?.(0, 12));
          if (!window.acpUsageUuids) window.acpUsageUuids = {};
          window.acpUsageUuids[bubbleId] = updates.usageUuid;
        }
        
        // Call original method
        return originalUpdateBubble(composerHandle, bubbleId, updates);
      };
      
      svc._acpTokenHooked = true;
      window.acpLog?.('INFO', '[ACP] ✅ Hooked updateComposerBubble for native model token tracking');
    };

    // Hook updateComposerDataSetStore to capture tokenCount in nested updates
    const hookUpdateDataSetStore = (svc) => {
      if (!svc || svc._acpDataSetStoreHooked) return;
      
      const originalUpdate = svc.updateComposerDataSetStore?.bind(svc);
      if (!originalUpdate) return;

      svc.updateComposerDataSetStore = function(composerId, updater) {
        // Wrap the updater to intercept tokenCount updates
        const wrappedUpdater = (...args) => {
          // Debug: log all DataSetStore updates to trace data flow
          if (window.ACP_DEBUG && args[0] === 'conversationMap') {
            window.acpLog?.('DEBUG', '[ACP] [Bridge] DataSetStore update: path=' + args.slice(0, 3).join('/') + 
              ' isTokenCount=' + (args[2] === 'tokenCount'));
          }
          
          // Check if this is a tokenCount update
          // Format: u("conversationMap", bubbleId, "tokenCount", { inputTokens, outputTokens })
          if (args[0] === 'conversationMap' && args[2] === 'tokenCount' && args[3]) {
            const bubbleId = args[1];
            const tokenCount = args[3];
            window.acpLog?.('INFO', '[ACP] 📊 Cursor tokenCount (via DataSetStore): bubbleId=' + bubbleId?.slice(0, 8) + ' input=' + tokenCount.inputTokens + ' output=' + tokenCount.outputTokens);
            
            if (bubbleId) {
              if (!window.acpTokenUsage) window.acpTokenUsage = {};
              
              const existing = window.acpTokenUsage[bubbleId];
              if (window.ACP_DEBUG) {
                window.acpLog?.('DEBUG', '[ACP] [Bridge] DataSetStore token check: existing=' + !!existing + ' source=' + existing?.source);
              }
              
              if (!existing || existing.source === 'cursor' || !existing.source) {
                window.acpTokenUsage[bubbleId] = {
                  prompt_tokens: tokenCount.inputTokens || 0,
                  completion_tokens: tokenCount.outputTokens || 0,
                  total_tokens: (tokenCount.inputTokens || 0) + (tokenCount.outputTokens || 0),
                  source: 'cursor'
                };
                
                if (window.ACP_DEBUG) {
                  window.acpLog?.('DEBUG', '[ACP] [Bridge] DataSetStore stored token data for ' + bubbleId?.slice?.(0, 8));
                }
                
                // Schedule display update
                requestAnimationFrame(() => {
                  updateTokenDisplayForMessage(bubbleId);
                  updateAllTokenDisplays();
                });
              }
            }
          }
          
          return updater(...args);
        };
        
        return originalUpdate(composerId, wrappedUpdater);
      };
      
      svc._acpDataSetStoreHooked = true;
      window.acpLog?.('INFO', '[ACP] ✅ Hooked updateComposerDataSetStore for native model token tracking');
    };

    // Try to hook immediately if service is available
    const svc = findComposerDataService();
    if (svc) {
      hookUpdateComposerBubble(svc);
      hookUpdateDataSetStore(svc);
    }

    // Also expose a function for chat-interception.js to call when it has access to the service
    window._acpHookComposerService = (service) => {
      if (!service) return;
      window._cursorComposerDataService = service;
      hookUpdateComposerBubble(service);
      hookUpdateDataSetStore(service);
    };
    
    window.acpLog?.('INFO', '[ACP] Cursor native model token tracking setup complete');
  };

  // Set up Cursor token tracking after a delay
  setTimeout(setupCursorTokenTracking, 500);

  window.acpLog?.('INFO', "[ACP] Extension bridge installed - using HTTP on localhost:37842");

} catch (error) {
  window.acpLog?.('ERROR', "[ACP] FATAL ERROR in extension-bridge.js:", error);
  window.acpLog?.('ERROR', "[ACP] Stack trace:", error.stack);
}
