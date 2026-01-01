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

          const aiBubbleId = {{ssFunc}}();
          this._composerDataService.updateComposerDataSetStore({{e}}, o => {
            o("status", "generating");
            o("generatingBubbleIds", [aiBubbleId]);
            o("currentBubbleId", void 0);
            o("isDraft", !1);
          });

          // Use composer ID for session management, send only current message
          // The ACP agent maintains conversation history internally per session
          const composerId = {{e}};
          const currentMessage = {{t}} || '';

          // Trigger slash command refresh in background (non-blocking)
          if (window.acpSlashCommandIntegration) {
            window.acpSlashCommandIntegration.refreshCommands().catch(err =>
              console.warn('[ACP] Failed to refresh slash commands:', err)
            );
          }

          console.log('[ACP] Sending message to session for composer:', composerId);
          const acpResponse = await window.acpService.handleRequest(modelName, currentMessage, composerId);

          if (acpResponse.error) {
            throw new Error(acpResponse.message || 'ACP error');
          }

          const responseText = acpResponse.choices?.[0]?.message?.content || '[No response]';

          const aiBubble = {
            bubbleId: aiBubbleId,
            type: 2,
            text: responseText,
            codeBlocks: [],
            richText: responseText,
            createdAt: new Date().toISOString()
          };
          this._composerDataService.appendComposerBubbles(composerHandle, [aiBubble]);

          this._composerDataService.updateComposerDataSetStore({{e}}, o => {
            o("status", "completed");
            o("generatingBubbleIds", []);
            o("chatGenerationUUID", void 0);
          });

          console.log('[ACP] ✅ Message handled by ACP');
          return;

        } catch (acpError) {
          console.error('[ACP] ❌ Error:', acpError);
          this._composerDataService.updateComposerDataSetStore({{e}}, o => o("status", "aborted"));
          throw acpError;
        }
      }

      console.log('[ACP] 🔵 Normal Cursor model, using standard flow:', modelName);
