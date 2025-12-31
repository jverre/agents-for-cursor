module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'extension.js',
    'patcher.js',
    'checksum-fixer.js',
    'patches/**/*.js'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  testTimeout: 60000, // E2E tests may take longer
  verbose: true,
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js']
};
