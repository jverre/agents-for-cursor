// Slash Command Patch - Integrates ACP commands with Cursor's slash command UI
window.acpLog?.('INFO', "[ACP] Loading slash-command-patch.js...");

try {
  const installModeFilter = () => {
    if (window._acpModeFilterInstalled) return;
    window._acpModeFilterInstalled = true;

    const updateModelFromUi = () => {
      const candidates = [
        document.querySelector('.composer-unified-dropdown-model'),
        document.querySelector('[data-testid="composer-model"]'),
        document.querySelector('.composer-unified-dropdown-model .monaco-highlighted-label'),
        document.querySelector('.composer-unified-dropdown-model span')
      ].filter(Boolean);

      const label = candidates.map(el => (el.textContent || '').trim()).find(text => text) || '';
      if (!label) return null;
      const isAcp =
        label.includes('ACP') ||
        label.toLowerCase().startsWith('acp:') ||
        label.includes('Claude Code');
      window._acpModeFilterEnabled = isAcp;
      return isAcp;
    };

    const filterModeMenu = () => {
      const isAcpFromUi = updateModelFromUi();
      const shouldFilter = typeof isAcpFromUi === 'boolean' ? isAcpFromUi : window._acpModeFilterEnabled;
      const items = Array.from(
        document.querySelectorAll(
          '.composer-unified-context-menu-item, .monaco-action-bar .action-item, [role="menuitem"]'
        )
      );
      if (items.length === 0) return;

      const labels = items.map(item => (item.textContent || '').trim());
      const hasModeItems = labels.some(label => label.startsWith('Agent') || label.startsWith('Plan'));
      if (!hasModeItems) return;

      items.forEach(item => {
        const label = (item.textContent || '').trim();
        if (shouldFilter && (label.startsWith('Ask') || label.startsWith('Debug'))) {
          if (!item.dataset.acpHidden) {
            item.dataset.acpHidden = 'true';
            item.dataset.acpPrevDisplay = item.style.display || '';
          }
          item.style.display = 'none';
        } else if (item.dataset.acpHidden) {
          item.style.display = item.dataset.acpPrevDisplay || '';
          delete item.dataset.acpHidden;
          delete item.dataset.acpPrevDisplay;
        }
      });
    };

    const observer = new MutationObserver(filterModeMenu);
    observer.observe(document.body, { childList: true, subtree: true });
    window._acpModeFilterObserver = observer;
    filterModeMenu();

    if (!window._acpModeFilterInterval) {
      window._acpModeFilterInterval = setInterval(() => {
        filterModeMenu();
      }, 300);
    }

    if (!window._acpModeFilterClickHandler) {
      window._acpModeFilterClickHandler = (event) => {
        const target = event?.target;
        if (!target) return;
        const trigger = target.closest?.('.composer-unified-dropdown[data-mode], [data-mode].composer-unified-dropdown');
        if (trigger) {
          setTimeout(filterModeMenu, 50);
          setTimeout(filterModeMenu, 200);
        }
      };
      document.addEventListener('click', window._acpModeFilterClickHandler, true);
    }
  };

  // Track the current model selection globally
  window.acpCurrentModel = null;

  // Integration helper for ACP slash commands
  window.acpSlashCommandIntegration = {
    // Set the current model (called when model changes)
    setCurrentModel(modelName) {
      window.acpCurrentModel = modelName;
      window._acpModeFilterEnabled = typeof modelName === 'string' && modelName.startsWith('acp:');
      installModeFilter();
      window.acpLog?.('INFO', '[ACP] Current model set to:', modelName);
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
        window.acpLog?.('ERROR', '[ACP] Error checking model:', error);
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
        window.acpLog?.('INFO', '[ACP] Slash commands refreshed');
      }
    },

    // Initialize session and fetch commands (call this when ACP model is selected)
    async initAndFetchCommands() {
      if (window.acpService) {
        // Set current model to enable slash command filtering
        this.setCurrentModel('acp:claude-code');
        const commands = await window.acpService.initSession('claude-code');
        window.acpLog?.('INFO', '[ACP] Initialized session, got', commands.length, 'slash commands');
        return commands;
      }
      return [];
    }
  };

  // Initialize mode filter immediately so dropdown filtering works before first send
  installModeFilter();

  window.acpLog?.('INFO', "[ACP] Slash command integration ready");
  window.acpLog?.('INFO', "[ACP] Try: window.acpSlashCommandIntegration.getACPCommands()");

} catch (error) {
  window.acpLog?.('ERROR', "[ACP] Error in slash-command-patch.js:", error);
  window.acpLog?.('ERROR', "[ACP] Stack trace:", error.stack);
}
