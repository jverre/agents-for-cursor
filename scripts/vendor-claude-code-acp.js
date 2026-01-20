#!/usr/bin/env node
/**
 * Vendor and patch @zed-industries/claude-code-acp
 * 
 * This script:
 * 1. Downloads the latest version of @zed-industries/claude-code-acp from npm
 * 2. Extracts it to vendor/claude-code-acp/
 * 3. Applies patches to forward usage data from the Claude SDK
 * 
 * Usage:
 *   node scripts/vendor-claude-code-acp.js [--version <version>]
 * 
 * The patches enable:
 * - Real-time usage data in session/update notifications
 * - Final usage, total_cost_usd, and modelUsage in PromptResponse
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const PACKAGE_NAME = '@zed-industries/claude-code-acp';
const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'claude-code-acp');

// Parse command line arguments
const args = process.argv.slice(2);
let targetVersion = 'latest';
const versionIndex = args.indexOf('--version');
if (versionIndex !== -1 && args[versionIndex + 1]) {
  targetVersion = args[versionIndex + 1];
}

console.log(`\n📦 Vendoring ${PACKAGE_NAME}@${targetVersion}\n`);

// Step 1: Create vendor directory
console.log('1️⃣  Creating vendor directory...');
if (fs.existsSync(VENDOR_DIR)) {
  fs.rmSync(VENDOR_DIR, { recursive: true });
}
fs.mkdirSync(VENDOR_DIR, { recursive: true });

// Step 2: Download package using npm pack
console.log('2️⃣  Downloading package from npm...');
const tempDir = path.join(__dirname, '..', '.vendor-temp');
if (fs.existsSync(tempDir)) {
  fs.rmSync(tempDir, { recursive: true });
}
fs.mkdirSync(tempDir, { recursive: true });

try {
  // Use npm pack to download the package as a tarball
  const packOutput = execSync(`npm pack ${PACKAGE_NAME}@${targetVersion} --pack-destination="${tempDir}"`, {
    encoding: 'utf8',
    cwd: tempDir
  });
  
  const tarballName = packOutput.trim().split('\n').pop();
  const tarballPath = path.join(tempDir, tarballName);
  
  console.log(`   Downloaded: ${tarballName}`);
  
  // Step 3: Extract tarball
  console.log('3️⃣  Extracting package...');
  execSync(`tar -xzf "${tarballPath}" -C "${tempDir}"`, { encoding: 'utf8' });
  
  // Move contents from package/ to vendor directory
  const packageDir = path.join(tempDir, 'package');
  const files = fs.readdirSync(packageDir);
  for (const file of files) {
    fs.renameSync(path.join(packageDir, file), path.join(VENDOR_DIR, file));
  }
  
  // Get version from package.json
  const packageJson = JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, 'package.json'), 'utf8'));
  console.log(`   Version: ${packageJson.version}`);
  
} finally {
  // Cleanup temp directory
  if (fs.existsSync(tempDir)) {
    fs.rmSync(tempDir, { recursive: true });
  }
}

// Step 4: Apply patches
console.log('4️⃣  Applying usage data patches...');

// Find the main entry point
const packageJson = JSON.parse(fs.readFileSync(path.join(VENDOR_DIR, 'package.json'), 'utf8'));
const mainFile = packageJson.main || 'index.js';
const distDir = path.join(VENDOR_DIR, 'dist');

// The actual agent code is typically in dist/
let agentFile = null;
const possibleFiles = [
  path.join(distDir, 'acp-agent.js'),
  path.join(distDir, 'index.js'),
  path.join(VENDOR_DIR, 'acp-agent.js'),
  path.join(VENDOR_DIR, mainFile)
];

for (const file of possibleFiles) {
  if (fs.existsSync(file)) {
    agentFile = file;
    break;
  }
}

if (!agentFile) {
  // List what we have
  console.log('\n   Available files:');
  const listFiles = (dir, prefix = '') => {
    if (!fs.existsSync(dir)) return;
    const items = fs.readdirSync(dir);
    for (const item of items) {
      const fullPath = path.join(dir, item);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        console.log(`   ${prefix}${item}/`);
        listFiles(fullPath, prefix + '  ');
      } else {
        console.log(`   ${prefix}${item}`);
      }
    }
  };
  listFiles(VENDOR_DIR);
  
  console.error('\n❌ Could not find agent file to patch');
  process.exit(1);
}

console.log(`   Patching: ${path.relative(VENDOR_DIR, agentFile)}`);

let content = fs.readFileSync(agentFile, 'utf8');
let patchCount = 0;

// Patch 1: Add usage to PromptResponse (stopReason: "end_turn")
// Look for patterns like: return { stopReason: "end_turn" } or similar
const promptResponsePatterns = [
  // Pattern: return { stopReason: "end_turn" }
  {
    search: /return\s*\{\s*stopReason:\s*["']end_turn["']\s*\}/g,
    replace: (match) => {
      patchCount++;
      return `return { stopReason: "end_turn", _meta: { usage: message?.usage, total_cost_usd: message?.total_cost_usd, modelUsage: message?.modelUsage } }`;
    }
  },
  // Pattern: { stopReason: result.stopReason || "end_turn" }
  {
    search: /\{\s*stopReason:\s*([^}]+?)\s*\}/g,
    replace: (match, stopReasonExpr) => {
      // Only patch if it looks like a PromptResponse return
      if (stopReasonExpr.includes('stopReason') || stopReasonExpr.includes('end_turn')) {
        patchCount++;
        return `{ stopReason: ${stopReasonExpr}, _meta: { usage: message?.usage || result?.usage, total_cost_usd: message?.total_cost_usd || result?.total_cost_usd, modelUsage: message?.modelUsage || result?.modelUsage } }`;
      }
      return match;
    }
  }
];

// Try each pattern
for (const pattern of promptResponsePatterns) {
  if (pattern.search.test(content)) {
    content = content.replace(pattern.search, pattern.replace);
    break; // Only apply one pattern
  }
}

// Patch 2: Emit usage_update notifications from message_start and message_delta events
// The Anthropic API sends usage data in these events, but they're currently ignored
// We need to emit a usage_update notification when we receive usage data

// Find the streamEventToAcpNotifications function and patch the message_start/message_delta handling
const streamEventPatch = `
        case "message_start":
            // Emit usage_update with input tokens only (output_tokens is useless here, always ~1)
            // message_start.message.usage contains: input_tokens, cache_read_input_tokens, cache_creation_input_tokens
            if (event.message?.usage) {
                const { output_tokens, ...inputUsage } = event.message.usage;
                return [{
                    sessionId,
                    update: {
                        sessionUpdate: "usage_update",
                        usage: inputUsage
                    }
                }];
            }
            return [];
        case "message_delta":
            // Emit usage_update with final output_tokens (this is the only place we get accurate output count)
            if (event.usage) {
                return [{
                    sessionId,
                    update: {
                        sessionUpdate: "usage_update",
                        usage: event.usage
                    }
                }];
            }
            return [];`;

// Replace the empty message_start/message_delta handlers
const streamEventPattern = /case "message_start":\s*case "message_delta":\s*case "message_stop":/g;
if (streamEventPattern.test(content)) {
  content = content.replace(streamEventPattern, (match) => {
    patchCount++;
    return streamEventPatch + `
        case "message_stop":`;
  });
}

// Write patched content
fs.writeFileSync(agentFile, content, 'utf8');

// Step 5: Create a patch marker file
const patchInfo = {
  packageName: PACKAGE_NAME,
  version: packageJson.version,
  patchedAt: new Date().toISOString(),
  patchCount: patchCount,
  patches: [
    'Added _meta.usage, _meta.total_cost_usd, _meta.modelUsage to PromptResponse',
    'Added usage_update notifications from message_start/message_delta events'
  ]
};

fs.writeFileSync(
  path.join(VENDOR_DIR, '.patch-info.json'),
  JSON.stringify(patchInfo, null, 2),
  'utf8'
);

console.log(`   Applied ${patchCount} patches`);

// Step 6: Summary
console.log('\n✅ Vendoring complete!\n');
console.log(`   Location: ${path.relative(process.cwd(), VENDOR_DIR)}`);
console.log(`   Version:  ${packageJson.version}`);
console.log(`   Patches:  ${patchCount}`);
console.log('\n   To update, run: node scripts/vendor-claude-code-acp.js\n');

// If no patches were applied, warn the user
if (patchCount === 0) {
  console.log('⚠️  Warning: No patches were applied!');
  console.log('   The package structure may have changed.');
  console.log('   Please inspect the vendor directory and update the patch patterns.\n');
  
  // Show a sample of the content for debugging
  console.log('   Sample of agent file content:');
  console.log('   ' + content.slice(0, 500).replace(/\n/g, '\n   '));
}
