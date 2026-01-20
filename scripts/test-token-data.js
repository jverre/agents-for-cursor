#!/usr/bin/env node

/**
 * Test script to inspect token/usage data available from ACP agent
 *
 * Usage: node scripts/test-token-data.js
 */

const { spawn } = require('child_process');
const readline = require('readline');

console.log('🔍 Testing ACP Agent Token Data\n');

async function testAcpAgent() {
  console.log('1. Spawning claude-code agent via npx...');

  const agent = spawn('npx', ['-y', '@zed-industries/claude-code-acp'], {
    stdio: ['pipe', 'pipe', 'inherit'],
    env: process.env
  });

  const rl = readline.createInterface({
    input: agent.stdout,
    crlfDelay: Infinity
  });

  let messageId = 1;
  const responses = new Map();

  // Handle responses
  rl.on('line', (line) => {
    try {
      const message = JSON.parse(line);

      if (message.id !== undefined && responses.has(message.id)) {
        const { resolve, method } = responses.get(message.id);
        responses.delete(message.id);

        console.log(`\n📩 Response for ${method}:`);
        console.log(JSON.stringify(message, null, 2));

        resolve(message.result);
      }

      // Handle notifications
      if (message.method === 'session/update') {
        console.log(`\n🔔 Session update:`, JSON.stringify(message.params, null, 2));
      }
    } catch (e) {
      console.error('Error parsing line:', e.message);
    }
  });

  // Send JSON-RPC request
  function sendRequest(method, params) {
    return new Promise((resolve, reject) => {
      const id = messageId++;
      const request = { jsonrpc: '2.0', id, method, params };

      responses.set(id, { resolve, reject, method });

      console.log(`\n📤 Sending ${method}:`, JSON.stringify(params, null, 2));
      agent.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 60s
      setTimeout(() => {
        if (responses.has(id)) {
          responses.delete(id);
          reject(new Error(`Request ${method} timed out`));
        }
      }, 60000);
    });
  }

  try {
    // 1. Initialize
    console.log('\n2. Initializing agent...');
    const initResult = await sendRequest('initialize', {
      protocolVersion: 1,
      clientInfo: { name: 'token-test', version: '1.0.0' }
    });
    console.log('✅ Initialized');

    // 2. Create session
    console.log('\n3. Creating session...');
    const sessionResult = await sendRequest('session/new', {
      cwd: process.cwd(),
      mcpServers: []
    });
    const sessionId = sessionResult.sessionId;
    console.log('✅ Session created:', sessionId);

    // 3. Set bypass permissions mode
    console.log('\n4. Setting bypass permissions...');
    await sendRequest('session/set_mode', {
      sessionId,
      modeId: 'bypassPermissions'
    });
    console.log('✅ Permissions bypassed');

    // 4. Send a simple prompt
    console.log('\n5. Sending test prompt...');
    console.log('   Listening for session/update notifications...\n');

    let updateCount = 0;
    const updateListener = (params) => {
      updateCount++;
      console.log(`\n🔔 Update #${updateCount}:`, JSON.stringify(params, null, 2));
    };

    // Listen for updates
    const originalOn = rl.on.bind(rl);
    rl.on('line', (line) => {
      try {
        const message = JSON.parse(line);
        if (message.method === 'session/update') {
          updateListener(message.params);
        }
      } catch (e) {}
    });

    const promptResult = await sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Say hello in exactly 5 words' }]
    });

    console.log('\n✅ Prompt completed');
    console.log('\n📊 FINAL RESULT STRUCTURE:');
    console.log(JSON.stringify(promptResult, null, 2));

    // Check for usage data
    if (promptResult.usage) {
      console.log('\n💰 USAGE DATA FOUND:');
      console.log('   Input tokens:', promptResult.usage.input_tokens);
      console.log('   Output tokens:', promptResult.usage.output_tokens);
      console.log('   Cache creation:', promptResult.usage.cache_creation_input_tokens);
      console.log('   Cache read:', promptResult.usage.cache_read_input_tokens);
      console.log('\n   Full usage object:', JSON.stringify(promptResult.usage, null, 2));
    } else {
      console.log('\n⚠️  NO USAGE DATA IN PROMPT RESULT');
    }

    // Look for tool use data
    if (promptResult.content) {
      console.log('\n📝 CONTENT STRUCTURE:');
      promptResult.content.forEach((block, i) => {
        console.log(`   Block ${i}:`, {
          type: block.type,
          hasText: !!block.text,
          hasToolUse: !!block.tool_use,
          keys: Object.keys(block)
        });
      });
    }

    // 5. Test with a tool call
    console.log('\n6. Testing prompt with tool call...');
    const toolPromptResult = await sendRequest('session/prompt', {
      sessionId,
      prompt: [{ type: 'text', text: 'Read the package.json file' }]
    });

    console.log('\n📊 TOOL CALL RESULT STRUCTURE:');
    console.log(JSON.stringify(toolPromptResult, null, 2));

    if (toolPromptResult.usage) {
      console.log('\n💰 TOOL CALL USAGE:');
      console.log(JSON.stringify(toolPromptResult.usage, null, 2));
    }

    console.log('\n✅ Test completed successfully');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
  } finally {
    agent.kill();
    process.exit(0);
  }
}

// Run the test
testAcpAgent().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
