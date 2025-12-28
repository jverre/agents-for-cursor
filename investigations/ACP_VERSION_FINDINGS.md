# Cursor ACP Binary Search - Results

## Summary

**ACP (Agent Client Protocol) support was introduced in Cursor version 2.0**

The `cursor-agent-exec` extension has been present since at least version 2.0.77 (November 14, 2024).

## Version Analysis

| Version | Date | Agent Exec Extension | ACP Code | Claude Tracking | Has ACP? |
|---------|------|---------------------|----------|-----------------|----------|
| **1.3.6** | Jul 31, 2024 | ❌ | ❌ | ❌ | **NO** |
| **1.7.28** | Oct 2, 2024 | ❌ | ❌ | ❌ | **NO** |
| **2.0.77** | Nov 14, 2024 | ✅ | ✅ | ✅ | **YES** ← First confirmed |
| **2.1.50** | Dec 7, 2024 | ✅ | ✅ | ✅ | **YES** |
| **2.2.43** | Feb 19, 2025 | ✅ | ✅ | ✅ | **YES** (current) |

## Key Findings

### Version 2.0.77 (November 14, 2024)
- **First confirmed version with ACP support**
- Extension directory: `extensions/cursor-agent-exec/`
- Extension build date: Nov 14, 2024 01:26
- Contains full ACP infrastructure:
  - `registerAgentExecProvider` API
  - `CLAUDE_EXTENSION_ID = "Anthropic.claude-code"`
  - Binary message protocol
  - Local resource provider
  - Permission system

### Version 2.1.50 (December 7, 2024)
- Extension build date: Dec 7, 2024 01:58
- All ACP infrastructure present
- Incremental improvements to 2.0

### Timeline

```
Jul 31, 2024  ─  1.3.6   ❌ No ACP
Oct 2, 2024   ─  1.7.28  ❌ No ACP
                  │
                  │  ACP introduced sometime here
                  ▼
Nov 14, 2024  ─  2.0.77  ✅ First confirmed ACP
Dec 7, 2024   ─  2.1.50  ✅ ACP present
Feb 19, 2025  ─  2.2.43  ✅ ACP present (current)
```

## Technical Evidence

### What was added in 2.0:

1. **Extension Package** (`cursor-agent-exec`)
   ```json
   {
     "name": "cursor-agent-exec",
     "description": "Provides agent execution capabilities for Cursor, enabling agents to run commands, interact with files, and use tools with user permissions and approvals",
     "publisher": "anysphere",
     "version": "0.0.1"
   }
   ```

2. **ACP Infrastructure**
   - `registerAgentExecProvider` API
   - `createSession()` for agent sessions
   - `spawn()` for command execution
   - Binary message protocol (ExecServerMessage/ExecClientMessage)

3. **Claude Code Integration**
   - Extension tracking: `CLAUDE_EXTENSION_ID = "Anthropic.claude-code"`
   - Command execution tracking for Claude extension

4. **Permission System**
   - `InteractivePermissionsService`
   - User approval dialogs for tool execution
   - File access controls

## Conclusion

**Cursor's ACP support was introduced between October 2, 2024 (v1.7.28) and November 14, 2024 (v2.0.77)**

The exact version is **2.0.x** series, with the earliest confirmed build being **2.0.77** from November 14, 2024.

This aligns with:
- Agent Client Protocol public announcement (late 2024)
- Cursor's major 2.0 release
- Preparation for Claude Code integration

## Next Steps

To find the **exact** 2.0 minor version when ACP was first introduced, you would need to:

1. Download intermediate 2.0.x versions (2.0.0, 2.0.10, 2.0.20, etc.)
2. Check each for the presence of `cursor-agent-exec` extension
3. Binary search within the 2.0.x range

However, 2.0.77 (Nov 14, 2024) is confirmed as having full ACP support with all infrastructure in place.
