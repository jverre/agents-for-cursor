module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'extension.js',
    'patcher.js',
    'patches/**/*.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 60000, // E2E tests may take longer
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

  // Global setup for one-time environment initialization
  globalSetup: '<rootDir>/tests/e2e/global-setup.js',

  // Run tests sequentially (one at a time)
  maxWorkers: 1
};
