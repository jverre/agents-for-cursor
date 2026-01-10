# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a VS Code/Cursor extension that integrates Claude Code (ACP - Agent Client Protocol) into Cursor IDE. It patches Cursor's internal workbench files to add a custom "Claude Code (ACP)" model option that routes chat messages to a local Claude Code agent subprocess.

## Key Architecture

- **`src/extension.js`** - Main extension entry point. Runs an HTTP server on port 37842 and manages ACP agent subprocesses.
- **`src/patcher.js`** - Patches Cursor's workbench files to inject ACP integration. Uses `vscode.env.appRoot` to find files.
- **`src/patches/`** - JavaScript patch files that get injected into Cursor's workbench.

## Running Tests Locally

### Quick Start

```bash
# Run e2e tests with isolated Cursor installation
npm run test:e2e:local
```

This command:
1. Downloads and installs Cursor to `~/.cursor-test-installation/` (cached, only downloads once)
2. Extracts auth tokens from your main Cursor installation automatically
3. Applies extension patches via the "Agents for Cursor: Enable" command
4. Runs the e2e test suite
5. Your main `/Applications/Cursor.app` is never touched

### Available Commands

| Command | Description |
|---------|-------------|
| `npm run start` | Launch isolated Cursor for manual testing (applies patches, keeps running) |
| `npm run test:e2e:local` | Run e2e tests using isolated Cursor (recommended for development) |
| `npm run test:e2e` | Run e2e tests using system Cursor (used in CI) |
| `npm run setup:check` | Check if isolated Cursor is installed |
| `npm run download-cursor` | Download Cursor installer to cache |

### How It Works

```
~/.cursor-test-installation/     <- Isolated Cursor for testing
~/.cursor-test-cache/            <- Cached Cursor downloads
tests/e2e-user-data/             <- Test user data directory (cleaned each run)
```

The test setup:
1. Checks if isolated Cursor exists, installs if not
2. Copies auth tokens from your main Cursor (`~/Library/Application Support/Cursor/`)
3. Launches Cursor with the extension in development mode
4. Runs "Agents for Cursor: Enable" command to apply patches
5. Restarts Cursor and runs tests

### Environment Variables

- `LOCAL=true` - Use isolated installation (set automatically by `test:e2e:local`)
- `CI=true` - CI mode, expects pre-installed Cursor
- `CURSOR_AUTH_TOKEN` - Override auth token (optional, extracted automatically in local mode)
- `CURSOR_EMAIL` - Override email (optional)

## Common Development Tasks

### Testing patch changes

After modifying files in `src/patches/`, just run:
```bash
npm run test:e2e:local
```

The test setup automatically re-applies patches each run (disable + enable).

### Debugging test failures

Screenshots are saved to `tests/screenshots/` during test runs. Check these for visual debugging.

Logs are saved to `tests/logs/`.

### ACP Logs

All ACP activity is logged to `~/.cursor-acp.log`. This includes both extension-side and renderer-side logs.

```bash
# Watch logs in real-time during manual testing
tail -f ~/.cursor-acp.log
```

In tests, use:
```javascript
cursor.clearAcpLogs();       // Clear before test
// ... run test ...
const logs = cursor.getAcpLogs();  // Read logs for assertions
```

## Implementing New Tool Bubbles

When adding support for a new tool type (e.g., file edit, terminal command), follow this process:

### 1. Log Cursor's expected format

Add logs to `src/patches/chat-interception.js` to capture what Cursor sends when using the **Auto model** (not ACP). This shows the exact data format Cursor expects.

### 2. Run a prompt with Auto model

Write a quick Playwright script or test to trigger the tool call with Auto model, then review `~/.cursor-acp.log`:

```javascript
// tmp-debug.js - Quick debugging script
await cursor.selectModel('Auto', 'debug');
await cursor.sendChatMessage('Edit the file test.txt and add a line');
// Check logs to see Cursor's internal data format
```

### 3. Write a test with Claude Code (ACP)

Now write a proper test using Claude Code that triggers the same tool call. Verify the UI component appears:

```javascript
await cursor.selectModel('Claude Code (ACP)', 'test');
await cursor.sendChatMessage('Edit the file...');
// Assert tool bubble exists with expected selectors
```

### 4. Log ACP's data format

Add logs to understand what ACP sends back (in `onToolCall` callback). Compare with step 1.

### 5. Hardcode to verify

In `chat-interception.js`, hardcode the exact data format from step 1 to confirm everything works end-to-end.

### 6. Replace with ACP data

Gradually replace hardcoded values with actual ACP data, testing each change.

**Golden rule: When something is wrong, add more logs first.** You can never have too many logs when debugging.

### Packaging the extension

```bash
npm run package
```

Creates a `.vsix` file for distribution.
