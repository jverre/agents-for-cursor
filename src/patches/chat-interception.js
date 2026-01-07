// Chat Interception Template
// This template is used to replace submitChatMaybeAbortCurrent in workbench.desktop.main.js
// Placeholders will be replaced with actual minified variable names during patching

async submitChatMaybeAbortCurrent({{e}}, {{t}}, {{n}}, {{s}} = {{defaultVal}}) {
      let {{r}} = {{ssFunc}}();
      {{s}}.setAttribute("requestId", {{r}});

      {{ACP_TOKEN}}
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
          window[stateKey] = { text: '', bubbleId: responseBubbleId, toolBubbles: new Map() };

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
                const toolName = tc.kind || 'tool';

                const TOOL_FORMER_CAPABILITY = 15;
                const ACP_TOOL_TYPE = 90;
                const READ_FILE_V2_TYPE = 40;

                // Detect if this is a Read tool
                const isReadTool = tc.kind === 'read';

                // Get tool input - may be empty on first event, populated on subsequent
                const toolInput = tc.input || tc.rawInput || {};
                const inputObj = typeof toolInput === 'string' ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })() : toolInput;
                const hasInput = Object.keys(inputObj).length > 0;

                // On first tool_call for this ID, create a tool bubble
                // For Read tools: wait for file_path before creating (skip empty first event)
                if (isNew && !s.toolBubbles.has(toolCallId)) {
                  // For Read tools without file_path, skip creation - wait for second event
                  if (isReadTool && !inputObj.file_path) {
                    alert('[ACP-READ] Skipping empty first event, waiting for file path');
                    return;
                  }

                  s.bubbleId = null;
                  s.text = '';

                  // Create a single formatted text bubble for the tool call
                  const toolBubbleId = gen();
                  s.toolBubbles.set(toolCallId, toolBubbleId);

                  // Track tool type for completion handling
                  if (!s.toolTypes) s.toolTypes = new Map();
                  s.toolTypes.set(toolCallId, { isRead: isReadTool });

                  // Transform tool data based on kind
                  let toolData;
                  if (isReadTool) {
                    // Map to Cursor's READ_FILE_V2 format (type 40)
                    // Note: ACP sends 2 tool_call events - first with empty rawInput, second with file_path
                    const filePath = inputObj.file_path || '';

                    alert('[ACP-READ] Creating bubble\nFile path: ' + (filePath || '(empty)') + '\ninputObj: ' + JSON.stringify(inputObj));

                    // Always create type 40 for Read tools, even if file path is empty initially
                    // It will be updated when the second tool_call event arrives with the file path
                    const cursorRawArgs = filePath ? {
                      target_file: filePath,
                      limit: inputObj.limit,
                      offset: inputObj.offset
                    } : {};

                    // Proper URI format: file:// + /path = file:///path (three slashes total)
                    const effectiveUri = filePath ? ('file://' + filePath) : '';

                    toolData = {
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

                    alert('[ACP-READ] Created bubble (type 40)\ntargetFile: ' + (filePath || '(empty)') + '\neffectiveUri: ' + (effectiveUri || '(empty)'));
                  } else {
                    // Default ACP tool rendering (type 90)
                    toolData = {
                      tool: ACP_TOOL_TYPE,
                      toolCallId: toolCallId,
                      status: 'loading',
                      name: toolName,
                      rawArgs: JSON.stringify(inputObj),
                      result: null
                    };
                  }

                  // ACP Tool Bubble - simplified structure
                  // toolFormerData fields: tool, status, name, rawArgs (input JSON), result (output JSON)
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

                  try {
                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  } catch (err) {
                    console.error('[ACP] Tool bubble create failed:', err);
                  }
                }

                // Update rawArgs when we receive input data (second tool_call event)
                if (isNew && s.toolBubbles.has(toolCallId) && hasInput) {
                  const toolBubbleId = s.toolBubbles.get(toolCallId);

                  // For Read tools, we need to update params too (not just rawArgs)
                  if (isReadTool && inputObj.file_path) {
                    const filePath = inputObj.file_path;
                    const cursorRawArgs = {
                      target_file: filePath,
                      limit: inputObj.limit,
                      offset: inputObj.offset
                    };
                    // Proper URI format: file:// + /path = file:///path (three slashes total)
                    const effectiveUri = 'file://' + filePath;

                    alert('[ACP-READ] Updating with file path\nFile: ' + filePath + '\neffectiveUri: ' + effectiveUri);

                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", "rawArgs", cursorRawArgs);
                      u("conversationMap", toolBubbleId, "toolFormerData", "params", {
                        targetFile: filePath,
                        effectiveUri: effectiveUri,
                        limit: inputObj.limit || 1000,
                        charsLimit: 100000
                      });
                    });
                  } else {
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", "rawArgs", JSON.stringify(inputObj));
                    });
                  }
                }

                // Check for tool_result event as completion indicator
                const isToolResult = tc.sessionUpdate === 'tool_result';

                // Update tool bubble on completion
                if (isComplete || isFailed || isToolResult) {
                  const toolBubbleId = s.toolBubbles.get(toolCallId);
                  if (toolBubbleId) {
                    const finalStatus = isFailed ? 'error' : 'completed';

                    alert('[ACP-READ] Completion event\nstatus: ' + finalStatus + '\nhas content: ' + !!tc.content + '\nhas result: ' + !!tc.result);

                    // Extract output from ACP response
                    let output = '';
                    if (Array.isArray(tc.result)) {
                      output = tc.result.map(r => r.text || '').join('');
                    } else if (typeof tc.result === 'string') {
                      output = tc.result;
                    } else if (tc.content && Array.isArray(tc.content)) {
                      // Extract from ACP content array format: content[0].content.text
                      const textContent = tc.content.find(c => c.type === 'content');
                      if (textContent?.content?.text) {
                        output = textContent.content.text;
                        // ACP wraps file content in markdown code blocks (```), unwrap them
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

                    // Transform result for Read tools to Cursor format
                    // Check stored tool type since tc.kind may not be in update event
                    const toolType = s.toolTypes?.get(toolCallId);
                    const wasReadTool = toolType?.isRead || tc.kind === 'read';

                    alert('[ACP-READ] Extracted output\nLength: ' + output.length + '\nFirst 100 chars: ' + output.slice(0, 100) + '\nWas Read tool: ' + wasReadTool);

                    let finalResult = output;
                    if (wasReadTool && output) {
                      const lines = output.split('\n');
                      finalResult = {
                        contents: output,
                        numCharactersInRequestedRange: output.length,
                        totalLinesInFile: lines.length
                      };
                      alert('[ACP-READ] Transformed result\nLines: ' + lines.length + '\nChars: ' + output.length + '\nResult is object: ' + (typeof finalResult === 'object'));
                    }

                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", "status", finalStatus);
                      u("conversationMap", toolBubbleId, "toolFormerData", "result", finalResult);
                    });
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
