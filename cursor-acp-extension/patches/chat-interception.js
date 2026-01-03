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
                const dbg = (msg) => fetch(`http://localhost:37842/acp/debug?msg=${encodeURIComponent(msg)}`).catch(() => {});
                dbg(`🔧 onToolCall: ${tc.sessionUpdate} | ${tc.status || 'no-status'} | FULL_ID=${tc.toolCallId || 'none'}`);

                const s = window[stateKey];
                const toolCallId = tc.toolCallId;
                const isNew = tc.sessionUpdate === 'tool_call';
                const isComplete = tc.status === 'completed';
                const isFailed = tc.status === 'failed';
                // Use tool kind from ACP (e.g., "read", "edit", "bash")
                const toolName = tc.kind || 'tool';

                // Use Cursor's TOOL_FORMER capabilityType (15) so bubbles render
                // Use custom tool type 90 - need to patch React renderer to handle it
                const TOOL_FORMER_CAPABILITY = 15;  // Cursor's $s.TOOL_FORMER
                const ACP_TOOL_TYPE = 90;  // Custom ACP tool type

                // All ACP tools use the unified ACP type
                const acpToolId = ACP_TOOL_TYPE;

                // Debug: show all tool bubble IDs in map
                const existingIds = Array.from(s.toolBubbles.keys()).map(id => id?.slice(0,12)).join(',');
                dbg(`🔧 isNew=${isNew} complete=${isComplete} failed=${isFailed} raw=${rawToolName?.slice(0,15)} name=${toolName} toolId=${acpToolId} existing=[${existingIds}]`);

                // Get tool input - may be empty on first event, populated on subsequent
                const toolInput = tc.input || tc.rawInput || {};
                const inputObj = typeof toolInput === 'string' ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })() : toolInput;
                const hasInput = Object.keys(inputObj).length > 0;

                // On first tool_call for this ID, create a tool bubble
                if (isNew && !s.toolBubbles.has(toolCallId)) {
                  s.bubbleId = null;
                  s.text = '';

                  // Create a single formatted text bubble for the tool call
                  const toolBubbleId = gen();
                  s.toolBubbles.set(toolCallId, toolBubbleId);

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
                    toolFormerData: {
                      tool: ACP_TOOL_TYPE,
                      toolCallId: toolCallId,
                      status: 'loading',
                      name: toolName,
                      rawArgs: JSON.stringify(inputObj),
                      result: null
                    }
                  };

                  dbg(`🔧 Creating tool bubble: id=${toolBubbleId.slice(0,8)} name=${toolName} capType=${toolBubble.capabilityType} toolType=${toolBubble.toolFormerData?.tool}`);
                  try {
                    svc.appendComposerBubbles(composerHandle, [toolBubble]);
                    dbg(`🔧 Tool bubble appended OK`);
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("generatingBubbleIds", [toolBubbleId]);
                      u("currentBubbleId", toolBubbleId);
                    });
                  } catch (err) {
                    dbg(`🔧 Create ERROR: ${err.message}`);
                    console.error('[ACP] Tool bubble create failed:', err);
                  }
                }

                // Update rawArgs when we receive input data
                if (isNew && s.toolBubbles.has(toolCallId) && hasInput) {
                  const toolBubbleId = s.toolBubbles.get(toolCallId);
                  dbg(`🔧 Updating rawArgs for ${toolBubbleId.slice(0,8)}`);
                  try {
                    svc.updateComposerDataSetStore({{e}}, u => {
                      u("conversationMap", toolBubbleId, "toolFormerData", "rawArgs", JSON.stringify(inputObj));
                    });
                  } catch (err) {
                    dbg(`🔧 Update rawArgs ERROR: ${err.message}`);
                  }
                }

                // Check for tool_result event as completion indicator
                const isToolResult = tc.sessionUpdate === 'tool_result';

                // Update tool bubble on completion
                if (isComplete || isFailed || isToolResult) {
                  const toolBubbleId = s.toolBubbles.get(toolCallId);
                  dbg(`🔧 Completion: bubbleId=${toolBubbleId?.slice(0,8) || 'none'}`);

                  if (toolBubbleId) {
                    try {
                      const finalStatus = isFailed ? 'error' : 'completed';

                      // Extract output from ACP response
                      let output = '';
                      if (Array.isArray(tc.result)) {
                        output = tc.result.map(r => r.text || '').join('');
                      } else if (typeof tc.result === 'string') {
                        output = tc.result;
                      } else if (tc.content) {
                        output = typeof tc.content === 'string' ? tc.content : JSON.stringify(tc.content);
                      } else if (isFailed) {
                        output = 'Tool execution failed';
                      }

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", finalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", output);
                      });
                      dbg(`🔧 Marked ${finalStatus}`);
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
