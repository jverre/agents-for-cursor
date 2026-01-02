// Chat Interception Template
// This template is used to replace submitChatMaybeAbortCurrent in workbench.desktop.main.js
// Placeholders will be replaced with actual minified variable names during patching

async submitChatMaybeAbortCurrent({{e}}, {{t}}, {{n}}, {{s}} = {{defaultVal}}) {
      let {{r}} = {{ssFunc}}();
      {{s}}.setAttribute("requestId", {{r}});

      /* === ACP CHAT INTERCEPTION === */
      const composerHandle = this._composerDataService.getWeakHandleOptimistic({{e}});
      const modelName = {{n}}?.modelOverride || composerHandle?.data?.modelConfig?.modelName || '';

      // Track current model for slash command filtering
      if (window.acpSlashCommandIntegration?.setCurrentModel) {
        window.acpSlashCommandIntegration.setCurrentModel(modelName);
      }

      if (modelName.startsWith('acp:')) {
        console.log('[ACP] 🎯 Intercepting message for ACP model:', modelName);

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
              console.warn('[ACP] Failed to refresh slash commands:', err)
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
          window[stateKey] = { text: '', bubbleId: responseBubbleId, toolBubbles: new Map(), toolNames: new Map() };

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
                const dbg = (msg) => fetch(`http://localhost:37842/acp/debug?msg=${encodeURIComponent(msg)}`).catch(() => {});

                dbg(`🔧 onToolCall: ${tc.sessionUpdate} | ${tc.status || 'no-status'} | FULL_ID=${tc.toolCallId || 'none'}`);

                const s = window[stateKey];
                const toolCallId = tc.toolCallId;
                const isNew = tc.sessionUpdate === 'tool_call';
                const isComplete = tc.status === 'completed';
                const isFailed = tc.status === 'failed';
                // Priority: name/tool (actual tool name) > title (display) > kind
                const rawToolName = tc.name || tc.tool || tc.title || tc.kind || 'Tool';

                // Normalize tool names from display titles to actual tool names
                const TOOL_NAME_MAP = {
                  'Read File': 'Read', 'Read': 'Read',
                  'Edit File': 'Edit', 'Edit': 'Edit',
                  'Write File': 'Write', 'Write': 'Write',
                  'List Directory': 'LS', 'LS': 'LS',
                  'Grep': 'Grep', 'Search': 'Grep',
                  'Glob': 'Glob', 'Find': 'Glob',
                  'Bash': 'Bash', 'Terminal': 'Bash', 'Run Command': 'Bash',
                  'BashOutput': 'BashOutput',
                  'KillShell': 'KillShell',
                  'WebFetch': 'WebFetch', 'Fetch': 'WebFetch',
                  'WebSearch': 'WebSearch', 'Web Search': 'WebSearch',
                  'Task': 'Task', 'Agent': 'Task',
                  'TodoWrite': 'TodoWrite', 'Todo': 'TodoWrite',
                  'TodoRead': 'TodoRead',
                  'ExitPlanMode': 'ExitPlanMode', 'Plan': 'ExitPlanMode',
                  'NotebookRead': 'NotebookRead', 'NotebookEdit': 'NotebookEdit',
                  'LSP': 'LSP',
                  'AskUserQuestion': 'AskUserQuestion', 'Question': 'AskUserQuestion',
                };
                // Try exact match first, then prefix match for dynamic titles
                let toolName = TOOL_NAME_MAP[rawToolName];
                if (!toolName) {
                  // Check if rawToolName starts with any known prefix
                  for (const [prefix, name] of Object.entries(TOOL_NAME_MAP)) {
                    if (rawToolName.startsWith(prefix)) {
                      toolName = name;
                      break;
                    }
                  }
                }
                toolName = toolName || 'Read'; // Default

                // Map ACP tools to Cursor's internal tool IDs to avoid approval UI
                // MCP (49) requires approval - internal tools don't
                const ACP_TOOL_MAP = {
                  // File operations
                  'Read': 40,           // READ_FILE_V2
                  'Edit': 38,           // EDIT_FILE_V2
                  'Write': 38,          // EDIT_FILE_V2
                  'LS': 39,             // LIST_DIR_V2
                  // Search operations
                  'Grep': 41,           // RIPGREP_RAW_SEARCH
                  'Glob': 42,           // GLOB_FILE_SEARCH
                  // Terminal
                  'Bash': 15,           // RUN_TERMINAL_COMMAND_V2
                  'BashOutput': 15,     // RUN_TERMINAL_COMMAND_V2
                  'KillShell': 15,      // RUN_TERMINAL_COMMAND_V2
                  // Web
                  'WebFetch': 18,       // WEB_SEARCH
                  'WebSearch': 18,      // WEB_SEARCH
                  // Tasks & Planning
                  'Task': 48,           // TASK_V2
                  'TodoWrite': 35,      // TODO_WRITE
                  'TodoRead': 34,       // TODO_READ
                  'ExitPlanMode': 43,   // CREATE_PLAN
                  // Notebook
                  'NotebookRead': 40,   // READ_FILE_V2 (closest match)
                  'NotebookEdit': 38,   // EDIT_FILE_V2 (closest match)
                  // Code navigation
                  'LSP': 31,            // GO_TO_DEFINITION
                  // Questions
                  'AskUserQuestion': 51, // ASK_QUESTION
                };
                const acpToolId = ACP_TOOL_MAP[toolName] || 40; // Default to READ_FILE

                // Debug: show all tool bubble IDs in map
                const existingIds = Array.from(s.toolBubbles.keys()).map(id => id?.slice(0,12)).join(',');
                dbg(`🔧 isNew=${isNew} complete=${isComplete} failed=${isFailed} raw=${rawToolName?.slice(0,15)} name=${toolName} toolId=${acpToolId} existing=[${existingIds}]`);

                // Get tool input - may be empty on first event, populated on subsequent
                const toolInput = tc.input || tc.rawInput || {};
                const inputObj = typeof toolInput === 'string' ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })() : toolInput;
                const hasInput = Object.keys(inputObj).length > 0;

                // Helper to build params based on tool type
                const buildParams = (name, input, title) => {
                  switch (name) {
                    case 'Read':
                      return input.file_path ? { targetFile: input.file_path, effectiveUri: `file://${input.file_path}`, limit: input.limit, offset: input.offset } : {};
                    case 'Edit':
                      return input.file_path ? { targetFile: input.file_path, effectiveUri: `file://${input.file_path}`, oldString: input.old_string, newString: input.new_string } : {};
                    case 'Write':
                      return input.file_path ? { targetFile: input.file_path, effectiveUri: `file://${input.file_path}`, content: input.content } : {};
                    case 'LS':
                      return { targetDirectory: input.path || '.' };
                    case 'Grep':
                      return { pattern: input.pattern, path: input.path, glob: input.glob, outputMode: input.output_mode };
                    case 'Glob':
                      return { globPattern: input.pattern, targetDirectory: input.path };
                    case 'Bash':
                    case 'BashOutput': {
                      // Command from input.command, or extract from backtick-quoted title
                      const titleCmd = title?.match(/`([^`]+)`/)?.[1] || '';
                      const cmd = input.command || titleCmd || '';
                      return {
                        command: cmd,
                        requireUserApproval: false,
                        parsingResult: {
                          executableCommands: [{
                            name: cmd.split(' ')[0] || 'cmd',
                            args: cmd.split(' ').slice(1).map(a => ({ type: 'word', value: a })),
                            fullText: cmd
                          }]
                        }
                      };
                    }
                    case 'WebFetch':
                      return { url: input.url, prompt: input.prompt };
                    case 'WebSearch':
                      return { query: input.query };
                    case 'Task':
                      return { description: input.description, prompt: input.prompt };
                    default:
                      return {};
                  }
                };

                // On first tool_call for this ID, create bubble immediately
                if (isNew && !s.toolBubbles.has(toolCallId)) {
                  s.bubbleId = null;
                  s.text = '';

                  const toolBubbleId = gen();
                  s.toolBubbles.set(toolCallId, toolBubbleId);
                  s.toolNames.set(toolCallId, toolName);

                  const CURSOR_TOOL_NAMES = {
                    'Bash': 'run_terminal_cmd', 'BashOutput': 'run_terminal_cmd',
                    'Read': 'read_file', 'Edit': 'edit_file', 'Write': 'write_file',
                    'Grep': 'grep_search', 'Glob': 'file_search', 'LS': 'list_dir',
                    'WebSearch': 'web_search', 'WebFetch': 'web_fetch',
                    'Task': 'task', 'TodoWrite': 'todo_write',
                  };
                  const cursorToolName = CURSOR_TOOL_NAMES[toolName] || toolName.toLowerCase().replace(/\s+/g, '_');
                  const params = buildParams(toolName, inputObj, tc.title);

                  // HARDCODED for testing - exact format from working Cursor DB
                  const toolBubble = {
                    _v: 3,
                    bubbleId: toolBubbleId,
                    type: 2,
                    text: '',
                    richText: '',
                    codeBlocks: [],
                    createdAt: new Date().toISOString(),
                    capabilityType: 15,
                    isAgentic: false,
                    approximateLintErrors: [],
                    lints: [],
                    toolResults: [],
                    capabilities: [],
                    capabilityStatuses: {},
                    supportedTools: [],
                    tokenCount: { inputTokens: 0, outputTokens: 0 },
                    toolFormerData: {
                      tool: 15,
                      toolIndex: 0,
                      modelCallId: gen(),
                      toolCallId: toolCallId,
                      status: 'loading',
                      rawArgs: '{"command": "echo chicken", "is_background": false}',
                      name: 'run_terminal_cmd',
                      params: '{"command":"echo chicken","requireUserApproval":true,"parsingResult":{"executableCommands":[{"name":"echo","args":[{"type":"word","value":"chicken"}],"fullText":"echo chicken"}]}}',
                      additionalData: {}
                    }
                  };

                  dbg(`🔧 Creating bubble: ${toolBubbleId.slice(0,8)} tool=${toolName} hasInput=${hasInput}`);

                  // Show notification with available data for debugging
                  try {
                    const debugData = {
                      toolName,
                      rawToolName,
                      hasInput,
                      'tc.title': tc.title,
                      'tc.name': tc.name,
                      'tc.tool': tc.tool,
                      'inputObj.command': inputObj?.command,
                      'params.command': params?.command
                    };
                    console.log('[ACP DEBUG DATA]', debugData);
                    alert('[ACP Debug]\n' + JSON.stringify(debugData, null, 2));
                  } catch (e) {}
                  try {
                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  } catch (err) {
                    dbg(`🔧 Create ERROR: ${err.message}`);
                  }
                }

                // Update params when we receive new data (subsequent tool_call with input)
                if (isNew && s.toolBubbles.has(toolCallId) && hasInput) {
                  const toolBubbleId = s.toolBubbles.get(toolCallId);
                  const params = buildParams(toolName, inputObj, tc.title);
                  const rawArgs = (toolName === 'Bash' || toolName === 'BashOutput')
                    ? { command: params.command || '', is_background: false }
                    : inputObj;
                  dbg(`🔧 Updating params for ${toolBubbleId.slice(0,8)}: cmd=${params.command?.slice(0,20)}`);

                  // Debug alert for update
                  alert('[ACP UPDATE]\ntitle: ' + tc.title + '\ncommand: ' + (inputObj?.command || params?.command));
                  try {
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", "params", JSON.stringify(params));
                      u("conversationMap", toolBubbleId, "toolFormerData", "rawArgs", JSON.stringify(rawArgs));
                    });
                  } catch (err) {
                    dbg(`🔧 Update params ERROR: ${err.message}`);
                  }
                }

                // Update tool bubble on completion
                if (isComplete || isFailed) {
                  const toolBubbleId = s.toolBubbles.get(toolCallId);
                  const cachedToolName = s.toolNames?.get(toolCallId) || toolName;
                  dbg(`🔧 ${isFailed ? 'Failed' : 'Completion'}: bubbleId=${toolBubbleId?.slice(0,8) || 'none'} tool=${cachedToolName}`);

                  if (toolBubbleId) {
                    try {
                      // Format result based on tool type
                      let resultStr;
                      const finalStatus = isFailed ? 'error' : 'completed';

                      if (cachedToolName === 'Bash' || cachedToolName === 'BashOutput') {
                        // Terminal result format - extract output from ACP response
                        let output = '';
                        if (Array.isArray(tc.result)) {
                          // ACP format: [{type: 'text', text: 'output'}]
                          output = tc.result.map(r => r.text || '').join('');
                        } else if (typeof tc.result === 'string') {
                          output = tc.result;
                        } else if (tc.content) {
                          output = typeof tc.content === 'string' ? tc.content : JSON.stringify(tc.content);
                        }
                        resultStr = JSON.stringify({
                          output: output,
                          rejected: false,
                          notInterrupted: true,
                          endedReason: isFailed ? 'RUN_TERMINAL_COMMAND_ENDED_REASON_ERROR' : 'RUN_TERMINAL_COMMAND_ENDED_REASON_EXECUTION_COMPLETED',
                          exitCodeV2: isFailed ? 1 : 0
                        });
                      } else {
                        // Default: stringify result
                        const toolResult = tc.result || tc.content || (isFailed ? 'Tool execution failed' : '');
                        resultStr = typeof toolResult === 'string' ? toolResult : JSON.stringify(toolResult);
                      }

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", finalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", resultStr);
                      });
                      dbg(`🔧 Marked ${finalStatus} OK (native) with result`);
                    } catch (err) {
                      dbg(`🔧 Status update ERROR: ${err.message}`);
                    }
                  }
                }
              }
            }
          );

          if (acpResponse.error) {
            throw new Error(acpResponse.message || 'ACP error');
          }

          console.log('[ACP] Response complete');
          this._composerDataService.updateComposerDataSetStore({{e}}, o => {
            o("status", "completed");
            o("generatingBubbleIds", []);
            o("chatGenerationUUID", void 0);
          });

          console.log('[ACP] Message completed successfully');
          return;

        } catch (acpError) {
          console.error('[ACP] ❌ Error:', acpError);
          this._composerDataService.updateComposerDataSetStore({{e}}, o => o("status", "aborted"));
          throw acpError;
        }
      }

      console.log('[ACP] 🔵 Normal Cursor model, using standard flow:', modelName);
