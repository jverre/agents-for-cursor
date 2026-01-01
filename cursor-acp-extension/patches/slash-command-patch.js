// Slash Command Patch - Integrates ACP commands with Cursor's slash command UI
console.log("[ACP] Loading slash-command-patch.js...");

try {
  // Track the current model selection globally
  window.acpCurrentModel = null;

  // Integration helper for ACP slash commands
  window.acpSlashCommandIntegration = {
    // Set the current model (called when model changes)
    setCurrentModel(modelName) {
      window.acpCurrentModel = modelName;
      console.log('[ACP] Current model set to:', modelName);
    },

    // Check if current model is an ACP model (uses global tracking)
    isACPModelSelected(composerHandle) {
      try {
        // First check global tracking
        if (window.acpCurrentModel) {
          return window.acpCurrentModel.startsWith('acp:');
        }
        // Fallback to composer handle if available
        const modelName = composerHandle?.data?.modelConfig?.modelName || '';
        return modelName.startsWith('acp:');
      } catch (error) {
        console.error('[ACP] Error checking model:', error);
        return false;
      }
    },

    // Get ACP commands formatted for Cursor's slash command system
    getACPCommands(composerHandle) {
      // Only return commands if ACP model is selected
      if (!this.isACPModelSelected(composerHandle)) {
        return [];
      }

      if (!window.acpService) {
        return [];
      }

      const commands = window.acpService.getSlashCommands('claude-code');
      return commands.map(cmd => ({
        command: cmd.name,
        detail: cmd.description || '',
        sortText: `acp_${cmd.name}`,
        executeImmediately: false,
        isACP: true,
        // Include input hint if available
        inputHint: cmd.input?.hint || ''
      }));
    },

    // Refresh commands from backend
    async refreshCommands() {
      if (window.acpService) {
        await window.acpService.fetchSlashCommands('claude-code');
        console.log('[ACP] Slash commands refreshed');
      }
    },

    // Initialize session and fetch commands (call this when ACP model is selected)
    async initAndFetchCommands() {
      if (window.acpService) {
        // Set current model to enable slash command filtering
        this.setCurrentModel('acp:claude-code');
        const commands = await window.acpService.initSession('claude-code');
        console.log('[ACP] Initialized session, got', commands.length, 'slash commands');
        return commands;
      }
      return [];
    }
  };

  console.log("[ACP] Slash command integration ready");
  console.log("[ACP] Try: window.acpSlashCommandIntegration.getACPCommands()");

} catch (error) {
  console.error("[ACP] Error in slash-command-patch.js:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
