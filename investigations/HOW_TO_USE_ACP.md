# How to Use ACP (Agent Client Protocol) in Cursor

## Current Status ⚠️

**Important:** ACP integration in Cursor is **NOT YET PUBLICLY AVAILABLE** for end users. The infrastructure exists in the code, but it's not exposed through the UI or settings.

**What exists:**
- ✅ Backend infrastructure (`cursor-agent-exec` extension)
- ✅ Protocol implementation
- ✅ Resource providers (file system, terminal, etc.)
- ✅ Support for Claude Code extension tracking

**What's missing:**
- ❌ No UI to enable/configure ACP agents
- ❌ No settings in Cursor preferences
- ❌ No official documentation from Cursor team
- ❌ No marketplace for ACP agents

## How It WILL Work (When Available)

Based on the code analysis and ACP standard, here's how it should work once enabled:

### Step 1: Install an ACP Agent

**Available ACP Agents:**
- **Claude Code** (Anthropic) - Cursor already tracks this: `Anthropic.claude-code`
- **Goose** - Open-source agent
- **OpenHands** - Multi-agent system
- **Codex CLI** - OpenAI agent
- **Gemini CLI** - Google agent
- Many others listed at https://agentclientprotocol.com/overview/agents

**Installation (typical pattern):**
```bash
# Example: Installing an ACP agent (hypothetical)
npm install -g @your-agent/cli

# Or via extension marketplace (when available)
# Cursor → Extensions → Search "ACP Agent"
```

### Step 2: Configure Cursor to Use the Agent

**Expected Settings (not currently available):**
```json
{
  "cursor.agent.enabled": true,
  "cursor.agent.provider": "claude-code",
  "cursor.agent.executablePath": "/path/to/claude-code-agent",
  "cursor.agent.args": ["--stdio"],
  "cursor.agent.capabilities": {
    "fileSystem": true,
    "terminal": true,
    "mcp": true
  }
}
```

### Step 3: Start a Session

**Expected workflow:**

1. **Open Cursor Composer**
2. **Select Agent Mode** (instead of Chat mode)
3. **Choose your ACP agent** from dropdown
4. **Start conversing**

The agent would run locally as a subprocess and communicate via stdin/stdout.

## What You CAN Do Now (Workarounds)

### Option 1: Use Cursor's Built-in Agent System

Cursor already has a powerful agent system (not ACP-based):

```
1. Open Composer (Cmd/Ctrl + I)
2. Enable "Agent" mode
3. Use @ to add context
4. Use / for commands
5. Cursor's proprietary agent system will:
   - Read files
   - Make edits
   - Run terminal commands
   - Search codebase
```

### Option 2: Build Your Own Integration (Advanced)

If you're a developer, you can theoretically:

**1. Create an Extension**

```typescript
// my-acp-bridge/extension.ts
import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
    // Register with cursor.registerAgentExecProvider
    const provider = {
        spawn: async (command, options) => {
            // Launch your ACP agent subprocess
            const agent = spawn('your-agent', ['--stdio'], options);
            return agent;
        },

        createSession: async (sessionId, handlers, options) => {
            // Create ACP session
            return {
                createStream: async (metadata, request, signal) => {
                    // Handle ACP message protocol
                }
            };
        }
    };

    // This API likely isn't exposed yet
    // vscode.cursor.registerAgentExecProvider(provider);
}
```

**2. Use MCP Instead**

Cursor DOES support **MCP (Model Context Protocol)**, which is similar:

```json
// .cursor/mcp.json
{
  "mcpServers": {
    "my-server": {
      "command": "node",
      "args": ["/path/to/mcp-server.js"],
      "env": {}
    }
  }
}
```

Then access via:
1. Open Composer
2. Use MCP tools
3. Your server provides tools to the agent

### Option 3: Wait for Official Support

The Cursor team appears to be building ACP support for future releases.

**Evidence:**
```javascript
// From cursor code:
static CLAUDE_EXTENSION_ID = "Anthropic.claude-code"

// They're tracking Anthropic's Claude Code extension
// This suggests official ACP support is coming
```

## How to Monitor for ACP Support

### 1. Check Cursor Release Notes

Watch for announcements like:
- "ACP agent support"
- "Third-party agent integration"
- "Claude Code extension support"
- "Local agent execution"

### 2. Check Settings

Look for new settings:
```
Cursor → Settings → Search "agent"
Cursor → Settings → Search "acp"
Cursor → Settings → Search "claude code"
```

### 3. Check Extension Marketplace

Look for:
- ACP agent extensions
- Agent provider extensions
- Claude Code extension

### 4. Check for API Exposure

Try in Cursor's developer console (Cmd+Shift+P → "Developer: Toggle Developer Tools"):

```javascript
// Check if API is exposed
if (vscode.cursor?.registerAgentExecProvider) {
    console.log("ACP support available!");
} else {
    console.log("ACP support not yet public");
}
```

## Comparison: What Works Today vs. ACP Future

### Today (Cursor Proprietary)

```
User types in Composer
        ↓
Cursor backend AI (api2.cursor.sh)
        ↓
Tools executed locally
        ↓
Results sent back to backend
        ↓
Response streamed to user
```

**Limitations:**
- ❌ Locked to Cursor's backend
- ❌ Requires internet
- ❌ Can't use custom models
- ❌ Cloud-based AI processing

### Future (ACP)

```
User types in Composer
        ↓
Local ACP agent subprocess
        ↓
Agent calls local AI model (or cloud)
        ↓
Agent requests tools via ACP
        ↓
Cursor executes tools locally
        ↓
Results back to agent
        ↓
Response displayed
```

**Benefits:**
- ✅ Works offline (with local models)
- ✅ Privacy (agent runs locally)
- ✅ Custom agents
- ✅ Open ecosystem

## Expected Timeline (Speculation)

Based on code maturity and industry trends:

**Q1-Q2 2025:** Beta ACP support
- Likely limited to Claude Code extension
- Opt-in experimental feature
- Limited capabilities

**Q3-Q4 2025:** General availability
- Full ACP protocol support
- Multiple agent providers
- Marketplace integration

**2026+:** Ecosystem growth
- Many third-party agents
- Custom agent development
- Enterprise agent solutions

## How to Prepare

### 1. Learn ACP Protocol

Study the protocol:
- https://agentclientprotocol.com
- Understand session management
- Learn tool call format
- Practice with existing clients (Zed, Neovim)

### 2. Try ACP in Other Editors

Get familiar with ACP:

**Zed Editor:**
```bash
# Install Zed
# Configure ACP agent in Zed settings
# Learn the UX patterns
```

**Neovim:**
```lua
-- Install CodeCompanion plugin
require('codecompanion').setup({
  adapters = {
    acp = function()
      return require('codecompanion.adapters').extend('acp', {
        env = { AGENT_PATH = '/path/to/agent' }
      })
    end
  }
})
```

### 3. Experiment with MCP (Available Now!)

MCP is similar and works today in Cursor:

```bash
# Create MCP server
mkdir my-mcp-server
cd my-mcp-server

# Install MCP SDK
npm install @modelcontextprotocol/sdk

# Create server
cat > index.js << 'EOF'
const { Server } = require('@modelcontextprotocol/sdk/server');

const server = new Server({
  name: 'my-tools',
  version: '1.0.0'
});

server.tool('search', async (params) => {
  // Your tool logic
  return { results: [...] };
});

server.start();
EOF

# Configure in Cursor
# Settings → MCP → Add Server
```

### 4. Build Agent Extensions

If you're a developer, start building:

**Example ACP Agent Wrapper:**
```typescript
// Simple ACP agent that wraps OpenAI
import { spawn } from 'child_process';
import { createInterface } from 'readline';

class SimpleACPAgent {
    private rl = createInterface({
        input: process.stdin,
        output: process.stdout
    });

    async initialize() {
        this.rl.on('line', async (line) => {
            const message = JSON.parse(line);

            if (message.method === 'initialize') {
                this.sendResponse(message.id, {
                    protocolVersion: 1,
                    agentInfo: { name: 'simple-agent' },
                    agentCapabilities: { tools: ['read', 'edit'] }
                });
            }

            if (message.method === 'session/prompt') {
                await this.handlePrompt(message);
            }
        });
    }

    sendResponse(id: number, result: any) {
        console.log(JSON.stringify({
            jsonrpc: '2.0',
            id,
            result
        }));
    }

    sendNotification(method: string, params: any) {
        console.log(JSON.stringify({
            jsonrpc: '2.0',
            method,
            params
        }));
    }
}

new SimpleACPAgent().initialize();
```

## Resources

**Official:**
- ACP Docs: https://agentclientprotocol.com
- ACP GitHub: https://github.com/agentclientprotocol
- Cursor Docs: https://docs.cursor.com

**Community:**
- Cursor Discord: Check for ACP discussions
- ACP Discord: https://discord.gg/acp
- Reddit: r/cursor

**Example Agents:**
- Claude Code: When released by Anthropic
- Goose: https://github.com/block/goose
- OpenHands: https://github.com/All-Hands-AI/OpenHands

## Summary

**Right now:**
- ❌ ACP is NOT available in Cursor for end users
- ✅ Infrastructure exists in code
- ✅ Use Cursor's proprietary agent system instead
- ✅ Use MCP (similar protocol) today

**When ACP launches:**
1. Install an ACP agent (like Claude Code)
2. Configure in Cursor settings
3. Select agent in Composer
4. Enjoy local agent execution!

**To stay updated:**
- Watch Cursor release notes
- Monitor settings for new ACP options
- Check extension marketplace
- Follow ACP community

The future is exciting - Cursor + ACP = powerful local agents with full IDE integration! 🚀
