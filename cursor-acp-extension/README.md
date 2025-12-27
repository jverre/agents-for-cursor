# Cursor ACP Extension

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
