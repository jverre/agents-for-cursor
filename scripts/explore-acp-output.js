#!/usr/bin/env node
/**
 * Explore claude-code-acp output to find token/usage data
 * 
 * This script spawns the ACP agent and captures ALL output:
 * - stdout (JSON-RPC messages)
 * - stderr (potential usage/debug data)
 * 
 * Run with: node scripts/explore-acp-output.js
 */

const { spawn } = require('child_process');
const readline = require('readline');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

let messageId = 1;
let sessionId = null;
let stderrBuffer = '';
let stdoutBuffer = '';

console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
console.log(`${colors.cyan}  ACP Output Explorer - Looking for token/usage data${colors.reset}`);
console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}\n`);

// Spawn the ACP agent (zed-industries version - JSON-RPC)
const proc = spawn('npx', ['--yes', '@zed-industries/claude-code-acp'], {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: {
    ...process.env,
    // Enable any debug flags that might exist
    DEBUG: '*',
    CLAUDE_CODE_DEBUG: '1',
    ACP_DEBUG: '1',
  }
});

// Track all stderr output
proc.stderr.on('data', (data) => {
  const text = data.toString();
  stderrBuffer += text;
  
  // Log each line with highlighting for interesting patterns
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    
    // Highlight potential usage/token related content
    if (line.includes('token') || line.includes('usage') || line.includes('cost')) {
      console.log(`${colors.green}[STDERR/TOKEN] ${line}${colors.reset}`);
    } else if (line.includes('<') && line.includes('>')) {
      // XML-like tags
      console.log(`${colors.yellow}[STDERR/XML] ${line}${colors.reset}`);
    } else if (line.includes('local-command') || line.includes('command-output')) {
      console.log(`${colors.magenta}[STDERR/CMD] ${line}${colors.reset}`);
    } else {
      console.log(`${colors.gray}[STDERR] ${line}${colors.reset}`);
    }
  }
});

// Track stdout (JSON-RPC)
proc.stdout.on('data', (data) => {
  const text = data.toString();
  stdoutBuffer += text;
  
  // Try to parse JSON-RPC messages
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const msg = JSON.parse(line);
      
      // Check for usage data in responses
      if (msg.result) {
        console.log(`${colors.blue}[STDOUT/RESULT] id=${msg.id}${colors.reset}`);
        console.log(`  ${JSON.stringify(msg.result, null, 2).split('\n').join('\n  ')}`);
        
        // Look for usage fields
        if (msg.result.usage || msg.result.tokens || msg.result.token_count) {
          console.log(`${colors.green}[FOUND USAGE DATA!] ${JSON.stringify(msg.result)}${colors.reset}`);
        }
      }
      
      // Check notifications for usage
      if (msg.method === 'session/update') {
        const params = msg.params || {};
        console.log(`${colors.cyan}[STDOUT/UPDATE] ${params.sessionUpdate || 'unknown'}${colors.reset}`);
        
        // Log full content for analysis
        if (params.content || params.usage || params.tokens) {
          console.log(`  ${JSON.stringify(params, null, 2).split('\n').join('\n  ')}`);
        }
        
        // Check for any usage-related fields
        const jsonStr = JSON.stringify(params);
        if (jsonStr.includes('token') || jsonStr.includes('usage') || jsonStr.includes('cost')) {
          console.log(`${colors.green}[FOUND TOKEN/USAGE IN UPDATE!]${colors.reset}`);
          console.log(`  ${JSON.stringify(params, null, 2)}`);
        }
      }
    } catch (e) {
      // Not JSON, log raw
      console.log(`${colors.gray}[STDOUT/RAW] ${line.slice(0, 200)}${colors.reset}`);
    }
  }
});

// Send JSON-RPC message
function send(method, params = {}) {
  const msg = {
    jsonrpc: '2.0',
    id: messageId++,
    method,
    params
  };
  console.log(`${colors.yellow}[SEND] ${method} (id=${msg.id})${colors.reset}`);
  proc.stdin.write(JSON.stringify(msg) + '\n');
  return msg.id;
}

// Wait for response
function waitForResponse(id, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      // Look for response in buffer
      const lines = stdoutBuffer.split('\n');
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            resolve(msg);
            return;
          }
        } catch (e) {}
      }
      
      if (Date.now() - start > timeout) {
        reject(new Error('Timeout waiting for response'));
        return;
      }
      
      setTimeout(check, 100);
    };
    check();
  });
}

// Wait for specific notification
function waitForNotification(type, timeout = 60000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      const lines = stdoutBuffer.split('\n');
      for (const line of lines) {
        try {
          const msg = JSON.parse(line);
          if (msg.method === 'session/update' && msg.params?.sessionUpdate === type) {
            resolve(msg);
            return;
          }
        } catch (e) {}
      }
      
      if (Date.now() - start > timeout) {
        reject(new Error(`Timeout waiting for ${type}`));
        return;
      }
      
      setTimeout(check, 100);
    };
    check();
  });
}

// Main test sequence
async function runTest() {
  try {
    // Wait for agent to start
    console.log(`\n${colors.cyan}Waiting for agent to start...${colors.reset}\n`);
    await new Promise(r => setTimeout(r, 2000));
    
    // Initialize
    console.log(`\n${colors.cyan}Step 1: Initialize${colors.reset}`);
    const initId = send('initialize', {
      protocolVersion: '2024-10-01',
      capabilities: {},
      clientInfo: { name: 'acp-explorer', version: '1.0.0' }
    });
    await waitForResponse(initId);
    
    // Create session
    console.log(`\n${colors.cyan}Step 2: Create Session${colors.reset}`);
    const sessionCreateId = send('session/create', {
      workingDirectory: process.cwd()
    });
    const sessionResp = await waitForResponse(sessionCreateId);
    sessionId = sessionResp.result?.sessionId;
    console.log(`  Session ID: ${sessionId}`);
    
    // Send a simple prompt
    console.log(`\n${colors.cyan}Step 3: Send Prompt (looking for usage data in response)${colors.reset}`);
    const promptId = send('session/prompt', {
      sessionId,
      prompt: 'Say "hello" and nothing else.'
    });
    
    // Wait for end_turn
    console.log(`\n${colors.cyan}Waiting for response...${colors.reset}`);
    await waitForNotification('end_turn', 60000);
    
    // Get the prompt response
    const promptResp = await waitForResponse(promptId);
    console.log(`\n${colors.green}═══════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.green}  PROMPT RESPONSE (looking for usage/token data):${colors.reset}`);
    console.log(`${colors.green}═══════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(JSON.stringify(promptResp, null, 2));
    
    // Summary
    console.log(`\n${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.cyan}  SUMMARY${colors.reset}`);
    console.log(`${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}`);
    
    console.log(`\n${colors.yellow}Full STDERR output:${colors.reset}`);
    console.log(stderrBuffer || '(empty)');
    
    // Look for any token/usage patterns in all output
    const allOutput = stdoutBuffer + stderrBuffer;
    const patterns = [
      /token/gi,
      /usage/gi,
      /cost/gi,
      /<[^>]+>/g,  // XML tags
      /local-command/gi,
      /command-output/gi,
    ];
    
    console.log(`\n${colors.yellow}Pattern matches in all output:${colors.reset}`);
    for (const pattern of patterns) {
      const matches = allOutput.match(pattern);
      if (matches && matches.length > 0) {
        console.log(`  ${pattern}: ${matches.length} matches`);
        console.log(`    Examples: ${[...new Set(matches)].slice(0, 5).join(', ')}`);
      }
    }
    
  } catch (error) {
    console.error(`${colors.red}Error: ${error.message}${colors.reset}`);
  } finally {
    console.log(`\n${colors.cyan}Cleaning up...${colors.reset}`);
    proc.kill();
    process.exit(0);
  }
}

// Handle process events
proc.on('error', (err) => {
  console.error(`${colors.red}Failed to start ACP agent: ${err.message}${colors.reset}`);
  process.exit(1);
});

proc.on('close', (code) => {
  console.log(`${colors.gray}ACP agent exited with code ${code}${colors.reset}`);
});

// Start the test
runTest();
