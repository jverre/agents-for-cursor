// Chat Interception - Replace submitChatMaybeAbortCurrent to route ACP model requests
// This code is injected into workbench.desktop.main.js to intercept chat submissions

async submitChatMaybeAbortCurrent(e, t, n, s = yj) {
  let r = ss();
  s.setAttribute("requestId", r);

  /* === ACP CHAT INTERCEPTION === */
  // Get the model name first
  const composerHandle = this._composerDataService.getWeakHandleOptimistic(e);
  const modelName = n?.modelOverride || composerHandle?.data?.modelConfig?.modelName || '';

  // Only route to ACP if model starts with "acp:"
  if (modelName.startsWith('acp:')) {
    console.log('[ACP] 🎯 Intercepting message for ACP model:', modelName);

    try {
      if (!composerHandle) {
        throw new Error('No composer handle');
      }

      const shouldClearText = !n?.isResume && !n?.skipClearInput && !n?.bubbleId;

      // Create and add human message bubble
      const humanBubble = {
        bubbleId: ss(),
        type: 1,
        text: t || '',
        richText: n?.richText ?? t,
        codeBlocks: [],
        createdAt: new Date().toISOString(),
        requestId: r,
        modelInfo: { modelName: modelName || '' }
      };
      this._composerDataService.appendComposerBubbles(composerHandle, [humanBubble]);

      // Clear input and refocus
      shouldClearText && this._composerUtilsService.clearText(e);
      n?.skipFocusAfterSubmission || this._composerViewsService.focus(e, !0);

      // Set status to generating
      const aiBubbleId = ss();
      this._composerDataService.updateComposerDataSetStore(e, o => {
        o("status", "generating");
        o("generatingBubbleIds", [aiBubbleId]);
        o("currentBubbleId", void 0);
        o("isDraft", !1);
      });

      // Call ACP service
      const acpMessages = [{ role: 'user', content: t || '' }];
      const acpResponse = await window.acpService.handleRequest(modelName, acpMessages);

      if (acpResponse.error) {
        throw new Error(acpResponse.message || 'ACP error');
      }

      const responseText = acpResponse.choices?.[0]?.message?.content || '[No response]';

      // Create and add AI response bubble
      const aiBubble = {
        bubbleId: aiBubbleId,
        type: 2,
        text: responseText,
        codeBlocks: [],
        richText: responseText,
        createdAt: new Date().toISOString()
      };
      this._composerDataService.appendComposerBubbles(composerHandle, [aiBubble]);

      // Set status to completed
      this._composerDataService.updateComposerDataSetStore(e, o => {
        o("status", "completed");
        o("generatingBubbleIds", []);
        o("chatGenerationUUID", void 0);
      });

      console.log('[ACP] ✅ Message handled by ACP');
      return;

    } catch (acpError) {
      console.error('[ACP] ❌ Error:', acpError);
      this._composerDataService.updateComposerDataSetStore(e, o => o("status", "aborted"));
      throw acpError;
    }
  }

  // Not an ACP model - continue with normal Cursor flow
  console.log('[ACP] 🔵 Normal Cursor model, using standard flow:', modelName);

