// Async Cursor Commands Service Patch Template
// This template patches the async getCommands() used by the composer dropdown
// Placeholders: {{ORIGINAL_BODY}} will be replaced with the original function body
// Note: ACP commands are marked with isACP:true and filtered at the call site based on model

async getCommands(){
  const _origCmds = {{ORIGINAL_BODY}};
  /* ACP SLASH COMMANDS */
  try {
    let _acpCmds = window.acpService?.getSlashCommands?.("claude-code") || [];
    // Lazy-load: if no commands cached, try to init session
    if (_acpCmds.length === 0 && window.acpService?.initSession) {
      try {
        _acpCmds = await window.acpService.initSession("claude-code") || [];
      } catch(_initErr) {
        console.warn("[ACP] Lazy init failed:", _initErr.message);
      }
    }
    if (_acpCmds.length > 0) {
      const _mapped = _acpCmds.map(_c => ({
        filename: _c.name.startsWith('/') ? _c.name.slice(1) : _c.name,
        content: _c.description || _c.name,
        isACP: true
      }));
      return [..._mapped, ..._origCmds];
    }
  } catch(_e) {
    console.error("[ACP] Error injecting slash commands:", _e);
  }
  return _origCmds;
}
