#!/usr/bin/env node

const { spawnSync } = require('child_process');

const args = process.argv.slice(2);
const localIndex = args.indexOf('--local');

if (localIndex !== -1) {
  args.splice(localIndex, 1);
  process.env.LOCAL = 'true';
}

const jestArgs = [];

if (args.length === 0) {
  jestArgs.push('tests/e2e');
} else {
  jestArgs.push(...args);
}

const result = spawnSync('npx', ['jest', ...jestArgs], {
  stdio: 'inherit',
  env: process.env
});

process.exit(result.status ?? 1);
