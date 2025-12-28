# Cursor ACP Binary Search Guide

## Goal
Find the exact Cursor version when ACP (Agent Client Protocol) support was added.

## Current Known Information

**Current Version:** 2.2.43
- ✅ Has `cursor-agent-exec` extension
- ✅ Has ACP protocol code
- ✅ Tracks `Anthropic.claude-code` extension
- **Build Date:** 2025-02-19

**Available Versions:**
- Latest: 0.45.14 (2025-02-19)
- 2.2
- 2.1
- 2.0
- 1.7

## Binary Search Strategy

### Step 1: Test Oldest Version (1.7)

**Download:**
1. Go to https://cursor.com/download
2. Find "Previous versions" section
3. Download version 1.7

**Check for ACP:**
```bash
# Mount the DMG
hdiutil attach Cursor-1.7.dmg

# Copy app
cp -R /Volumes/Cursor/Cursor.app /tmp/cursor-1.7-test/

# Unmount
hdiutil detach /Volumes/Cursor

# Check for ACP indicators
cd /tmp/cursor-1.7-test/Cursor.app/Contents/Resources/app

# Test 1: Agent exec extension?
ls -la extensions/ | grep agent-exec

# Test 2: ACP code?
grep -r "agentclientprotocol\|registerAgentExecProvider" . 2>/dev/null | head -5

# Test 3: Claude Code tracking?
grep -r "Anthropic.claude-code\|CLAUDE_EXTENSION_ID" . 2>/dev/null | head -5
```

**Results:**
- [ ] Has cursor-agent-exec extension
- [ ] Has ACP protocol code
- [ ] Has Claude Code tracking

### Step 2: Test Middle Version (2.0 or 2.1)

Based on Step 1 results:
- If 1.7 has ACP: Test an earlier version (if available)
- If 1.7 doesn't have ACP: Test 2.0

**Repeat same checks as Step 1**

### Step 3: Narrow Down

Continue binary search:

**Scenario A:** If 1.7 has no ACP, but 2.0 has ACP:
- Test versions between 1.7 and 2.0 (need minor versions)

**Scenario B:** If 2.0 has no ACP, but 2.1 has ACP:
- Test versions between 2.0 and 2.1

**Scenario C:** If 2.1 has no ACP, but 2.2 has ACP:
- Test versions between 2.1 and 2.2

## Quick Check Script

Save this as `check_cursor_version.sh`:

```bash
#!/bin/bash

if [ -z "$1" ]; then
    echo "Usage: $0 <path-to-Cursor.app>"
    exit 1
fi

APP_PATH="$1"
RESOURCES="$APP_PATH/Contents/Resources/app"

echo "=== Checking Cursor for ACP Support ==="
echo ""

# Get version
if [ -f "$RESOURCES/package.json" ]; then
    VERSION=$(cat "$RESOURCES/package.json" | grep '"version"' | head -1 | cut -d'"' -f4)
    echo "Version: $VERSION"
else
    echo "Could not find package.json"
fi

echo ""
echo "=== Test 1: cursor-agent-exec extension ==="
if [ -d "$RESOURCES/extensions/cursor-agent-exec" ]; then
    echo "✅ FOUND: cursor-agent-exec extension exists"
    echo "   Path: $RESOURCES/extensions/cursor-agent-exec"
else
    echo "❌ NOT FOUND: cursor-agent-exec extension"
fi

echo ""
echo "=== Test 2: ACP Protocol Code ==="
ACP_MATCHES=$(grep -r "agentclientprotocol\|registerAgentExecProvider\|AgentExecProvider" "$RESOURCES" 2>/dev/null | wc -l)
if [ "$ACP_MATCHES" -gt 0 ]; then
    echo "✅ FOUND: ACP protocol code ($ACP_MATCHES occurrences)"
    echo "   Sample:"
    grep -r "registerAgentExecProvider" "$RESOURCES" 2>/dev/null | head -1
else
    echo "❌ NOT FOUND: ACP protocol code"
fi

echo ""
echo "=== Test 3: Claude Code Extension Tracking ==="
CLAUDE_MATCHES=$(grep -r "Anthropic.claude-code\|CLAUDE_EXTENSION_ID" "$RESOURCES" 2>/dev/null | wc -l)
if [ "$CLAUDE_MATCHES" -gt 0 ]; then
    echo "✅ FOUND: Claude Code tracking ($CLAUDE_MATCHES occurrences)"
    echo "   Sample:"
    grep -r "CLAUDE_EXTENSION_ID" "$RESOURCES" 2>/dev/null | head -1
else
    echo "❌ NOT FOUND: Claude Code tracking"
fi

echo ""
echo "=== Test 4: MCP Support (for comparison) ==="
if [ -d "$RESOURCES/extensions/cursor-mcp" ]; then
    echo "✅ FOUND: MCP extension exists"
else
    echo "❌ NOT FOUND: MCP extension"
fi

echo ""
echo "=== Summary ==="
if [ -d "$RESOURCES/extensions/cursor-agent-exec" ] || [ "$ACP_MATCHES" -gt 0 ]; then
    echo "🎯 This version HAS ACP support!"
else
    echo "⭕ This version does NOT have ACP support"
fi
```

Usage:
```bash
chmod +x check_cursor_version.sh
./check_cursor_version.sh /Applications/Cursor.app
```

## Alternative: Check Release Notes

Instead of downloading multiple versions, check Cursor's release notes:

1. Go to https://cursor.com/releases or https://changelog.cursor.com
2. Search for keywords:
   - "agent exec"
   - "ACP"
   - "Agent Client Protocol"
   - "Claude Code"
   - "third-party agents"
   - "local agent execution"

## Expected Timeline (Speculation)

Based on typical development timelines:

**Most Likely Scenario:**
- **Version 2.1 or 2.2** (Late 2024 - Early 2025)
  - ACP was announced/standardized in late 2024
  - Cursor would adopt shortly after
  - Current version (2.2.43 from Feb 2025) definitely has it

**Less Likely:**
- Version 2.0 (too early?)
- Version 1.x (very unlikely)

## Quick Test Results Template

```
| Version | Agent Exec Ext | ACP Code | Claude Tracking | Has ACP? |
|---------|---------------|----------|-----------------|----------|
| 1.7     | ❌            | ❌       | ❌              | NO       |
| 2.0     | ?             | ?        | ?               | ?        |
| 2.1     | ?             | ?        | ?               | ?        |
| 2.2     | ✅            | ✅       | ✅              | YES      |
| 2.2.43  | ✅            | ✅       | ✅              | YES      |
```

## What to Look For in Each Version

### Definitive Indicators (Strong Evidence):

1. **Extension Exists:**
   ```
   extensions/cursor-agent-exec/
   ```

2. **Code References:**
   ```javascript
   registerAgentExecProvider
   agentExecProviderService
   cursor.registerAgentExecProvider
   ```

3. **Extension Tracking:**
   ```javascript
   CLAUDE_EXTENSION_ID = "Anthropic.claude-code"
   ```

### Supporting Indicators (Weaker Evidence):

1. MCP integration (related but not ACP)
2. Agent mode improvements
3. Subprocess execution infrastructure

## Commands Cheat Sheet

```bash
# Download version from Cursor website
open https://cursor.com/download

# Extract and check
hdiutil attach Cursor-X.X.dmg
cp -R /Volumes/Cursor/Cursor.app /tmp/test/
hdiutil detach /Volumes/Cursor

# Quick search
cd /tmp/test/Cursor.app/Contents/Resources/app
ls extensions/ | grep agent
grep -r "registerAgentExecProvider" . | head -3

# Check version
cat package.json | grep version

# Cleanup
rm -rf /tmp/test
```

## Next Steps After Finding Version

Once you find the exact version:

1. **Check Release Notes** for that version
2. **Compare Extensions** between versions
3. **Analyze Code Diff** if possible
4. **Document Changes** in infrastructure
5. **Look for Blog Posts** or announcements

## Conclusion

The binary search approach will quickly narrow down:
- **~4 version checks** worst case (if testing 1.7, 2.0, 2.1, 2.2)
- **~2-3 version checks** likely case

This is much faster than testing every minor version!
