// Cursor Commands Service Patch Template
// This template patches cursorCommandsService.getCommands to inject ACP commands
// Placeholders: {{ORIGINAL_BODY}} will be replaced with the original Map building code

getCommands(){
  const i=new Map;
  {{ORIGINAL_BODY}}
  /* ACP SLASH COMMANDS */
  try {
    const _acpCmds = window.acpService?.getSlashCommands?.("claude-code") || [];
    if (_acpCmds.length > 0) {
      console.log("[ACP] Injecting", _acpCmds.length, "slash commands into cursorCommandsService");
      for (const _c of _acpCmds) {
        const _cmdName = _c.name.startsWith('/') ? _c.name.slice(1) : _c.name;
        i.set(_cmdName, {
          filename: _cmdName,
          content: _c.description || _c.name,
          isACP: true
        });
      }
    }
  } catch(_e) {
    console.error("[ACP] Error injecting slash commands:", _e);
  }
  return i;
}
