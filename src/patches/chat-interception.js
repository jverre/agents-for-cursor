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
                const isToolResult = tc.sessionUpdate === 'tool_result';

                // Get tool input early for logging
                const toolInput = tc.input || tc.rawInput || {};
                const inputObj = typeof toolInput === 'string' ? (() => { try { return JSON.parse(toolInput); } catch { return {}; } })() : toolInput;

                // DEBUG: Log all tool calls with full details including content
                window.acpLog?.('DEBUG', '[ACP] onToolCall FULL:', JSON.stringify({
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

                const TOOL_FORMER_CAPABILITY = 15;
                const READ_FILE_V2_TYPE = 40;
                const RUN_TERMINAL_COMMAND_V2_TYPE = 15;
                const SEARCH_REPLACE_TYPE = 38;
                const GREP_TYPE = 41;
                const GLOB_TYPE = 42;
                const LIST_DIR_TYPE = 39;

                // Detect tool type (use stored type for updates, or detect from event)
                const storedType = s.toolTypes?.get(toolCallId);
                const isReadTool = tc.kind === 'read' || storedType?.isRead;
                const isBashTool = tc.kind === 'execute' || storedType?.isBash;
                const isEditTool = tc.kind === 'edit' || storedType?.isEdit;
                
                // Glob and LS detection - these come with kind: 'search' but have specific input fields
                // Glob tool: kind is 'search' and title contains 'Find' (NOT grep/Grep)
                const isGlobTool = (tc.kind === 'search' && tc.title?.includes('Find') && !tc.title?.toLowerCase().includes('grep')) || storedType?.isGlob;
                const isListDirTool = (tc.kind === 'search' && inputObj.target_directory && !inputObj.glob_pattern && !inputObj.pattern) || storedType?.isListDir;
                // Grep tool: kind is 'search' and title contains 'Grep' or 'grep'
                const isGrepTool = (tc.kind === 'search' && (tc.title?.includes('Grep') || tc.title?.includes('grep'))) || storedType?.isGrep;
                
                // Debug log for tool detection
                if (tc.kind === 'search' || storedType?.isGlob || storedType?.isGrep || storedType?.isListDir) {
                  window.acpLog?.('DEBUG', '[ACP] Search tool detection:', JSON.stringify({
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
                    
                    s.editData.set(toolCallId, {
                      filePath: inputObj.file_path,
                      oldString: inputObj.old_string || '',
                      newString: inputObj.new_string || '',
                      oldText: diffContent?.oldText || null,
                      newText: diffContent?.newText || null
                    });
                    
                    window.acpLog?.('DEBUG', '[ACP] Stored edit data for', toolCallId, 
                      'filePath:', inputObj.file_path,
                      'oldString len:', inputObj.old_string?.length || 0,
                      'newString len:', inputObj.new_string?.length || 0,
                      'diffOldText:', !!diffContent?.oldText,
                      'diffNewText:', !!diffContent?.newText);
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

                    window.acpLog?.('DEBUG', '[ACP] Edit creating bubble - filePath:', filePath);

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
                    
                    window.acpLog?.('DEBUG', '[ACP] Edit completion - toolBubbleId:', !!toolBubbleId, 'editData:', !!editData);
                    
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

                      window.acpLog?.('DEBUG', '[ACP] Edit content lengths - Before:', beforeContent?.length || 0, 'After:', afterContent?.length || 0);

                      // Simple hash function (matches Cursor's E9 hash)
                      const hashContent = async (content) => {
                        const encoder = new TextEncoder();
                        const data = encoder.encode(content);
                        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
                        const hashArray = Array.from(new Uint8Array(hashBuffer));
                        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
                      };

                      // Generate IDs and store content
                      (async () => {
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

                            window.acpLog?.('DEBUG', '[ACP] Stored content - Before ID:', beforeContentId.substring(0, 60), 'After ID:', afterContentId.substring(0, 60));
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

                        window.acpLog?.('DEBUG', '[ACP] Result set with IDs - beforeContentId:', beforeContentId, 'afterContentId:', afterContentId);
                      })();
                    }
                  }

                  return;
                }

                // ===== GREP TOOL (Type 41) =====
                if (isGrepTool) {
                  // Skip if no pattern yet (initial pending event)
                  if (isNew && !s.toolBubbles.has(toolCallId) && !inputObj.pattern) {
                    return;
                  }

                  // Store grep data when we receive it
                  if (isNew && inputObj.pattern) {
                    if (!s.grepData) s.grepData = new Map();
                    s.grepData.set(toolCallId, {
                      pattern: inputObj.pattern,
                      path: inputObj.path || '.',
                      outputMode: inputObj.output_mode || 'content',
                      caseInsensitive: inputObj['-i'] || false,
                      headLimit: inputObj.head_limit
                    });
                    window.acpLog?.('DEBUG', '[ACP] Stored grep data for', toolCallId, 'pattern:', inputObj.pattern);
                  }

                  if (isNew && !s.toolBubbles.has(toolCallId)) {
                    s.bubbleId = null;
                    s.text = '';

                    const toolBubbleId = gen();
                    s.toolBubbles.set(toolCallId, toolBubbleId);

                    if (!s.toolTypes) s.toolTypes = new Map();
                    s.toolTypes.set(toolCallId, { isGrep: true });

                    const grepData = s.grepData?.get(toolCallId) || {};
                    window.acpLog?.('DEBUG', '[ACP] Grep creating bubble - pattern:', grepData.pattern, 'path:', grepData.path);

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
                      window.acpLog?.('DEBUG', '[ACP] Grep result - files found:', files.length, 'output length:', output.length, 'match counts:', JSON.stringify(Object.fromEntries(fileMatchCounts)));

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
                      
                      window.acpLog?.('DEBUG', '[ACP] Grep result object:', JSON.stringify(result, null, 2));

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
                      
                      window.acpLog?.('DEBUG', '[ACP] Glob content:', JSON.stringify(tc.content, null, 2));
                      window.acpLog?.('DEBUG', '[ACP] Glob output text:', output);
                      
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

                      window.acpLog?.('DEBUG', '[ACP] Glob result object:', JSON.stringify(result, null, 2));

                      svc.updateComposerDataSetStore({{e}}, u => {
                        u("conversationMap", toolBubbleId, "toolFormerData", "status", globFinalStatus);
                        u("conversationMap", toolBubbleId, "toolFormerData", "result", result);
                      });
                    }
                  }

                  return;
                }
              }
            }
          );

          if (acpResponse.error) {
            throw new Error(acpResponse.message || 'ACP error');
          }

          window.acpLog?.('INFO', '[ACP] Response complete');
          this._composerDataService.updateComposerDataSetStore({{e}}, o => {
            o("status", "completed");
            o("generatingBubbleIds", []);
            o("chatGenerationUUID", void 0);
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
