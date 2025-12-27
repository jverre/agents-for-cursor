// Provider Patch - Intercept submitChatMaybeAbortCurrent (THE REAL SUBMISSION FUNCTION!)
console.log("[ACP] Loading provider-patch.js...");

try {
  console.log("[ACP] Setting up chat submission interception...");

  // Strategy: Find and wrap submitChatMaybeAbortCurrent function
  let hookedObjects = new WeakSet();
  let hookInstalled = false;

  const searchAndHook = (obj, path = '', depth = 0) => {
    if (depth > 8 || !obj || typeof obj !== 'object' || hookedObjects.has(obj)) {
      return false;
    }

    hookedObjects.add(obj);

    try {
      // Check if this object has submitChatMaybeAbortCurrent
      if (typeof obj.submitChatMaybeAbortCurrent === 'function') {
        console.log('[ACP Provider] 🎯 FOUND submitChatMaybeAbortCurrent at:', path);

        const original = obj.submitChatMaybeAbortCurrent;

        obj.submitChatMaybeAbortCurrent = async function(...args) {
          console.log('[ACP Provider] 📥 Chat submission intercepted!');
          console.log('[ACP Provider] - Arguments:', args);
          console.log('[ACP Provider] - Composer ID:', args[0]);
          console.log('[ACP Provider] - Message:', args[1]?.substring(0, 100));
          console.log('[ACP Provider] - Options:', args[2]);
          console.log('[ACP Provider] - ACP enabled?', window.acpService?.enabled);

          // Check if ACP is enabled
          if (window.acpService?.enabled === true) {
            console.log('[ACP Provider] ✅ ROUTING TO ACP!');

            try {
              const composerId = args[0];
              const message = args[1] || '';
              const options = args[2] || {};

              // Build simple message array
              const messages = [{ role: 'user', content: message }];

              // Call ACP service
              const response = await window.acpService.handleRequest(
                options.modelOverride || 'unknown',
                messages
              );

              console.log('[ACP Provider] ✅ Got ACP response:', response);

              // Return the response text directly
              // We'll need to figure out how to inject this into the UI
              // For now, let's just log it and fall through to original
              console.log('[ACP Provider] Response text:', response.choices[0].message.content);

              // TODO: Figure out how to inject response into Cursor's UI
              // For now, fall through to original backend

            } catch (error) {
              console.error('[ACP Provider] ❌ ACP error:', error);
            }
          }

          // Call original function
          console.log('[ACP Provider] Calling original submitChatMaybeAbortCurrent');
          return original.apply(this, args);
        };

        console.log('[ACP Provider] ✅ Hook installed on submitChatMaybeAbortCurrent!');
        hookInstalled = true;
        return true;
      }

      // Search child properties
      const keys = Object.getOwnPropertyNames(obj);
      for (const key of keys) {
        try {
          const value = obj[key];
          if (value && typeof value === 'object' && searchAndHook(value, `${path}.${key}`, depth + 1)) {
            return true;
          }
        } catch (e) {
          // Skip inaccessible properties
        }
      }
    } catch (e) {
      // Skip errors
    }

    return false;
  };

  // Start polling search
  let checkInterval = setInterval(() => {
    if (hookInstalled) {
      clearInterval(checkInterval);
      return;
    }

    console.log('[ACP Provider] 🔍 Searching for submitChatMaybeAbortCurrent...');

    if (searchAndHook(window, 'window')) {
      clearInterval(checkInterval);
    }
  }, 500);

  // Stop after 30 seconds
  setTimeout(() => {
    if (!hookInstalled) {
      clearInterval(checkInterval);
      console.warn('[ACP Provider] ⚠️  Could not find submitChatMaybeAbortCurrent');
    }
  }, 30000);

  console.log("[ACP] provider-patch.js loaded - monitoring for chat service");

} catch (error) {
  console.error("[ACP] FATAL ERROR in provider-patch.js:", error);
  console.error("[ACP] Stack:", error.stack);
}
