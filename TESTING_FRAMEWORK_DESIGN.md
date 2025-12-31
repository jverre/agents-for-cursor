# Testing Framework Design for Cursor ACP Extension

## Overview

This document outlines the comprehensive testing framework for the Cursor ACP Extension, enabling automated end-to-end testing of the cursor patching process.

## Goals

1. **Automated Cursor Installation** - Download and install the latest Cursor version
2. **Extension Deployment** - Package and install the ACP extension
3. **UI Automation** - Launch Cursor, interact with chat interface
4. **Response Verification** - Validate ACP agent responses
5. **Continuous Integration** - Enable CI/CD pipeline testing

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Test Runner                            │
│  - Downloads Cursor                                         │
│  - Installs Extension                                       │
│  - Launches Cursor with Playwright                          │
│  - Runs Test Suites                                         │
└────────────┬────────────────────────────────────────────────┘
             │
    ┌────────┴─────────┬──────────────┬─────────────────┐
    │                  │              │                 │
    ▼                  ▼              ▼                 ▼
┌─────────┐   ┌──────────────┐  ┌────────┐   ┌────────────┐
│  Unit   │   │ Integration  │  │  E2E   │   │ Regression │
│  Tests  │   │    Tests     │  │ Tests  │   │   Tests    │
└─────────┘   └──────────────┘  └────────┘   └────────────┘
```

## Technology Stack

### Core Testing Tools

| Tool | Purpose | Rationale |
|------|---------|-----------|
| **Playwright** | Electron UI automation | Best-in-class Electron support, cross-platform |
| **Jest** | Test runner & assertions | Industry standard, great VS Code integration |
| **@vscode/test-electron** | Extension testing | Official VS Code extension test harness |
| **node-fetch** | HTTP testing | Test extension HTTP server (port 37842) |
| **mock-spawn** | Process mocking | Mock ACP agent subprocesses |

### Utility Libraries

| Tool | Purpose |
|------|---------|
| **download** | Download latest Cursor release |
| **extract-zip** / **tar** | Extract Cursor installers |
| **tree-kill** | Clean process shutdown |
| **wait-on** | Wait for HTTP server startup |

## Test Levels

### 1. Unit Tests

**Scope:** Individual functions and modules

**Files to test:**
- `patcher.js` - Patch application logic
- `checksum-fixer.js` - Checksum calculation
- `extension.js` - HTTP server, command handlers
- `patches/acp-service.js` - Provider management

**Example test:**
```javascript
describe('Patcher', () => {
  test('creates backup before patching', async () => {
    const patcher = new Patcher('/mock/path');
    await patcher.applyPatches();
    expect(fs.existsSync('/mock/path/workbench.js.backup')).toBe(true);
  });

  test('does not double-patch already patched files', async () => {
    const patcher = new Patcher('/mock/path');
    await patcher.applyPatches();
    const result = await patcher.applyPatches();
    expect(result.alreadyPatched).toBe(true);
  });
});
```

### 2. Integration Tests

**Scope:** Extension functionality with mocked Cursor

**Tests:**
- Command execution (`acp.enable`, `acp.disable`, `acp.reload`)
- HTTP server message handling
- JSON-RPC protocol implementation
- Patch application and restoration

**Example test:**
```javascript
describe('Extension Integration', () => {
  test('HTTP server handles ACP messages', async () => {
    await vscode.commands.executeCommand('acp.enable');

    const response = await fetch('http://localhost:37842/acp/sendMessage', {
      method: 'POST',
      body: JSON.stringify({
        provider: { id: 'claude-code', command: 'mock-agent' },
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });

    const data = await response.json();
    expect(data.choices[0].message.content).toBeDefined();
  });
});
```

### 3. End-to-End Tests

**Scope:** Full workflow with real Cursor instance

**Test scenarios:**
1. **Fresh Install Test**
   - Download Cursor
   - Install extension
   - Launch Cursor
   - Verify UI elements

2. **Patching Test**
   - Execute `acp.enable` command
   - Verify files patched
   - Verify checksums updated
   - Restart Cursor
   - Check for errors

3. **Chat Interaction Test**
   - Open Cursor chat
   - Select ACP model (e.g., `acp:claude-code`)
   - Send message
   - Verify response
   - Check agent subprocess launched

4. **Unpatch Test**
   - Execute `acp.disable`
   - Verify backups restored
   - Verify no errors

**Example test:**
```javascript
describe('E2E: Chat Interaction', () => {
  let cursorApp, page;

  beforeAll(async () => {
    const { electronApp } = await launchCursor({
      extensionDevelopmentPath: __dirname + '/../cursor-acp-extension'
    });
    cursorApp = electronApp;
    page = await electronApp.firstWindow();
  });

  test('can send chat message and receive ACP response', async () => {
    // Open command palette
    await page.keyboard.press('Meta+Shift+P');

    // Enable ACP
    await page.fill('[placeholder="Type a command"]', 'ACP: Enable');
    await page.keyboard.press('Enter');

    // Wait for patch completion
    await page.waitForSelector('text=ACP enabled successfully');

    // Restart Cursor (click notification button)
    await page.click('text=Restart Now');

    // Wait for restart
    await page.waitForLoadState('domcontentloaded');

    // Open chat interface
    await page.click('[aria-label="Open Chat"]');

    // Select ACP model from dropdown
    await page.click('[data-testid="model-selector"]');
    await page.click('text=acp:claude-code');

    // Type message
    await page.fill('[placeholder="Ask a question..."]', 'Hello, can you help me?');
    await page.keyboard.press('Enter');

    // Wait for response
    const response = await page.waitForSelector('.chat-message.assistant', {
      timeout: 30000
    });

    const responseText = await response.textContent();
    expect(responseText).toBeTruthy();
    expect(responseText.length).toBeGreaterThan(0);
  });

  afterAll(async () => {
    await cursorApp.close();
  });
});
```

### 4. Regression Tests

**Scope:** Ensure fixes don't break existing functionality

**Tests:**
- Verify old patches still work after changes
- Test backup restoration after multiple patch cycles
- Verify checksum calculation consistency
- Test with different Cursor versions

## Test File Structure

```
cursor-acp-extension/
├── tests/
│   ├── unit/
│   │   ├── patcher.test.js
│   │   ├── checksum-fixer.test.js
│   │   ├── extension.test.js
│   │   └── acp-service.test.js
│   │
│   ├── integration/
│   │   ├── commands.test.js
│   │   ├── http-server.test.js
│   │   └── jsonrpc.test.js
│   │
│   ├── e2e/
│   │   ├── install.test.js
│   │   ├── patching.test.js
│   │   ├── chat-interaction.test.js
│   │   └── unpatch.test.js
│   │
│   ├── fixtures/
│   │   ├── mock-workbench.js
│   │   ├── mock-product.json
│   │   └── mock-agent.js
│   │
│   └── helpers/
│       ├── cursor-installer.js      # Downloads/installs Cursor
│       ├── playwright-helpers.js    # Cursor launch & control
│       ├── mock-acp-agent.js        # Mock ACP agent for testing
│       └── test-utils.js            # Shared utilities
│
├── jest.config.js
├── playwright.config.js
└── package.json (updated with test dependencies)
```

## Implementation Plan

### Phase 1: Setup & Infrastructure (Utility Scripts)

1. **Install test dependencies**
   ```bash
   npm install --save-dev jest @playwright/test @vscode/test-electron
   npm install --save-dev node-fetch wait-on tree-kill
   npm install --save-dev download extract-zip
   ```

2. **Create Cursor installer helper**
   - `tests/helpers/cursor-installer.js`
   - Functions: `downloadCursor()`, `installCursor()`, `getCursorPath()`
   - Platform detection (macOS, Linux, Windows)
   - Version checking

3. **Create Playwright helper**
   - `tests/helpers/playwright-helpers.js`
   - Functions: `launchCursor()`, `installExtension()`, `waitForExtension()`
   - Electron app configuration

### Phase 2: Unit Tests

4. **Write unit tests for core modules**
   - Test patching logic
   - Test checksum calculation
   - Test HTTP server handlers
   - Test provider management

### Phase 3: Integration Tests

5. **Write integration tests**
   - Test extension commands
   - Test HTTP/JSON-RPC communication
   - Mock ACP agents for predictable responses

### Phase 4: E2E Tests

6. **Write E2E tests**
   - Full installation workflow
   - Patching verification
   - Chat interaction
   - UI element verification

### Phase 5: CI/CD Integration

7. **Setup GitHub Actions**
   - Matrix testing (multiple OS)
   - Automated Cursor download
   - Artifact storage (screenshots, logs)
   - Test result reporting

## Cursor Installation Strategy

### Download Sources

| Platform | URL Pattern |
|----------|-------------|
| macOS | `https://downloader.cursor.sh/builds/latest/mac/dmg/x64` |
| Linux | `https://downloader.cursor.sh/builds/latest/linux/appImage/x64` |
| Windows | `https://downloader.cursor.sh/builds/latest/windows/nsis/x64` |

### Installation Steps

**macOS:**
```bash
1. Download .dmg file
2. Mount DMG: hdiutil attach cursor.dmg
3. Copy to /Applications: cp -R /Volumes/Cursor/Cursor.app /Applications/
4. Unmount: hdiutil detach /Volumes/Cursor
```

**Linux:**
```bash
1. Download .AppImage file
2. Make executable: chmod +x Cursor.AppImage
3. Optional: Extract for testing
```

**Windows:**
```bash
1. Download .exe installer
2. Silent install: cursor-setup.exe /S
3. Wait for completion
```

### Version Management

Cache downloaded versions to avoid re-downloading:
```
~/.cursor-test-cache/
├── cursor-0.42.3-mac.dmg
├── cursor-0.42.3-linux.AppImage
└── cursor-0.42.3-win.exe
```

## Mock ACP Agent

For reliable testing, implement a mock ACP agent:

```javascript
// tests/helpers/mock-acp-agent.js
class MockACPAgent {
  async handleInitialize(params) {
    return {
      protocolVersion: "1.0",
      serverInfo: { name: "mock-agent", version: "1.0.0" },
      capabilities: { supportsAgent: true }
    };
  }

  async handleSessionNew(params) {
    return { sessionId: "mock-session-123" };
  }

  async handleSessionPrompt(params) {
    // Return predictable response for testing
    return {
      content: [{ type: "text", text: "Mock response to: " + params.prompt }],
      stopReason: "end_turn"
    };
  }
}
```

Register as command: `node tests/helpers/mock-acp-agent.js`

## Test Data & Fixtures

### Mock Workbench Files

Create minimal versions for unit testing:
- `tests/fixtures/mock-workbench.js` (15KB instead of 27MB)
- Contains only `submitChatMaybeAbortCurrent` function

### Mock Product.json

```json
{
  "checksums": {
    "vs/code/electron-sandbox/workbench/workbench.js": "original-checksum",
    "vs/workbench/workbench.desktop.main.js": "original-checksum"
  }
}
```

## Test Execution

### Run all tests
```bash
npm test
```

### Run specific test suites
```bash
npm run test:unit          # Unit tests only
npm run test:integration   # Integration tests only
npm run test:e2e          # E2E tests only
npm run test:watch        # Watch mode for development
```

### CI execution
```bash
npm run test:ci           # All tests with coverage report
```

## Success Criteria

### Unit Tests
- ✅ 90%+ code coverage for core modules
- ✅ All edge cases tested (double-patching, missing files, etc.)
- ✅ Fast execution (< 5 seconds total)

### Integration Tests
- ✅ Extension commands work correctly
- ✅ HTTP server handles all message types
- ✅ JSON-RPC protocol implementation verified
- ✅ Execution time < 30 seconds

### E2E Tests
- ✅ Fresh Cursor installation succeeds
- ✅ Extension patches files correctly
- ✅ Chat messages route to ACP agents
- ✅ Responses display in UI
- ✅ Unpatch restores original state
- ✅ Execution time < 5 minutes per test

## CI/CD Pipeline

### GitHub Actions Workflow

```yaml
name: Test Cursor ACP Extension

on: [push, pull_request]

jobs:
  test:
    runs-on: ${{ matrix.os }}
    strategy:
      matrix:
        os: [macos-latest, ubuntu-latest, windows-latest]

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Run unit tests
        run: npm run test:unit

      - name: Run integration tests
        run: npm run test:integration

      - name: Download Cursor
        run: npm run download-cursor

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Upload artifacts
        if: failure()
        uses: actions/upload-artifact@v3
        with:
          name: test-artifacts-${{ matrix.os }}
          path: |
            tests/screenshots/
            tests/logs/
```

## Debugging & Troubleshooting

### Enable verbose logging
```bash
DEBUG=* npm test
```

### Save screenshots on failure
```javascript
test('chat interaction', async () => {
  try {
    // test code
  } catch (error) {
    await page.screenshot({ path: 'tests/screenshots/failure.png' });
    throw error;
  }
});
```

### Access Cursor DevTools
```javascript
const page = await electronApp.firstWindow();
await page.evaluate(() => {
  require('electron').remote.getCurrentWindow().webContents.openDevTools();
});
```

## Future Enhancements

1. **Visual Regression Testing** - Screenshot comparison with Percy/Applitools
2. **Performance Testing** - Measure patch application time
3. **Load Testing** - Multiple concurrent ACP agents
4. **Mutation Testing** - Verify test suite quality with Stryker
5. **Chaos Testing** - Network failures, process crashes

## References

- [Playwright Electron Testing](https://playwright.dev/docs/api/class-electron)
- [VS Code Extension Testing](https://code.visualstudio.com/api/working-with-extensions/testing-extension)
- [Jest Documentation](https://jestjs.io/docs/getting-started)
- [ACP Protocol Specification](./investigations/ACP_INTEGRATION.md)

## Next Steps

1. Review and approve this design
2. Implement Phase 1 (infrastructure)
3. Add tests incrementally
4. Setup CI/CD pipeline
5. Document test writing guidelines
