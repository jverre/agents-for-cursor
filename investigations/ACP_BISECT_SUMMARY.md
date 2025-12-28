# Cursor ACP Binary Search - Summary

## Objective
Determine the exact Cursor version when ACP (Agent Client Protocol) support was introduced.

## Quick 3-Version Check

### Versions to Test
- **2.0** - Major release
- **2.1** - Minor update
- **2.2** - Current major (we know this has ACP)

### Manual Steps

1. **Download Versions**
   ```bash
   # Go to https://cursor.com/download
   # Click on "Previous versions"
   # Download:
   #   - Cursor 2.0
   #   - Cursor 2.1
   #   - Cursor 2.2 (or use current installation)
   ```

2. **Run Check Script**
   ```bash
   # Save DMGs to /tmp/cursor-versions/
   mv ~/Downloads/Cursor-2.0*.dmg /tmp/cursor-versions/cursor-2.0.dmg
   mv ~/Downloads/Cursor-2.1*.dmg /tmp/cursor-versions/cursor-2.1.dmg
   mv ~/Downloads/Cursor-2.2*.dmg /tmp/cursor-versions/cursor-2.2.dmg

   # Run the check
   /tmp/quick_check.sh
   ```

3. **Manual Check (Alternative)**
   ```bash
   # For each version:
   hdiutil attach cursor-X.X.dmg
   cd /Volumes/Cursor/Cursor.app/Contents/Resources/app

   # Check 1: Extension exists?
   ls -la extensions/ | grep agent-exec

   # Check 2: ACP code?
   grep -r "registerAgentExecProvider" . | head -1

   # Check 3: Claude Code?
   grep -r "Anthropic.claude-code" . | head -1

   hdiutil detach /Volumes/Cursor
   ```

## What We're Looking For

### ✅ Version HAS ACP if it contains:

1. **Extension Directory**
   ```
   extensions/cursor-agent-exec/
   ```

2. **Protocol Code**
   ```javascript
   registerAgentExecProvider
   agentExecProviderService
   agentclientprotocol
   ```

3. **Extension Tracking**
   ```javascript
   CLAUDE_EXTENSION_ID = "Anthropic.claude-code"
   ```

### ❌ Version DOESN'T have ACP if:

- No `cursor-agent-exec` extension
- No ACP-related code in workbench
- No Claude Code extension tracking

## Expected Results

### Scenario A: ACP Added in v2.2
```
Version 2.0: ❌ No ACP
Version 2.1: ❌ No ACP
Version 2.2: ✅ Has ACP  ← First version with ACP
```

### Scenario B: ACP Added in v2.1
```
Version 2.0: ❌ No ACP
Version 2.1: ✅ Has ACP  ← First version with ACP
Version 2.2: ✅ Has ACP
```

### Scenario C: ACP Added in v2.0
```
Version 2.0: ✅ Has ACP  ← First version with ACP
Version 2.1: ✅ Has ACP
Version 2.2: ✅ Has ACP
```

## Known Information

**Current Version (2.2.43):**
- Build Date: February 19, 2025
- ✅ Has `cursor-agent-exec` extension
- ✅ Has ACP protocol implementation
- ✅ Tracks Anthropic's Claude Code extension
- ✅ Full infrastructure for local agent execution

**Latest Version (0.45.14):**
- Build Date: February 19, 2025
- Likely same codebase as 2.2.43

## Analysis After Testing

Once you've tested the 3 versions, you'll know:

1. **If v2.0 has no ACP, v2.2 has ACP:**
   - ACP added between 2.0 and 2.2
   - Likely in v2.1 or early v2.2 patch

2. **If v2.1 has no ACP, v2.2 has ACP:**
   - ACP added in v2.2.x
   - Very recent addition (Q4 2024 or Q1 2025)

3. **If all have ACP:**
   - ACP added before v2.0
   - Check v1.7 as well

## Timeline Context

**ACP Protocol:**
- Publicly announced: Late 2024
- Protocol spec published: https://agentclientprotocol.com
- Initial implementations: Zed, Neovim plugins (Fall 2024)

**Cursor Development:**
- Likely tracking ACP development in late 2024
- Implementation probably Q4 2024 - Q1 2025
- Infrastructure ready but not user-facing yet

## Quick Reference Commands

```bash
# Check current installation
ls -la /Applications/Cursor.app/Contents/Resources/app/extensions/ | grep agent

# Check version
cat /Applications/Cursor.app/Contents/Resources/app/package.json | grep version

# Search for ACP code
cd /Applications/Cursor.app/Contents/Resources/app
grep -r "registerAgentExecProvider" . | wc -l

# Check extension package
cat extensions/cursor-agent-exec/package.json
```

## Alternative: Check Git Commits

If Cursor's source was open or if there are leaked build artifacts:

```bash
# Search for first commit with agent-exec
git log --all --oneline --grep="agent.*exec\|ACP"

# Search for file addition
git log --all --diff-filter=A -- '**/cursor-agent-exec/**'

# Search for code addition
git log -S "registerAgentExecProvider" --all
```

## Conclusion

After running the 3-version check, you'll have:
- ✅ Exact version when ACP was introduced
- ✅ Approximate timeline (version release dates)
- ✅ Understanding of development progression

This is much faster than:
- ❌ Checking all minor versions
- ❌ Reading through changelogs
- ❌ Trial and error with features

**Estimated Time:** 15-30 minutes (mostly download time)

## Next Steps After Finding Version

1. Check release notes for that version
2. Look for blog posts or announcements
3. Search Discord/community for discussions
4. Compare extension code between versions
5. Document the evolution of ACP support

---

**Pro Tip:** If downloads are slow, check version 2.1 first. It's likely the pivot point where ACP was added (typical for .1 releases to add major new infrastructure).
