// Global test setup
const path = require('path');
const fs = require('fs');

// Create test directories if they don't exist
const testDirs = [
  path.join(__dirname, 'screenshots'),
  path.join(__dirname, 'logs'),
  path.join(__dirname, 'fixtures')
];

testDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.ACP_TEST_MODE = 'true';

// Increase timeout for async operations
jest.setTimeout(60000);

// Global teardown
afterAll(() => {
  // Cleanup test artifacts if tests passed
  if (process.env.KEEP_TEST_ARTIFACTS !== 'true') {
    // Clean up logic here if needed
  }
});
