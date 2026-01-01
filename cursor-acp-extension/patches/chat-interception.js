// Chat Interception Template
// This template is used to replace submitChatMaybeAbortCurrent in workbench.desktop.main.js
// Placeholders will be replaced with actual minified variable names during patching

async submitChatMaybeAbortCurrent({{e}}, {{t}}, {{n}}, {{s}} = {{defaultVal}}) {
      let {{r}} = {{ssFunc}}();
      {{s}}.setAttribute("requestId", {{r}});

      /* === ACP CHAT INTERCEPTION === */
      const composerHandle = this._composerDataService.getWeakHandleOptimistic({{e}});
      const modelName = {{n}}?.modelOverride || composerHandle?.data?.modelConfig?.modelName || '';

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

          // Extract full conversation from Cursor's bubble array
          const existingBubbles = composerHandle?.data?.bubbles || [];
          const fullConversation = existingBubbles.map(bubble => ({
            role: bubble.type === 1 ? 'user' : 'assistant',
            content: bubble.text || bubble.richText || ''
          }));

          // Add current message (not yet in bubbles)
          fullConversation.push({ role: 'user', content: {{t}} || '' });

          console.log('[ACP] Sending conversation with', fullConversation.length, 'messages');
          const acpResponse = await window.acpService.handleRequest(modelName, fullConversation);

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
