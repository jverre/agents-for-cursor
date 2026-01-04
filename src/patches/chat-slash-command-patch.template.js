// Chat Slash Command Service Patch Template
// This template patches ChatSlashCommandService.getCommands to inject ACP commands
// Placeholders: {{ORIGINAL_BODY}} will be replaced with the original function body

getCommands(e,t){
  const _origCmds = {{ORIGINAL_BODY}};
  /* ACP SLASH COMMANDS */
  try {
    const _acpCmds = window.acpService?.getSlashCommands?.("claude-code") || [];
    if (_acpCmds.length > 0) {
      console.log("[ACP] Injecting", _acpCmds.length, "slash commands into ChatSlashCommandService");
      const _mapped = _acpCmds.map(_c => ({
        command: _c.name.startsWith('/') ? _c.name.slice(1) : _c.name,
        detail: _c.description || "",
        sortText: "acp_" + _c.name,
        executeImmediately: false,
        locations: [e],
        modes: [t]
      }));
      return [..._mapped, ..._origCmds];
    }
  } catch(_e) {
    console.error("[ACP] Error injecting slash commands:", _e);
  }
  return _origCmds;
}
