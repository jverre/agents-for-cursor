// Model Debug Helper - Exposes ACP model info for debugging
console.log("[ACP] Loading model-patch.js...");

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
    console.log("[ACP] window.acpModels getter installed (for debugging)");
  }

  console.log("[ACP] model-patch.js loaded successfully");
  console.log("[ACP] ℹ️  Note: ACP models must be added manually via Settings > Models > Add Custom Model");
  console.log("[ACP] ℹ️  Use model name format: 'Claude Code (ACP)' or 'acp:claude-code'");

} catch (error) {
  console.error("[ACP] FATAL ERROR in model-patch.js:", error);
  console.error("[ACP] Stack trace:", error.stack);
}
