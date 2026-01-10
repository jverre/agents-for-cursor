// Model Debug Helper - Exposes ACP model info for debugging
window.acpLog?.('INFO', "[ACP] Loading model-patch.js...");

try {
  // Expose window.acpModels for debugging
  if (!window.acpModels) {
    Object.defineProperty(window, 'acpModels', {
      get: () => {
        const providers = window.acpService?.getProviders() || [];
        return providers.map(provider => ({
          name: `acp:${provider.id}`,
          displayName: `${provider.displayName} (ACP)`,
          capabilities: provider.capabilities,
          status: provider.status
        }));
      },
      configurable: true
    });
    window.acpLog?.('INFO', "[ACP] window.acpModels getter installed (for debugging)");
  }

  window.acpLog?.('INFO', "[ACP] model-patch.js loaded successfully");
  window.acpLog?.('INFO', "[ACP] ℹ️  Note: ACP models must be added manually via Settings > Models > Add Custom Model");
  window.acpLog?.('INFO', "[ACP] ℹ️  Use model name format: 'Claude Code (ACP)' or 'acp:claude-code'");

} catch (error) {
  window.acpLog?.('ERROR', "[ACP] FATAL ERROR in model-patch.js:", error);
  window.acpLog?.('ERROR', "[ACP] Stack trace:", error.stack);
}
