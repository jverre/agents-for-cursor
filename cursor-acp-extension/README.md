# Cursor ACP Extension

[![Test ACP Extension](https://github.com/jverre/opencursor/actions/workflows/test-acp-extension.yml/badge.svg)](https://github.com/jverre/opencursor/actions/workflows/test-acp-extension.yml)

Integrates Agent Client Protocol (ACP) providers into Cursor.

## Installation

1. Open this folder in Cursor
2. Press F5 to launch Extension Development Host
3. In the new window, run `ACP: Enable` from command palette
4. Restart Cursor

## Commands

- `ACP: Enable` - Enable ACP integration
- `ACP: Disable` - Disable ACP integration
- `ACP: Reload` - Reload ACP patches

## Configuration

Create `~/.cursor/acp-providers.json`:

```json
{
  "acpProviders": {
    "my-agent": {
      "displayName": "My ACP Agent",
      "type": "stdio",
      "command": "/path/to/agent",
      "args": ["--stdio"],
      "capabilities": {
        "supportsAgent": true,
        "supportsImages": false
      }
    }
  }
}
```

## Testing

This extension includes a comprehensive testing framework with unit, integration, and end-to-end tests.

### Quick Start

```bash
# Install dependencies
npm install

# Run all tests
npm test

# Run specific test suites
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests
npm run test:e2e          # E2E tests (requires Cursor)

# Download Cursor for E2E tests
npm run download-cursor
```

### Test Structure

- **Unit Tests** (`tests/unit/`) - Test individual modules (patcher, checksum-fixer)
- **Integration Tests** (`tests/integration/`) - Test HTTP server and JSON-RPC protocol
- **E2E Tests** (`tests/e2e/`) - Full workflow testing with real Cursor instance

### CI/CD

E2E tests run automatically on every pull request via GitHub Actions:
- ✅ Full end-to-end workflow testing on Ubuntu
- ✅ Real Claude Code ACP agent integration
- ✅ Automated Cursor installation and patching validation

See [tests/README.md](tests/README.md) for detailed testing documentation.

## Development

### Project Structure

```
cursor-acp-extension/
├── extension.js           # Main extension entry point
├── patcher.js            # Workbench patching logic
├── checksum-fixer.js     # Checksum calculation & updates
├── patches/              # Code injected into Cursor
│   ├── acp-service.js
│   ├── extension-bridge.js
│   └── ...
└── tests/                # Test framework
    ├── unit/
    ├── integration/
    ├── e2e/
    └── helpers/
```

### Contributing

1. Make changes to the extension code
2. Run tests locally: `npm test`
3. Ensure all tests pass
4. Create a pull request
5. CI will automatically run tests on your PR

## Troubleshooting

### Tests Failing

- Check test logs in CI artifacts
- Run tests locally with `npm test`
- See [tests/README.md](tests/README.md) for debugging tips

### Extension Not Working

1. Check if Cursor is installed at the expected path
2. Verify patches are applied: `ACP: Enable`
3. Restart Cursor after enabling
4. Check for errors in Developer Tools console
