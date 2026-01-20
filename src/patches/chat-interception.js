// Chat Interception Template
// This template is used to replace submitChatMaybeAbortCurrent in workbench.desktop.main.js
// Placeholders will be replaced with actual minified variable names during patching

async submitChatMaybeAbortCurrent({{e}}, {{t}}, {{n}}, {{s}} = {{defaultVal}}) {
      let {{r}} = {{ssFunc}}();
      {{s}}.setAttribute("requestId", {{r}});

      {{ACP_TOKEN}}
      window.ACP_DEBUG = {{ACP_DEBUG}};
      window.acpDebug = (...args) => {
        if (!window.ACP_DEBUG) return;
        window.acpLog?.('DEBUG', ...args);
      };
      /* === ACP CHAT INTERCEPTION === */
      const composerHandle = this._composerDataService.getWeakHandleOptimistic({{e}});
      const modelName = {{n}}?.modelOverride || composerHandle?.data?.modelConfig?.modelName || '';

      // Install plan payload logger and token tracking hook
      const installServiceHooks = () => {
        if (window._acpServiceHooksInstalled || !this._composerDataService) return;
        window._acpServiceHooksInstalled = true;
        window._acpPlanLoggedBubbles = window._acpPlanLoggedBubbles || new Set();
        const svc = this._composerDataService;
        
        // Expose service for extension-bridge token tracking
        if (window._acpHookComposerService) {
          window._acpHookComposerService(svc);
        }
        window._cursorComposerDataService = svc;
        
        // Hook updateComposerBubble for direct token updates
        const originalUpdateBubble = svc.updateComposerBubble?.bind(svc);
        if (originalUpdateBubble && !svc._acpBubbleHooked) {
          svc._acpBubbleHooked = true;
          svc.updateComposerBubble = function(composerHandle, bubbleId, updates) {
            // Debug: log ALL updateComposerBubble calls with full update object
            try {
              // Create a safe copy of updates for logging (handle circular refs)
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
                      // Try to stringify, but limit depth
                      safeUpdates[key] = JSON.parse(JSON.stringify(val));
                    } catch {
                      safeUpdates[key] = '[Object - circular or too deep]';
                    }
                  } else {
                    safeUpdates[key] = val;
                  }
                }
              }
              window.acpDebug?.('[ACP] updateComposerBubble FULL:', JSON.stringify({
                bubbleId: bubbleId,
                composerId: composerHandle?.composerId?.slice?.(0, 12),
                updates: safeUpdates
              }, null, 2));
            } catch (e) {
              window.acpDebug?.('[ACP] updateComposerBubble (logging error):', e.message, 'bubbleId=' + bubbleId);
            }
            
            // Capture tokenCount updates from Cursor native models
            if (updates?.tokenCount) {
              const { inputTokens, outputTokens } = updates.tokenCount;
              // Log the FULL bubbleId to see what we're getting
              window.acpLog?.('INFO', '[ACP] 📊 Cursor native tokenCount: bubbleId=' + bubbleId + ' input=' + inputTokens + ' output=' + outputTokens);
              
              // Store token data for display
              if (bubbleId) {
                if (!window.acpTokenUsage) window.acpTokenUsage = {};
                const existing = window.acpTokenUsage[bubbleId];
                window.acpDebug?.('[ACP] Token storage: fullBubbleId=' + bubbleId + ' existing=' + !!existing);
                // Only update if not from ACP SDK (which has more detailed data)
                if (!existing || existing.source === 'cursor' || !existing.source) {
                  window.acpTokenUsage[bubbleId] = {
                    prompt_tokens: inputTokens || 0,
                    completion_tokens: outputTokens || 0,
                    total_tokens: (inputTokens || 0) + (outputTokens || 0),
                    source: 'cursor'
                  };
                  window.acpLog?.('INFO', '[ACP] ✅ Stored token usage: key=' + bubbleId + ' in=' + inputTokens + ' out=' + outputTokens);
                  // Trigger UI update
                  window.acpUpdateAllTokenDisplays?.();
                } else {
                  window.acpDebug?.('[ACP] Skipped token update - already have SDK data');
                }
              }
            }
            
            // Also capture usageUuid for potential future cost fetching
            if (updates?.usageUuid) {
              window.acpLog?.('INFO', '[ACP] 📋 usageUuid received: bubbleId=' + (bubbleId?.slice?.(0, 8) || bubbleId) + ' uuid=' + updates.usageUuid?.slice?.(0, 12));
              // Store usageUuid for potential API call to get cost data
              if (!window.acpUsageUuids) window.acpUsageUuids = {};
              window.acpUsageUuids[bubbleId] = updates.usageUuid;
            }
            
            return originalUpdateBubble(composerHandle, bubbleId, updates);
          };
          window.acpLog?.('INFO', '[ACP] ✅ Hooked updateComposerBubble for Cursor native token tracking');
        }
        
        const originalUpdate = svc.updateComposerDataSetStore?.bind(svc);
        if (!originalUpdate) return;
        svc.updateComposerDataSetStore = (handle, updater) => {
          const result = originalUpdate(handle, updater);
          if (!window.ACP_DEBUG) return result;
          try {
            const map = handle?.data?.conversationMap;
            if (!map) return result;
            const inspectBubble = (bubbleId, bubble) => {
              if (!bubble) return;
              const hasPlanData = !!bubble.isPlanExecution || (Array.isArray(bubble.todos) && bubble.todos.length > 0);
              if (hasPlanData && !window._acpPlanLoggedBubbles.has(bubbleId)) {
                window._acpPlanLoggedBubbles.add(bubbleId);
                window.acpLog?.('INFO', '[ACP] 🗂️ Plan bubble snapshot:', JSON.stringify({ bubbleId, bubble }, null, 2));
              }
            };
            if (map.forEach) {
              map.forEach((bubble, bubbleId) => inspectBubble(bubbleId, bubble));
            } else {
              Object.entries(map).forEach(([bubbleId, bubble]) => inspectBubble(bubbleId, bubble));
            }
          } catch (error) {
            window.acpLog?.('ERROR', '[ACP] Plan logger error:', error);
          }
          return result;
        };
      };
      
      // Install global fetch interceptor to capture Cursor backend streaming data
      const installFetchInterceptor = () => {
        if (window._acpFetchIntercepted) return;
        window._acpFetchIntercepted = true;
        
        const originalFetch = window.fetch;
        window.fetch = async function(...args) {
          const [url, options] = args;
          const urlStr = typeof url === 'string' ? url : url?.url || '';
          
          // Only intercept Cursor AI server calls
          const isAiServerCall = urlStr.includes('aiserver') || 
                                 urlStr.includes('api.cursor') ||
                                 urlStr.includes('/v1/chat') ||
                                 urlStr.includes('stream');
          
          if (isAiServerCall && window.ACP_DEBUG) {
            window.acpLog?.('DEBUG', '[ACP] 🌐 Fetch intercepted:', urlStr.slice(0, 100));
          }
          
          const response = await originalFetch.apply(this, args);
          
          // If it's a streaming response to AI server, intercept the body
          if (isAiServerCall && response.body) {
            const originalBody = response.body;
            const reader = originalBody.getReader();
            
            const interceptedStream = new ReadableStream({
              async start(controller) {
                const decoder = new TextDecoder();
                try {
                  while (true) {
                    const { done, value } = await reader.read();
                    if (done) {
                      controller.close();
                      break;
                    }
                    
                    // Log the raw chunk for debugging
                    if (window.ACP_DEBUG) {
                      const text = decoder.decode(value, { stream: true });
                      // Look for usage/token data in the stream
                      if (text.includes('usage') || text.includes('token') || text.includes('Token')) {
                        window.acpLog?.('DEBUG', '[ACP] 🔍 Stream chunk with token data:', text.slice(0, 500));
                      }
                      // Log every 10th chunk or if it contains interesting data
                      if (text.includes('inputTokens') || text.includes('outputTokens') || text.includes('totalCents')) {
                        window.acpLog?.('INFO', '[ACP] 📊 FOUND TOKEN DATA IN STREAM:', text.slice(0, 1000));
                      }
                    }
                    
                    controller.enqueue(value);
                  }
                } catch (error) {
                  controller.error(error);
                }
              }
            });
            
            // Return a new response with the intercepted stream
            return new Response(interceptedStream, {
              headers: response.headers,
              status: response.status,
              statusText: response.statusText
            });
          }
          
          return response;
        };
        window.acpLog?.('INFO', '[ACP] ✅ Installed fetch interceptor for streaming debug');
      };
      
      // Install WebSocket interceptor for gRPC-web
      const installWebSocketInterceptor = () => {
        if (window._acpWsIntercepted) return;
        window._acpWsIntercepted = true;
        
        const OriginalWebSocket = window.WebSocket;
        window.WebSocket = function(url, protocols) {
          const ws = new OriginalWebSocket(url, protocols);
          
          if (window.ACP_DEBUG && (url.includes('aiserver') || url.includes('cursor'))) {
            window.acpLog?.('DEBUG', '[ACP] 🔌 WebSocket opened:', url.slice(0, 100));
            
            const originalOnMessage = ws.onmessage;
            ws.addEventListener('message', function(event) {
              const data = event.data;
              if (typeof data === 'string') {
                if (data.includes('token') || data.includes('usage') || data.includes('Token')) {
                  window.acpLog?.('DEBUG', '[ACP] 🔍 WS message with token data:', data.slice(0, 500));
                }
                if (data.includes('inputTokens') || data.includes('outputTokens')) {
                  window.acpLog?.('INFO', '[ACP] 📊 FOUND TOKEN DATA IN WS:', data.slice(0, 1000));
                }
              }
            });
          }
          
          return ws;
        };
        window.WebSocket.prototype = OriginalWebSocket.prototype;
        window.acpLog?.('INFO', '[ACP] ✅ Installed WebSocket interceptor for gRPC debug');
      };
      
      // Install XMLHttpRequest interceptor for gRPC-web
      const installXhrInterceptor = () => {
        if (window._acpXhrIntercepted) return;
        window._acpXhrIntercepted = true;
        
        const OriginalXHR = window.XMLHttpRequest;
        window.XMLHttpRequest = function() {
          const xhr = new OriginalXHR();
          const originalOpen = xhr.open;
          const originalSend = xhr.send;
          let requestUrl = '';
          
          xhr.open = function(method, url, ...args) {
            requestUrl = url;
            if (window.ACP_DEBUG && (url.includes('aiserver') || url.includes('cursor') || url.includes('grpc'))) {
              window.acpLog?.('DEBUG', '[ACP] 📡 XHR opened:', method, url.slice(0, 100));
            }
            return originalOpen.apply(this, [method, url, ...args]);
          };
          
          xhr.send = function(body) {
            if (window.ACP_DEBUG && (requestUrl.includes('aiserver') || requestUrl.includes('grpc'))) {
              xhr.addEventListener('load', function() {
                const response = xhr.responseText || '';
                if (response.includes('token') || response.includes('usage') || response.includes('Token')) {
                  window.acpLog?.('DEBUG', '[ACP] 🔍 XHR response with token data:', response.slice(0, 500));
                }
                if (response.includes('inputTokens') || response.includes('outputTokens')) {
                  window.acpLog?.('INFO', '[ACP] 📊 FOUND TOKEN DATA IN XHR:', response.slice(0, 1000));
                }
              });
            }
            return originalSend.apply(this, [body]);
          };
          
          return xhr;
        };
        window.XMLHttpRequest.prototype = OriginalXHR.prototype;
        window.acpLog?.('INFO', '[ACP] ✅ Installed XHR interceptor for gRPC debug');
      };
      
      installServiceHooks();
      installFetchInterceptor();
      installWebSocketInterceptor();
      installXhrInterceptor();

      // Track current model for slash command filtering
      if (window.acpSlashCommandIntegration?.setCurrentModel) {
        window.acpSlashCommandIntegration.setCurrentModel(modelName);
      }

      if (modelName.startsWith('acp:')) {
        window.acpLog?.('INFO', '[ACP] 🎯 Intercepting message for ACP model:', modelName);

        try {
          if (!composerHandle) {
            throw new Error('No composer handle');
          }

          const shouldClearText = !{{n}}?.isResume && !{{n}}?.skipClearInput && !{{n}}?.bubbleId;

          const humanBubble = {
            bubbleId: {{ssFunc}}(),
            type: 1,
            text: {{t}} || '',
            richText: {{n}}?.richText ?? {{t}},
            codeBlocks: [],
            createdAt: new Date().toISOString(),
            requestId: {{r}},
            modelInfo: { modelName: modelName || '' }
          };
          this._composerDataService.appendComposerBubbles(composerHandle, [humanBubble]);

          shouldClearText && this._composerUtilsService.clearText({{e}});
          {{n}}?.skipFocusAfterSubmission || this._composerViewsService.focus({{e}}, !0);

          this._composerDataService.updateComposerDataSetStore({{e}}, o => {
            o("status", "generating");
            o("generatingBubbleIds", []);
            o("currentBubbleId", void 0);
            o("isDraft", !1);
          });

          // Use composer ID for session management, send only current message
          const composerId = {{e}};
          const currentMessage = {{t}} || '';

          // Get provider for session management
          const providerId = modelName.replace('acp:', '').replace(' (ACP)', '').toLowerCase().replace(/\s+/g, '-');
          const provider = window.acpService?.getProvider(providerId);
          if (!provider) {
            throw new Error(`ACP provider "${providerId}" not found`);
          }

          // Trigger slash command refresh in background
          if (window.acpSlashCommandIntegration) {
            window.acpSlashCommandIntegration.refreshCommands().catch(err =>
              window.acpLog?.('WARN', '[ACP] Failed to refresh slash commands:', err)
            );
          }

          // Services and ID generator
          const svc = this._composerDataService;
          const gen = {{ssFunc}};

          // Create ONE response bubble upfront
          const responseBubbleId = gen();
          svc.appendComposerBubbles(composerHandle, [{
            bubbleId: responseBubbleId,
            type: 2,
            text: '',
            richText: '',
            codeBlocks: [],
            createdAt: new Date().toISOString()
          }]);

          // Mark this bubble as actively generating
          svc.updateComposerDataSetStore({{e}}, u => {
            u("generatingBubbleIds", [responseBubbleId]);
            u("currentBubbleId", responseBubbleId);
          });

          // Simple state: accumulate text, track tool bubbles and their types
          const stateKey = `_acp_${composerId}`;
          window[stateKey] = {
            text: '',
            bubbleId: responseBubbleId,
            toolBubbles: new Map(),
            planBubbleId: null,
            planToolCallId: null,
            pendingToolCalls: new Map(),
            pendingFinalizers: new Set(),
            streamDone: false
          };

          // Tool type constants shared across tool and plan handlers
          const TOOL_FORMER_CAPABILITY = 15;
          const READ_FILE_V2_TYPE = 40;
          const RUN_TERMINAL_COMMAND_V2_TYPE = 15;
          const SEARCH_REPLACE_TYPE = 38;
          const GREP_TYPE = 41;
          const GLOB_TYPE = 42;
          const LIST_DIR_TYPE = 39;
          const TODO_WRITE_TYPE = 35;
          const CREATE_PLAN_TYPE = 43; // Plan creation tool
          const MCP_TOOL_TYPE = 99; // Generic MCP tool fallback
          const WEB_SEARCH_TYPE = 18;
          const WEB_FETCH_TYPE = 19; // URL fetch tool
          const SWITCH_MODE_TYPE = 52;

          const composerData = composerHandle?.data || {};
          const uiMode = document?.querySelector?.('.composer-unified-dropdown[data-mode]')?.getAttribute('data-mode');
          const mapUnifiedMode = (modeValue) => {
            if (modeValue === 0) return 'default';
            if (modeValue === 1) return 'acceptEdits';
            if (modeValue === 2) return 'plan';
            return null;
          };

          let requestedModeId =
            {{n}}?.modeId ||
            {{n}}?.currentModeId ||
            {{n}}?.mode?.id ||
            {{n}}?.mode?.modeId ||
            {{n}}?.mode?.name ||
            composerData?.currentModeId ||
            composerData?.modeId ||
            composerData?.mode?.id ||
            composerData?.mode?.name ||
            composerData?.unifiedMode;

          if (typeof requestedModeId === 'number') {
            requestedModeId = mapUnifiedMode(requestedModeId);
          }

          if (!requestedModeId && typeof composerData?.unifiedMode === 'number') {
            requestedModeId = mapUnifiedMode(composerData.unifiedMode);
          }

          if (!requestedModeId && uiMode) {
            requestedModeId = uiMode;
          }

          window.acpLog?.(
            'INFO',
            '[ACP] Mode fields:',
            'reqModeId=',
            requestedModeId,
            'unifiedMode=',
            composerData?.unifiedMode,
            'currentModeId=',
            composerData?.currentModeId,
            'modeId=',
            composerData?.modeId,
            'uiMode=',
            uiMode
          );

          const acpResponse = await window.acpExtensionBridge.sendMessage(
            provider,
            currentMessage,
            composerId,
            {
              onTextChunk: (chunk) => {
                const s = window[stateKey];
                // If bubbleId is null, create a new bubble
                if (!s.bubbleId) {
                  s.bubbleId = gen();
                  s.text = '';
                  svc.appendComposerBubbles(composerHandle, [{
                    bubbleId: s.bubbleId,
                    type: 2,
                    text: '',
                    richText: '',
                    codeBlocks: [],
                    createdAt: new Date().toISOString()
                  }]);
                  // Mark new bubble as generating
                  svc.updateComposerDataSetStore({{e}}, u => {
                    u("generatingBubbleIds", [s.bubbleId]);
                    u("currentBubbleId", s.bubbleId);
                  });
                }
                s.text += chunk;
                svc.updateComposerDataSetStore({{e}}, u => {
                  u("conversationMap", s.bubbleId, "text", s.text);
                  u("conversationMap", s.bubbleId, "richText", s.text);
                });
              },

              onToolCall: (tc) => {
                const s = window[stateKey];
                const toolCallId = tc.toolCallId;
                const isNew = tc.sessionUpdate === 'tool_call';
                const isComplete = tc.status === 'completed';
                const isFailed = tc.status === 'failed';
                const isToolResult = tc.sessionUpdate === 'tool_result';
                const addPendingTool = () => {
                  if (!isNew || !toolCallId) return;
                  if (!s.pendingToolCalls) s.pendingToolCalls = new Map();
                  if (!s.pendingToolCalls.has(toolCallId)) {
                    s.pendingToolCalls.set(toolCallId, { kind: tc.kind, title: tc.title });
                    window.acpDebug?.('[ACP] 🧩 Tool pending added:', toolCallId, tc.kind, tc.title, 'pending=', s.pendingToolCalls.size);
                  }
                };
                const resolvePendingTool = (statusLabel) => {
                  if (!toolCallId || !s.pendingToolCalls) return;
                  if (s.pendingToolCalls.has(toolCallId)) {
                    s.pendingToolCalls.delete(toolCallId);
                    window.acpDebug?.('[ACP] ✅ Tool pending resolved:', toolCallId, statusLabel, 'pending=', s.pendingToolCalls.size);
                  }
                };
                const trackFinalizer = (promise, label) => {
                  if (!promise) return;
                  if (!s.pendingFinalizers) s.pendingFinalizers = new Set();
                  s.pendingFinalizers.add(promise);
                  window.acpDebug?.('[ACP] ⏳ Finalizer added:', label, 'finalizers=', s.pendingFinalizers.size);
                  promise.finally(() => {
                    s.pendingFinalizers.delete(promise);
                    window.acpDebug?.('[ACP] ✅ Finalizer resolved:', label, 'finalizers=', s.pendingFinalizers.size);
                  });
                };
                addPendingTool();
                try {

                // Get tool input early for logging
                const toolInput = tc.input || tc.rawInput || {};
                const inputObj = typeof toolInput === 'string' ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })() : toolInput;

                // DEBUG: Log all tool calls with full details including content
                window.acpDebug?.( '[ACP] onToolCall FULL:', JSON.stringify({
                  kind: tc.kind,
                  title: tc.title,
                  sessionUpdate: tc.sessionUpdate,
                  status: tc.status,
                  toolCallId: toolCallId,
                  inputKeys: Object.keys(inputObj),
                  hasOldString: !!inputObj.old_string,
                  hasNewString: !!inputObj.new_string,
                  hasFilePath: !!inputObj.file_path,
                  hasCommand: !!inputObj.command,
                  contentTypes: tc.content ? tc.content.map(c => c.type) : null,
                  contentDetails: tc.content ? tc.content.map(c => ({
                    type: c.type,
                    hasOldText: c.type === 'diff' ? !!c.oldText : undefined,
                    hasNewText: c.type === 'diff' ? !!c.newText : undefined,
                    path: c.path
                  })) : null
                }, null, 2));


                // Plan file detection
                const isPlanFile = (filePath) => {
                  if (!filePath) return false;
                  const normalizedPath = filePath.replace(/\\/g, '/');
                  const inClaudePlans = normalizedPath.includes('/.claude/plans/');
                  const inCursorPlans = normalizedPath.includes('/.cursor/plans/');
                  const isPlanExtension = normalizedPath.endsWith('.plan.md');
                  const isMarkdown = normalizedPath.endsWith('.md');
                  return (inCursorPlans && isPlanExtension) || (inClaudePlans && isMarkdown);
                };

                // Parse todos from "Implementation Steps" section at end of plan file
                // If no Implementation Steps found, return a single "implement plan" todo
                const parsePlanTodos = (content) => {
                  const todos = [];
                  
                  // Look for "Implementation Steps" or "## Implementation Steps" section
                  const implStepsMatch = content.match(/(?:^|\n)(?:#{1,3}\s*)?Implementation\s+Steps\s*\n([\s\S]*?)(?:\n#{1,3}\s|$)/i);
                  
                  if (implStepsMatch) {
                    const stepsSection = implStepsMatch[1];
                    // Match numbered items: "1. Step title" or "- [ ] Step title" or "- Step title"
                    const stepRegex = /^(?:\s*[-*]\s*(?:\[[ x]\]\s*)?|\s*(\d+)\.\s*)(.+)$/gm;
                    let match;
                    let stepNum = 1;
                    while ((match = stepRegex.exec(stepsSection)) !== null) {
                      const stepId = match[1] || stepNum;
                      // Clean up markdown formatting (remove ** bold markers, checkboxes)
                      const cleanContent = match[2].trim().replace(/^\*\*|\*\*$/g, '').replace(/^\[[ x]\]\s*/i, '');
                      if (cleanContent) {
                        todos.push({
                          id: `step_${stepId}`,
                          content: cleanContent,
                          status: 'pending'
                        });
                        stepNum++;
                      }
                    }
                  }
                  
                  // If no todos found, add a default "implement plan" todo
                  if (todos.length === 0) {
                    todos.push({
                      id: 'step_1',
                      content: 'Implement plan',
                      status: 'pending'
                    });
                  }
                  
                  return todos;
                };

                // Detect tool type (use stored type for updates, or detect from event)
                const storedType = s.toolTypes?.get(toolCallId);
                const isReadTool = tc.kind === 'read' || storedType?.isRead;
                // BashOutput: execute with pid/process_id (reading from background process)
                const isBashOutputTool = (tc.kind === 'execute' && (inputObj.pid || inputObj.process_id || inputObj.tail)) || storedType?.isBashOutput;
                // Regular bash: execute with command (running a new command)
                const isBashTool = (tc.kind === 'execute' && !isBashOutputTool) || storedType?.isBash;
                const isEditTool = tc.kind === 'edit' || storedType?.isEdit;
                const isTodoWriteTool = (tc.kind === 'think' && tc.title?.toLowerCase().includes('todo')) || storedType?.isTodoWrite;
                // Fetch tools: WebSearch (has query/search_term) and WebFetch (has url)
                const isWebFetchTool = (tc.kind === 'fetch' && inputObj.url) || storedType?.isWebFetch;
                const isWebSearchTool = (tc.kind === 'fetch' && !inputObj.url) || storedType?.isWebSearch;
                // Switch mode tool (ExitPlanMode)
                const isSwitchModeTool = tc.kind === 'switch_mode' || storedType?.isSwitchMode;
                
                // Glob and LS detection - these come with kind: 'search' but have specific input fields
                // Glob tool: kind is 'search' and title contains 'Find' (NOT grep/Grep)
                const isGlobTool = (tc.kind === 'search' && tc.title?.includes('Find') && !tc.title?.toLowerCase().includes('grep')) || storedType?.isGlob;
                // ListDir tool: kind is 'search' and title starts with 'List' or has target_directory without glob/pattern
                const isListDirTool = (tc.kind === 'search' && (tc.title?.startsWith('List') || (inputObj.target_directory && !inputObj.glob_pattern && !inputObj.pattern))) || storedType?.isListDir;
                // Grep tool: kind is 'search' and title contains 'Grep' or 'grep'
                const isGrepTool = (tc.kind === 'search' && (tc.title?.includes('Grep') || tc.title?.includes('grep'))) || storedType?.isGrep;
                
                // Debug log for tool detection
                if (tc.kind === 'search' || storedType?.isGlob || storedType?.isGrep || storedType?.isListDir) {
                  window.acpDebug?.( '[ACP] Search tool detection:', JSON.stringify({
                    kind: tc.kind,
                    title: tc.title,
                    status: status,
                    isGlobTool,
                    isGrepTool,
                    isListDirTool,
                    storedType: storedType
                  }));
                }

                // ===== READ TOOL (WORKING) =====
                if (isReadTool) {
                  if (isNew && !s.toolBubbles.has(toolCallId) && !inputObj.file_path) {
                    return;
                  }

                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isRead: true });

                    const filePath = inputObj.file_path || '';
                    const cursorRawArgs = filePath ? {
                      target_file: filePath,
                      limit: inputObj.limit,
                      offset: inputObj.offset
                    } : {};
                    const effectiveUri = filePath ? ('file://' + filePath) : '';

                    const toolData = {
                      tool: READ_FILE_V2_TYPE,
                      toolCallId: toolCallId,
                      status: 'loading',
                      name: 'read_file',
                      params: {
                        targetFile: filePath || '',
                        effectiveUri: effectiveUri,
                        limit: inputObj.limit || 1000,
                        charsLimit: 100000
                      },
                      rawArgs: cursorRawArgs,
                      result: null
                    };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: new Date().toISOString(),
                      capabilityType: TOOL_FORMER_CAPABILITY,
                      toolFormerData: toolData
                    };

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  }

                  if (isComplete || isFailed || isToolResult) {
                    const toolBubbleId = s.toolBubbles.get(toolCallId);
                    if (toolBubbleId) {
                      const finalStatus = isFailed ? 'error' : 'completed';
                      let output = '';

                      if (Array.isArray(tc.result)) {
                        output = tc.result.map(r => r.text || '').join('');
                      } else if (typeof tc.result === 'string') {
                        output = tc.result;
                      } else if (tc.content && Array.isArray(tc.content)) {
                        const textContent = tc.content.find(c => c.type === 'content');
                        if (textContent?.content?.text) {
                          output = textContent.content.text;
                          const match = output.match(/^```+\n([\s\S]*?)\n```+$/);
                          if (match) {
                            output = match[1];
                          }
                        } else {
                          output = typeof tc.content === 'string' ? tc.content : JSON.stringify(tc.content);
                        }
                      } else if (tc.content) {
                        output = typeof tc.content === 'string' ? tc.content : JSON.stringify(tc.content);
                      } else if (isFailed) {
                        output = 'Tool execution failed';
                      }

                      const lines = output.split('\n');
                      const finalResult = {
                        contents: output,
                        numCharactersInRequestedRange: output.length,
                        totalLinesInFile: lines.length
                      };

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", finalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", finalResult);
                      });
                    }
                    if (isComplete || isFailed) {
                      resolvePendingTool(isFailed ? 'failed' : 'completed');
                    }
                  }
                  return;
                }

                // ===== BASH TOOL (FULLY WORKING) =====
                if (isBashTool) {
                  if (isNew && !s.toolBubbles.has(toolCallId) && !inputObj.command) {
                    return;
                  }

                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isBash: true });

                    // EXTRACT REAL COMMAND from ACP
                    const realCommand = inputObj.command || 'unknown command';
                    const workingDir = inputObj.working_directory || '/Users/jacquesverre/Documents/code/opencursor';

                    // Parse command to get executable name and args (simple split on spaces)
                    const cmdParts = realCommand.split(/\s+/);
                    const execName = cmdParts[0] || 'unknown';
                    const execArgs = cmdParts.slice(1).map(arg => ({ type: 'word', value: arg }));

                    const toolData = {
                      tool: RUN_TERMINAL_COMMAND_V2_TYPE,
                      toolCallId: toolCallId,
                      status: 'loading',
                      name: 'run_terminal_command',
                      params: {
                        command: realCommand,
                        requireUserApproval: false,
                        workingDirectory: workingDir,
                        parsingResult: {
                          executableCommands: [
                            {
                              name: execName,
                              args: execArgs,
                              fullText: realCommand
                            }
                          ]
                        },
                        requestedSandboxPolicy: {
                          type: 'TYPE_INSECURE_NONE',
                          networkAccess: true,
                          blockGitWrites: false
                        }
                      },
                      rawArgs: {
                        command: realCommand,
                        is_background: false,
                        required_permissions: ['all']
                      },
                      additionalData: {
                        status: 'loading'
                      },
                      result: null
                    };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: new Date().toISOString(),
                      capabilityType: TOOL_FORMER_CAPABILITY,
                      toolFormerData: toolData
                    };

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  }

                  // Extract and apply output immediately from toolResponse (event 4)
                  if (tc._meta?.claudeCode?.toolResponse) {
                    const toolBubbleId = s.toolBubbles.get(toolCallId);
                    if (toolBubbleId) {
                      const toolResponse = tc._meta.claudeCode.toolResponse[0];
                      if (toolResponse?.type === 'text' && toolResponse?.text) {
                        let output = toolResponse.text;
                        // Parse "New output:\n\ntest\n" -> "test"
                        const match = output.match(/New output:\n\n([\s\S]*)/);
                        if (match) {
                          output = match[1];
                        }

                        // Apply result immediately
                        const result = {
                          output: output,
                          exitCodeV2: 0,
                          rejected: false,
                          notInterrupted: true,
                          endedReason: 'RUN_TERMINAL_COMMAND_ENDED_REASON_EXECUTION_COMPLETED',
                          effectiveSandboxPolicy: {
                            type: 'TYPE_INSECURE_NONE'
                          }
                        };

                        svc.updateComposerDataSetStore({{e}}, u => {
                          u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                          u("conversationMap", toolBubbleId, "toolFormerData", "additionalData", "status", "success");
                        });
                      }
                    }
                  }

                  // Handle completion status (event 5)
                  if (isComplete || isFailed) {
                    const toolBubbleId = s.toolBubbles.get(toolCallId);
                    if (toolBubbleId) {
                      const finalStatus = isFailed ? 'error' : 'completed';
                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", finalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "additionalData", "status", finalStatus === 'completed' ? 'success' : 'error');
                      });
                    }
                    resolvePendingTool(isFailed ? 'failed' : 'completed');
                  }

                  return;
                }

                // ===== BASH_OUTPUT TOOL - Tail logs from background commands =====
                if (isBashOutputTool) {
                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    const pid = inputObj.pid || inputObj.process_id || '';
                    const description = inputObj.description || tc.title || `Reading output from process ${pid}`;

                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isBashOutput: true });

                    window.acpLog?.('INFO', '[ACP] 📋 Creating BASH_OUTPUT bubble:', toolCallId, pid);

                    const toolData = {
                      tool: RUN_TERMINAL_COMMAND_V2_TYPE,
                      toolCallId: toolCallId,
                      status: 'loading',
                      name: 'bash_output',
                      params: {
                        pid: pid,
                        tail: true,
                        description: description
                      },
                      rawArgs: {
                        pid: pid,
                        tail: true
                      },
                      additionalData: {
                        status: 'loading',
                        isBashOutput: true
                      },
                      result: null
                    };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: new Date().toISOString(),
                      capabilityType: TOOL_FORMER_CAPABILITY,
                      toolFormerData: toolData
                    };

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  }

                  // Extract output from toolResponse
                  if (tc._meta?.claudeCode?.toolResponse) {
                    const toolBubbleId = s.toolBubbles.get(toolCallId);
                    if (toolBubbleId) {
                      const toolResponse = tc._meta.claudeCode.toolResponse[0];
                      if (toolResponse?.type === 'text' && toolResponse?.text) {
                        let output = toolResponse.text;
                        
                        // Parse output format
                        const match = output.match(/(?:New output|Output):\n\n([\s\S]*)/);
                        if (match) {
                          output = match[1];
                        }

                        const result = {
                          output: output,
                          exitCodeV2: 0,
                          rejected: false,
                          notInterrupted: true,
                          endedReason: 'RUN_TERMINAL_COMMAND_ENDED_REASON_EXECUTION_COMPLETED',
                          effectiveSandboxPolicy: {
                            type: 'TYPE_INSECURE_NONE'
                          }
                        };

                        svc.updateComposerDataSetStore({{e}}, u => {
                          u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                          u("conversationMap", toolBubbleId, "toolFormerData", "additionalData", "status", "success");
                        });
                      }
                    }
                  }

                  // Handle completion
                  if (isComplete || isFailed) {
                    const toolBubbleId = s.toolBubbles.get(toolCallId);
                    if (toolBubbleId) {
                      const finalStatus = isFailed ? 'error' : 'completed';
                      window.acpLog?.('INFO', '[ACP] ✅ BashOutput completed');
                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", finalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "additionalData", "status", finalStatus === 'completed' ? 'success' : 'error');
                      });
                    }
                    resolvePendingTool(isFailed ? 'failed' : 'completed');
                  }

                  return;
                }

                // ===== EDIT TOOL (edit_file_v2) =====
                if (isEditTool) {
                  // Skip if no file_path yet (initial pending event)
                  if (isNew && !s.toolBubbles.has(toolCallId) && !inputObj.file_path) {
                    return;
                  }

                  // Store edit data when we receive it (on the second tool_call with full data)
                  if (isNew && inputObj.file_path) {
                    // Save the edit data for later use on completion
                    if (!s.editData) s.editData = new Map();
                    
                    // Find diff content from tc.content array
                    const diffContent = tc.content?.find(c => c.type === 'diff');
                    
                    // ACP Write tool uses 'content' field, search_replace uses 'new_string'
                    const writeContent = inputObj.content || inputObj.new_string || '';
                    
                    s.editData.set(toolCallId, {
                      filePath: inputObj.file_path,
                      oldString: inputObj.old_string || '',
                      newString: writeContent,
                      oldText: diffContent?.oldText || null,
                      newText: diffContent?.newText || writeContent || null
                    });
                    
                    window.acpLog?.('INFO', '[ACP] 📝 Stored edit data for', toolCallId, 
                      'filePath:', inputObj.file_path,
                      'oldString len:', inputObj.old_string?.length || 0,
                      'newString len:', (inputObj.new_string || '').length,
                      'content len:', (inputObj.content || '').length,
                      'writeContent len:', writeContent.length,
                      'diffOldText:', !!diffContent?.oldText,
                      'diffNewText:', !!diffContent?.newText,
                      'diffNewText actual len:', (diffContent?.newText || '').length);
                  }

                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isEdit: true });

                    // Get file path from ACP data
                    const filePath = inputObj.file_path || '';

                    window.acpDebug?.( '[ACP] Edit creating bubble - filePath:', filePath);

                    // Match Cursor's expected format for edit_file_v2
                    const toolData = {
                      tool: 38,
                      toolCallId: toolCallId,
                      toolIndex: 0,
                      modelCallId: "",
                      status: 'loading',
                      name: 'edit_file_v2',
                      params: {
                        relativeWorkspacePath: filePath,
                        shouldSendBackLinterErrors: false,
                        resultForModel: "",
                        noCodeblock: true,
                        cloudAgentEdit: false
                      },
                      additionalData: {}
                    };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: new Date().toISOString(),
                      capabilityType: TOOL_FORMER_CAPABILITY,
                      toolFormerData: toolData
                    };

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  }

                  // Handle completion status - use stored edit data
                  if (isComplete || isFailed) {
                    const toolBubbleId = s.toolBubbles.get(toolCallId);
                    const editData = s.editData?.get(toolCallId);
                    
                    window.acpDebug?.( '[ACP] Edit completion - toolBubbleId:', !!toolBubbleId, 'editData:', !!editData);
                    
                    if (toolBubbleId && editData) {
                      const finalStatus = isFailed ? 'error' : 'completed';

                      // Use diff content if available, otherwise construct from old/new strings
                      let beforeContent = editData.oldText;
                      let afterContent = editData.newText;
                      
                      // If we don't have full file content from diff, we can't show proper diff
                      // The oldText/newText from ACP diff content should be the full file
                      if (!beforeContent || !afterContent) {
                        window.acpLog?.('WARN', '[ACP] No diff content available, using input strings as fallback');
                        beforeContent = editData.oldString || '';
                        afterContent = editData.newString || '';
                      }

                      window.acpDebug?.( '[ACP] Edit content lengths - Before:', beforeContent?.length || 0, 'After:', afterContent?.length || 0);

                      // Simple hash function (matches Cursor's E9 hash)
                      const hashContent = async (content) => {
                        const encoder = new TextEncoder();
                        const data = encoder.encode(content);
                        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                      };

                      // Generate IDs and store content
                      const finalizePromise = (async () => {
                        try {
                          const beforeHash = await hashContent(beforeContent);
                          const afterHash = await hashContent(afterContent);
                          const beforeContentId = `composer.content.${beforeHash}`;
                          const afterContentId = `composer.content.${afterHash}`;

                        // Store content in cursorDiskKV using Cursor's storage service
                        try {
                          const storageService = svc._storageService;

                          if (storageService && typeof storageService.cursorDiskKVSet === 'function') {
                            await storageService.cursorDiskKVSet(beforeContentId, beforeContent);
                            await storageService.cursorDiskKVSet(afterContentId, afterContent);

                            window.acpDebug?.( '[ACP] Stored content - Before ID:', beforeContentId.substring(0, 60), 'After ID:', afterContentId.substring(0, 60));
                          } else {
                            window.acpLog?.('WARN', '[ACP] Storage service not found on svc._storageService');
                          }
                        } catch (err) {
                          window.acpLog?.('ERROR', '[ACP] Failed to store:', err.message);
                        }

                        // Match Cursor's expected result format
                        const result = {
                          fileWasCreated: false,
                          linterErrors: [],
                          sentBackLinterErrors: false,
                          shouldAutoFixLints: false,
                          resultForModel: "",
                          beforeContentId: beforeContentId,
                          afterContentId: afterContentId
                        };

                        svc.updateComposerDataSetStore({{e}}, u => {
                          u("conversationMap", toolBubbleId, "toolFormerData", "status", finalStatus);
                          u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                        });

                        window.acpDebug?.( '[ACP] Result set with IDs - beforeContentId:', beforeContentId, 'afterContentId:', afterContentId);

                        // Plan file detection - only at completion when we have full content
                        window.acpLog?.('INFO', '[ACP] 🔍 PLAN CHECK - filePath:', editData.filePath, 'isPlanFile:', isPlanFile(editData.filePath));
                        if (isPlanFile(editData.filePath)) {
                          const planContent = afterContent || editData.newString || '';
                          window.acpLog?.('INFO', '[ACP] 📋 PLAN FILE DETECTED - path:', editData.filePath, 'contentLen:', planContent?.length);
                          const normalizedPath = (editData.filePath || '').replace(/\\/g, '/');
                          window.acpLog?.('INFO', '[ACP] 📋 PLAN normalizedPath:', normalizedPath, 'includesClaude:', normalizedPath.includes('/.claude/plans/'));
                          if (normalizedPath.includes('/.claude/plans/')) {
                            const cursorPlanPath = normalizedPath.replace('/.claude/plans/', '/.cursor/plans/');
                            window.acpLog?.('INFO', '[ACP] 📋 PLAN MIRROR - source:', editData.filePath, 'target:', cursorPlanPath);
                            fetch('http://localhost:37842/acp/mirrorPlan', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                sourcePath: editData.filePath,
                                targetPath: cursorPlanPath,
                                content: planContent
                              })
                            }).then(r => {
                              window.acpLog?.('INFO', '[ACP] 📋 PLAN MIRROR response status:', r.status);
                              return r.text();
                            }).then(txt => {
                              window.acpLog?.('INFO', '[ACP] 📋 PLAN MIRROR response body:', txt);
                            }).catch(err => {
                              window.acpLog?.('ERROR', '[ACP] 📋 PLAN MIRROR fetch error:', err?.message || err);
                            });
                          }
                          const todos = parsePlanTodos(planContent);
                          window.acpLog?.('INFO', '[ACP] 📋 PLAN TODOS parsed:', todos.length, 'items');
                          
                          if (todos.length > 0) {
                            window.acpLog?.('INFO', '[ACP] 📋 Plan file detected:', editData.filePath, 'todos:', todos.length);
                            
                            // Extract plan name and overview from content
                            const planFileName = editData.filePath.split('/').pop() || 'plan.md';
                            const planName = planFileName.replace(/\.plan\.md$|\.md$/, '').replace(/[-_]/g, ' ');
                            
                            // Parse overview from plan content (first paragraph before todos)
                            const overviewMatch = planContent.match(/^([\s\S]*?)(?=\n\s*[-*]\s*\[)/);
                            const overview = overviewMatch ? overviewMatch[1].trim() : '';
                            
                            // Build params matching Cursor's createPlanParams structure
                            const planParams = {
                              name: planName,
                              overview: overview,
                              plan: planContent,
                              todos: todos
                            };
                            
                            // Build additionalData with planUri for the plan bubble component
                            const planUri = 'file://' + editData.filePath;
                            
                            svc.updateComposerDataSetStore({{e}}, u => {
                              u("conversationMap", toolBubbleId, "toolFormerData", {
                                type: CREATE_PLAN_TYPE,
                                tool: CREATE_PLAN_TYPE,
                                toolCallId: toolCallId,
                                toolIndex: 0,
                                modelCallId: "",
                                status: 'completed',
                                name: 'create_plan',
                                requestId: toolBubbleId,
                                rawArgs: JSON.stringify(planParams),
                                params: planParams,
                                additionalData: {
                                  planUri: planUri
                                }
                              });
                              u("conversationMap", toolBubbleId, "isPlanExecution", true);
                              u("conversationMap", toolBubbleId, "todos", todos);
                            });
                            window.acpLog?.('INFO', '[ACP] 📋 Plan bubble updated with CREATE_PLAN_TYPE (43), planUri:', planUri, 'todos:', todos.length);
                          }
                        }
                        } finally {
                          resolvePendingTool(isFailed ? 'failed' : 'completed');
                        }
                      })();
                      trackFinalizer(finalizePromise, `edit:${toolCallId?.slice(0, 8) || toolCallId}`);
                    } else {
                      resolvePendingTool(isFailed ? 'failed' : 'completed');
                    }
                  }

                  return;
                }

                // ===== GREP TOOL (Type 41) =====
                if (isGrepTool) {
                  // Store grep data whenever we receive it (even if incomplete initially)
                  if (inputObj && Object.keys(inputObj).length > 0) {
                    if (!s.grepData) s.grepData = new Map();

                    // Merge new data with existing data (in case parameters come in stages)
                    const existing = s.grepData.get(toolCallId) || {};
                    s.grepData.set(toolCallId, {
                      pattern: inputObj.pattern || existing.pattern,
                      path: inputObj.path || existing.path || '.',
                      outputMode: inputObj.output_mode || existing.outputMode || 'content',
                      caseInsensitive: inputObj['-i'] ?? existing.caseInsensitive ?? false,
                      headLimit: inputObj.head_limit ?? existing.headLimit
                    });
                    window.acpDebug?.( '[ACP] Updated grep data for', toolCallId, 'pattern:', inputObj.pattern || existing.pattern);
                  }

                  const grepData = s.grepData?.get(toolCallId) || {};

                  // Only create bubble if we have the pattern (defer until we have enough data)
                  if (isNew && !s.toolBubbles.has(toolCallId) && grepData.pattern) {
                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isGrep: true });

                    window.acpDebug?.( '[ACP] Grep creating bubble - pattern:', grepData.pattern, 'path:', grepData.path);

                    // Match Cursor's expected format for grep (Type 41)
                    const toolData = {
                      tool: GREP_TYPE,
                      toolCallId: toolCallId,
                      toolIndex: 0,
                      modelCallId: "",
                      status: 'loading',
                      name: 'grep',
                      params: {
                        pattern: grepData.pattern || '',
                        path: grepData.path || '.',
                        outputMode: grepData.outputMode || 'content',
                        caseInsensitive: grepData.caseInsensitive || false,
                        headLimit: grepData.headLimit
                      },
                      rawArgs: {
                        pattern: grepData.pattern || '',
                        path: grepData.path || '.',
                        output_mode: grepData.outputMode || 'content'
                      },
                      additionalData: {}
                    };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: new Date().toISOString(),
                      capabilityType: TOOL_FORMER_CAPABILITY,
                      toolFormerData: toolData
                    };

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  }

                  // Handle completion
                  if (isComplete || isFailed) {
                    const toolBubbleId = s.toolBubbles.get(toolCallId);
                    const grepData = s.grepData?.get(toolCallId);

                    if (toolBubbleId) {
                      const finalStatus = isFailed ? 'error' : 'completed';

                      // Extract result from tc.content
                      let output = '';
                      let fileMatchCounts = new Map(); // Map of file path to match count
                      
                      if (Array.isArray(tc.content)) {
                        const textContent = tc.content.find(c => c.type === 'content');
                        if (textContent?.content?.text) {
                          output = textContent.content.text;
                        } else if (textContent?.text) {
                          output = textContent.text;
                        }
                      }
                      
                      // Parse ripgrep-style output to extract file matches with counts
                      // Format: "path/file.js:line:column:content" or "path/file.js:line:content"
                      if (output) {
                        const lines = output.split('\n').filter(l => l.trim());
                        for (const line of lines) {
                          // Skip context lines (starting with -)
                          if (line.startsWith('-')) continue;
                          
                          // Extract file path (everything before the first :line: pattern)
                          const match = line.match(/^(.+?):(\d+):/);
                          if (match) {
                            const filePath = match[1];
                            fileMatchCounts.set(filePath, (fileMatchCounts.get(filePath) || 0) + 1);
                          }
                        }
                      }
                      
                      const files = Array.from(fileMatchCounts.keys());
                      window.acpDebug?.( '[ACP] Grep result - files found:', files.length, 'output length:', output.length, 'match counts:', JSON.stringify(Object.fromEntries(fileMatchCounts)));

                      // Match Cursor's expected result format for grep (RIPGREP_RAW_SEARCH)
                      // The workbench expects: result.result.case === "success" and result.result.value.workspaceResults
                      // Use "count" case to show match counts per file (not "files" which doesn't have counts)
                      const searchPath = grepData?.path || '.';
                      
                      // Build counts array with file paths and match counts
                      const counts = files.map(filePath => ({
                        file: filePath,
                        count: fileMatchCounts.get(filePath) || 1
                      }));
                      
                      // Calculate total matches
                      const totalMatches = Array.from(fileMatchCounts.values()).reduce((sum, c) => sum + c, 0);
                      
                      const result = {
                        result: {
                          case: "success",
                          value: {
                            pattern: grepData?.pattern || '',
                            path: searchPath,
                            outputMode: grepData?.outputMode || 'content',
                            workspaceResults: {
                              [searchPath]: {
                                result: {
                                  case: "count",
                                  value: {
                                    counts: counts,  // Array of {file, count} objects
                                    totalFiles: files.length,
                                    totalMatches: totalMatches,
                                    clientTruncated: false,
                                    ripgrepTruncated: false
                                  }
                                }
                              }
                            }
                          }
                        }
                      };
                      
                      window.acpDebug?.( '[ACP] Grep result object:', JSON.stringify(result, null, 2));

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", finalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                      });
                    }
                  }

                  return;
                }

                // ===== GLOB TOOL (Type 42) =====
                if (isGlobTool) {
                  // Create bubble on first tool_call
                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    // ACP sends pattern and path, not glob_pattern and target_directory
                    const globPattern = inputObj.pattern || inputObj.glob_pattern || '';
                    const targetDir = inputObj.path || inputObj.target_directory || '.';
                    
                    if (!globPattern) {
                      window.acpLog?.('WARN', '[ACP] Glob tool called without pattern');
                      return;
                    }

                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isGlob: true });

                    // Store glob input for later use when building result
                    s.toolInputs = s.toolInputs || new Map();
                    s.toolInputs.set(toolCallId, {
                      globPattern: globPattern,
                      targetDir: targetDir
                    });

                    const rawArgs = {
                      globPattern: globPattern,
                      targetDirectory: targetDir
                    };
                    
                    window.acpLog?.('INFO', '[ACP] 🔍 Glob tool detected:', { pattern: globPattern, path: targetDir });

                    window.acpLog?.('INFO', '[ACP] 🔍 Creating GLOB bubble:', toolCallId, rawArgs);

                    // Match Cursor's expected format for glob (Type 42)
                    const toolData = {
                      tool: GLOB_TYPE,
                      toolCallId: toolCallId,
                      toolIndex: 0,
                      modelCallId: "",
                      status: 'loading',
                      name: 'glob_file_search',
                      params: {
                        globPattern: globPattern,
                        targetDirectory: targetDir
                      },
                      rawArgs: rawArgs,
                      additionalData: {}
                    };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: new Date().toISOString(),
                      capabilityType: TOOL_FORMER_CAPABILITY,
                      toolFormerData: toolData
                    };

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  }

                  // Handle completion
                  if (isComplete || isFailed) {
                    const globFinalStatus = isFailed ? 'error' : 'completed';
                    const toolBubbleId = s.toolBubbles.get(toolCallId);
                    if (toolBubbleId) {
                      // Parse glob output to get file list
                      // ACP uses type: 'content' with nested content.text
                      let output = '';
                      if (Array.isArray(tc.content)) {
                        const textContent = tc.content.find(c => c.type === 'content');
                        if (textContent?.content?.text) {
                          output = textContent.content.text;
                        }
                      }
                      
                      const globData = s.toolInputs?.get(toolCallId);
                      const targetDir = globData?.targetDir || '.';
                      
                      window.acpDebug?.( '[ACP] Glob content:', JSON.stringify(tc.content, null, 2));
                      window.acpDebug?.( '[ACP] Glob output text:', output);
                      
                      // Parse files from output (one per line)
                      const rawFiles = output.split('\n')
                        .map(f => f.trim())
                        .filter(f => f && !f.startsWith('Error') && !f.startsWith('No '));

                      window.acpLog?.('INFO', '[ACP] ✅ Glob completed with files:', rawFiles.length);

                      // Convert absolute paths to relative paths
                      // If targetDir is absolute (starts with /), use it as base for relative paths
                      const absPath = targetDir.startsWith('/') ? targetDir : 
                        (typeof process !== 'undefined' && process.cwd ? process.cwd() + '/' + targetDir : targetDir);
                      
                      const files = rawFiles.map(f => {
                        // Extract relative path from absolute path
                        if (f.startsWith(absPath)) {
                          return f.substring(absPath.length).replace(/^\//, '');
                        }
                        // If it's already relative or doesn't match absPath, extract just filename
                        const parts = f.split('/');
                        return parts[parts.length - 1];
                      });

                      // Build result in Cursor's expected protobuf format
                      // GlobFileSearchResult has directories array, each with absPath, files, totalFiles
                      const result = {
                        directories: [{
                          absPath: absPath,
                          files: files.map(f => ({ relPath: f })),
                          totalFiles: files.length,
                          ripgrepTruncated: false
                        }]
                      };

                      window.acpDebug?.( '[ACP] Glob result object:', JSON.stringify(result, null, 2));

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", globFinalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                      });
                    }
                  }

                  return;
                }

                // ===== LIST_DIR TOOL (Type 39) =====
                if (isListDirTool) {
                  // Create bubble on first tool_call
                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    const targetDir = inputObj.target_directory || inputObj.path || '.';

                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isListDir: true });

                    // Store list_dir input for later use when building result
                    if (!s.toolInputs) s.toolInputs = new Map();
                    s.toolInputs.set(toolCallId, { targetDir });

                    // Create the tool bubble
                    const rawArgs = { target_directory: targetDir };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: Date.now(),
                      capabilityType: 'agentic'
                    };

                    window.acpLog?.('INFO', '[ACP] 📁 Creating LIST_DIR bubble:', toolCallId, rawArgs);

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);

                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", {
                        type: LIST_DIR_TYPE,
                        tool: LIST_DIR_TYPE,
                        toolCallId: toolCallId,
                        status: 'running',
                        requestId: toolBubbleId,
                        rawArgs: JSON.stringify(rawArgs),
                        params: rawArgs
                      });
                    });
                  }

                  // Handle completion
                  if (isComplete || isFailed) {
                    const listDirFinalStatus = isFailed ? 'error' : 'completed';
                    const toolBubbleId = s.toolBubbles.get(toolCallId);

                    if (toolBubbleId) {
                      // Parse list_dir output to get file/directory list
                      // ACP uses type: 'content' with nested content.text
                      let output = '';
                      if (Array.isArray(tc.content)) {
                        const textContent = tc.content.find(c => c.type === 'content');
                        if (textContent?.content?.text) {
                          output = textContent.content.text;
                        }
                      }
                      
                      window.acpDebug?.( '[ACP] List_dir output text:', output?.substring(0, 200));
                      
                      const listDirData = s.toolInputs?.get(toolCallId);
                      const targetDir = listDirData?.targetDir || '.';
                      
                      // Parse the output - typically contains directories and files
                      // Format can be like "dir1/\ndir2/\nfile1.js\nfile2.ts"
                      const lines = output.split('\n')
                        .map(f => f.trim())
                        .filter(f => f && !f.startsWith('Error'));
                      
                      // Separate directories and files
                      const childrenDirs = [];
                      const childrenFiles = [];
                      
                      lines.forEach(line => {
                        if (line.endsWith('/')) {
                          // It's a directory
                          const dirName = line.slice(0, -1);
                          childrenDirs.push({
                            absPath: targetDir === '.' ? dirName : `${targetDir}/${dirName}`,
                            childrenDirs: [],
                            childrenFiles: [],
                            childrenWereProcessed: false,
                            fullSubtreeExtensionCounts: {}
                          });
                        } else {
                          // It's a file
                          childrenFiles.push({
                            name: line
                          });
                        }
                      });

                      window.acpLog?.('INFO', '[ACP] ✅ List_dir completed with dirs:', childrenDirs.length, 'files:', childrenFiles.length);

                      // Build result in Cursor's expected protobuf format
                      // ListDirV2Result has directoryTreeRoot with absPath, childrenDirs, childrenFiles
                      const result = {
                        directoryTreeRoot: {
                          absPath: targetDir,
                          childrenDirs: childrenDirs,
                          childrenFiles: childrenFiles,
                          childrenWereProcessed: true,
                          fullSubtreeExtensionCounts: {}
                        }
                      };

                      window.acpDebug?.( '[ACP] List_dir result object:', JSON.stringify(result, null, 2));

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", listDirFinalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                      });
                    }
                  }

                  return;
                }

                // ===== TODO_WRITE TOOL (Type 35) =====
                if (isTodoWriteTool) {
                  // Create bubble on first tool_call
                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    const todos = inputObj.todos || [];

                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isTodoWrite: true });

                    // Store todos for later
                    if (!s.toolInputs) s.toolInputs = new Map();
                    s.toolInputs.set(toolCallId, { todos });

                    // Create the tool bubble
                    const rawArgs = { todos };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: Date.now(),
                      capabilityType: 'agentic'
                    };

                    window.acpLog?.('INFO', '[ACP] 📝 Creating TODO_WRITE bubble:', toolCallId, 'todos count:', todos?.length);

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);

                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", {
                        type: TODO_WRITE_TYPE,
                        tool: TODO_WRITE_TYPE,
                        toolCallId: toolCallId,
                        status: 'running',
                        requestId: toolBubbleId,
                        rawArgs: JSON.stringify(rawArgs),
                        params: rawArgs
                      });
                    });
                  }

                  // Handle completion
                  if (isComplete || isFailed) {
                    const todoFinalStatus = isFailed ? 'error' : 'completed';
                    const toolBubbleId = s.toolBubbles.get(toolCallId);

                    if (toolBubbleId) {
                      const todoData = s.toolInputs?.get(toolCallId);

                      window.acpLog?.('INFO', '[ACP] ✅ TodoWrite completed');

                      const result = {
                        success: true
                      };

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", todoFinalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                      });
                    }
                  }

                  return;
                }

                // ===== WEB_FETCH TOOL (Type 19) - Fetch URL content =====
                if (isWebFetchTool) {
                  // Create bubble on first tool_call
                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    const url = inputObj.url || tc.title || 'URL Fetch';

                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isWebFetch: true });

                    // Store URL for later
                    if (!s.toolInputs) s.toolInputs = new Map();
                    s.toolInputs.set(toolCallId, { url });

                    window.acpLog?.('INFO', '[ACP] 🌐 Creating WEB_FETCH bubble:', toolCallId, url?.substring(0, 80));

                    // Create the tool bubble with toolFormerData included
                    const toolData = {
                      tool: WEB_FETCH_TYPE,
                      toolCallId: toolCallId,
                      toolIndex: 0,
                      modelCallId: "",
                      status: 'loading',
                      name: 'web_fetch',
                      params: { url: url },
                      rawArgs: { url: url },
                      additionalData: {}
                    };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: new Date().toISOString(),
                      capabilityType: TOOL_FORMER_CAPABILITY,
                      toolFormerData: toolData
                    };

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  }

                  // Handle completion
                  if (isComplete || isFailed) {
                    const webFetchFinalStatus = isFailed ? 'error' : 'completed';
                    const toolBubbleId = s.toolBubbles.get(toolCallId);

                    if (toolBubbleId) {
                      // Get fetched content
                      let output = '';
                      if (Array.isArray(tc.content)) {
                        const textContent = tc.content.find(c => c.type === 'content');
                        if (textContent?.content?.text) {
                          output = textContent.content.text;
                        } else if (textContent?.text) {
                          output = textContent.text;
                        }
                      }

                      const fetchData = s.toolInputs?.get(toolCallId);
                      window.acpLog?.('INFO', '[ACP] ✅ WebFetch completed, output length:', output?.length);

                      // Build result with fetched content
                      const result = {
                        url: fetchData?.url || '',
                        content: output,
                        success: !isFailed
                      };

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", webFetchFinalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                      });
                    }
                  }

                  return;
                }

                // ===== WEB_SEARCH TOOL (Type 18) =====
                if (isWebSearchTool) {
                  // Create bubble on first tool_call
                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    const query = inputObj.query || inputObj.search_term || tc.title || 'Web Search';

                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isWebSearch: true });

                    // Store query for later
                    if (!s.toolInputs) s.toolInputs = new Map();
                    s.toolInputs.set(toolCallId, { query });

                    window.acpLog?.('INFO', '[ACP] 🌐 Creating WEB_SEARCH bubble:', toolCallId, query?.substring(0, 50));

                    // Create the tool bubble with toolFormerData included (like grep)
                    const toolData = {
                      tool: WEB_SEARCH_TYPE,
                      toolCallId: toolCallId,
                      toolIndex: 0,
                      modelCallId: "",
                      status: 'loading',
                      name: 'web_search',
                      params: { search_term: query },
                      rawArgs: { search_term: query },
                      additionalData: {}
                    };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: new Date().toISOString(),
                      capabilityType: TOOL_FORMER_CAPABILITY,
                      toolFormerData: toolData
                    };

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  }

                  // Handle completion
                  if (isComplete || isFailed) {
                    const webSearchFinalStatus = isFailed ? 'error' : 'completed';
                    const toolBubbleId = s.toolBubbles.get(toolCallId);

                    if (toolBubbleId) {
                      // Get web search output
                      let output = '';
                      if (Array.isArray(tc.content)) {
                        const textContent = tc.content.find(c => c.type === 'content');
                        if (textContent?.content?.text) {
                          output = textContent.content.text;
                        } else if (textContent?.text) {
                          output = textContent.text;
                        }
                      }

                      window.acpLog?.('INFO', '[ACP] ✅ WebSearch completed, output length:', output?.length);

                      // Parse web references from output if available
                      // Format varies, but typically includes URLs and snippets
                      const webReferences = [];
                      
                      // Try to extract URLs from output
                      const urlRegex = /https?:\/\/[^\s\])"']+/g;
                      const urls = output?.match(urlRegex) || [];
                      urls.slice(0, 10).forEach((url, i) => {
                        webReferences.push({
                          title: `Result ${i + 1}`,
                          url: url,
                          snippet: ''
                        });
                      });

                      // Build result matching Cursor's expected format for web search
                      const result = {
                        webReferences: webReferences
                      };

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", webSearchFinalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                      });
                    }
                  }

                  return;
                }

                // ===== SWITCH_MODE TOOL (Type 52) - ExitPlanMode =====
                if (isSwitchModeTool) {
                  // Create bubble on first tool_call
                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    const targetMode = inputObj.mode || inputObj.target_mode || tc.title || 'Switch Mode';

                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isSwitchMode: true });

                    // Create the tool bubble
                    const rawArgs = { mode: targetMode };

                    const toolBubble = {
                      bubbleId: toolBubbleId,
                      type: 2,
                      text: '',
                      richText: '',
                      codeBlocks: [],
                      createdAt: Date.now(),
                      capabilityType: 'agentic'
                    };

                    window.acpLog?.('INFO', '[ACP] 🔄 Creating SWITCH_MODE bubble:', toolCallId, targetMode);

                    svc.appendComposerBubbles(composerHandle, [toolBubble]);

                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", {
                        type: SWITCH_MODE_TYPE,
                        tool: SWITCH_MODE_TYPE,
                        toolCallId: toolCallId,
                        status: 'running',
                        requestId: toolBubbleId,
                        rawArgs: JSON.stringify(rawArgs),
                        params: rawArgs
                      });
                    });
                  }

                  // Handle completion
                  if (isComplete || isFailed) {
                    const switchModeFinalStatus = isFailed ? 'error' : 'completed';
                    const toolBubbleId = s.toolBubbles.get(toolCallId);

                    if (toolBubbleId) {
                      window.acpLog?.('INFO', '[ACP] ✅ SwitchMode completed');

                      const result = {
                        success: true
                      };

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", switchModeFinalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                      });
                    }
                  }

                  return;
                }

                // ===== MCP TOOL FALLBACK (Generic handler for unrecognized MCP tools) =====
                // This handles any MCP tool that doesn't have a specific handler above
                if (tc.kind && !s.toolBubbles.has(toolCallId)) {
                  const toolName = tc.title || tc.kind || 'MCP Tool';
                  
                  window.acpLog?.('INFO', '[ACP] 🔧 MCP Fallback - Creating bubble for:', tc.kind, toolName);

                  s.bubbleId = null;
                  s.text = '';

                  const toolBubbleId = gen();
                  s.toolBubbles.set(toolCallId, toolBubbleId);

                  if (!s.toolTypes) s.toolTypes = new Map();
                  s.toolTypes.set(toolCallId, { isMcp: true, kind: tc.kind });

                  // Store input for later
                  if (!s.toolInputs) s.toolInputs = new Map();
                  s.toolInputs.set(toolCallId, inputObj);

                  // Create the tool bubble with toolFormerData included
                  const toolData = {
                    tool: MCP_TOOL_TYPE,
                    toolCallId: toolCallId,
                    toolIndex: 0,
                    modelCallId: "",
                    status: 'loading',
                    name: tc.kind || 'mcp_tool',
                    params: inputObj,
                    rawArgs: inputObj,
                    additionalData: {
                      mcpKind: tc.kind,
                      mcpTitle: tc.title
                    }
                  };

                  const toolBubble = {
                    bubbleId: toolBubbleId,
                    type: 2,
                    text: '',
                    richText: '',
                    codeBlocks: [],
                    createdAt: new Date().toISOString(),
                    capabilityType: TOOL_FORMER_CAPABILITY,
                    toolFormerData: toolData
                  };

                  svc.appendComposerBubbles(composerHandle, [toolBubble]);
                  svc.updateComposerDataSetStore({{e}}, u => {
                    u("generatingBubbleIds", [toolBubbleId]);
                    u("currentBubbleId", toolBubbleId);
                  });
                }

                // Handle MCP fallback completion
                const storedMcpType = s.toolTypes?.get(toolCallId);
                if (storedMcpType?.isMcp && (isComplete || isFailed)) {
                  const mcpFinalStatus = isFailed ? 'error' : 'completed';
                  const toolBubbleId = s.toolBubbles.get(toolCallId);

                  if (toolBubbleId) {
                    // Get output
                    let output = '';
                    if (Array.isArray(tc.content)) {
                      const textContent = tc.content.find(c => c.type === 'content');
                      if (textContent?.content?.text) {
                        output = textContent.content.text;
                      } else if (textContent?.text) {
                        output = textContent.text;
                      }
                    }

                    window.acpLog?.('INFO', '[ACP] ✅ MCP Tool completed:', storedMcpType.kind);

                    const result = {
                      success: !isFailed,
                      output: output
                    };

                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", "status", mcpFinalStatus);
                      u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                    });
                  }
                }
              } finally {
                if (isComplete || isFailed) {
                  resolvePendingTool(isFailed ? 'failed' : 'completed');
                }
              }
            }
              ,
              onPlan: (planUpdate) => {
                const s = window[stateKey];
                const entries = planUpdate?.entries || [];
                if (!Array.isArray(entries) || entries.length === 0) return;

                const normalizeStatus = (status) => {
                  if (!status) return 'pending';
                  const raw = `${status}`.toLowerCase();
                  if (raw.includes('in_progress') || raw.includes('in-progress') || raw.includes('doing')) return 'in_progress';
                  if (raw.includes('complete') || raw.includes('done') || raw.includes('finished')) return 'completed';
                  if (raw.includes('pending') || raw.includes('todo') || raw.includes('backlog')) return 'pending';
                  return status;
                };

                const todos = entries.map((entry, idx) => {
                  if (typeof entry === 'string') {
                    return { id: `plan_${idx + 1}`, content: entry, status: 'pending' };
                  }
                  const content = entry?.content || entry?.text || entry?.title || '';
                  const status = normalizeStatus(entry?.status || entry?.state || (entry?.completed ? 'completed' : null));
                  return {
                    id: entry?.id || entry?.todoId || entry?.key || `plan_${idx + 1}`,
                    content,
                    status
                  };
                }).filter(t => t.content);

                if (todos.length === 0) return;

                if (!s.planBubbleId) {
                  const planBubbleId = gen();
                  s.planBubbleId = planBubbleId;
                  s.planToolCallId = `plan_${planBubbleId}`;

                  const toolBubble = {
                    bubbleId: planBubbleId,
                    type: 2,
                    text: '',
                    richText: '',
                    codeBlocks: [],
                    createdAt: Date.now(),
                    capabilityType: 'agentic'
                  };

                  window.acpLog?.('INFO', '[ACP] 🗂️ Creating PLAN bubble:', s.planToolCallId, 'todos:', todos.length);
                  svc.appendComposerBubbles(composerHandle, [toolBubble]);
                }

                const rawArgs = { todos };
                svc.updateComposerDataSetStore({{e}}, u => {
                  u("conversationMap", s.planBubbleId, "toolFormerData", {
                    type: TODO_WRITE_TYPE,
                    tool: TODO_WRITE_TYPE,
                    toolCallId: s.planToolCallId,
                    status: 'completed',
                    requestId: s.planBubbleId,
                    rawArgs: JSON.stringify(rawArgs),
                    params: rawArgs
                  });
                  u("conversationMap", s.planBubbleId, "isPlanExecution", true);
                  u("conversationMap", s.planBubbleId, "todos", todos);
                });
              },
              onMode: (modeUpdate) => {
                const currentModeId = modeUpdate?.currentModeId;
                if (!currentModeId) return;
                window.acpLog?.('INFO', '[ACP] 🧭 Current mode updated:', currentModeId);
                svc.updateComposerDataSetStore({{e}}, u => {
                  u("currentModeId", currentModeId);
                  u("modeId", currentModeId);
                });
              },
              onDone: () => {
                const s = window[stateKey];
                if (!s) return;
                s.streamDone = true;

                // Log token usage
                const usage = window.acpTokenUsage?.[{{e}}];
                if (usage) {
                  window.acpLog?.('INFO', '[ACP] 📊 Token usage:', JSON.stringify(usage));
                  s.tokenUsage = usage;
                }

                window.acpDebug?.('[ACP] ✅ end_turn received');
              }
            }
            ,
            { modeId: requestedModeId }
          );

          if (acpResponse.error) {
            throw new Error(acpResponse.message || 'ACP error');
          }

          window.acpLog?.('INFO', '[ACP] Response complete');
          const s = window[stateKey];
          if (s) {
            const startWaitEnd = Date.now();
            const maxWaitEndMs = 20000;
            while (!s.streamDone) {
              if (Date.now() - startWaitEnd > maxWaitEndMs) {
                window.acpLog?.('WARN', '[ACP] Timed out waiting for end_turn');
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            }
            const startWaitTools = Date.now();
            const maxWaitToolsMs = 20000;
            window.acpDebug?.('[ACP] ⏱️ Waiting for pending tool finalizers...', 'pending=', s.pendingToolCalls?.size || 0, 'finalizers=', s.pendingFinalizers?.size || 0);
            while ((s.pendingToolCalls?.size || 0) > 0 || (s.pendingFinalizers?.size || 0) > 0) {
              if (Date.now() - startWaitTools > maxWaitToolsMs) {
                window.acpLog?.('WARN', '[ACP] Pending tool finalizers timeout', 'pending=', s.pendingToolCalls?.size || 0, 'finalizers=', s.pendingFinalizers?.size || 0);
                break;
              }
              await new Promise(r => setTimeout(r, 200));
            }
            window.acpDebug?.('[ACP] ✅ Pending tools complete', 'pending=', s.pendingToolCalls?.size || 0, 'finalizers=', s.pendingFinalizers?.size || 0);
          }
          this._composerDataService.updateComposerDataSetStore({{e}}, o => {
            o("status", "completed");
            o("generatingBubbleIds", []);
            o("chatGenerationUUID", void 0);

            // Attach token usage
            const usage = window.acpTokenUsage?.[{{e}}];
            if (usage) {
              o("lastTokenUsage", usage);
            }
          });

          window.acpLog?.('INFO', '[ACP] Message completed successfully');
          return;

        } catch (acpError) {
          window.acpLog?.('ERROR', '[ACP] ❌ Error:', acpError);
          this._composerDataService.updateComposerDataSetStore({{e}}, o => o("status", "aborted"));
          throw acpError;
        }
      }

      window.acpLog?.('INFO', '[ACP] 🔵 Normal Cursor model, using standard flow:', modelName);
