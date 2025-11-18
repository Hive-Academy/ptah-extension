/**
 * Jest Configuration for E2E Tests
 *
 * This configuration is specifically for E2E tests that require
 * real Claude CLI integration.
 */

module.exports = {
  displayName: 'e2e',
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/e2e/**/*.e2e.spec.ts'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx'],
  coverageDirectory: '<rootDir>/coverage/e2e',
  collectCoverageFrom: ['e2e/**/*.ts', '!e2e/**/*.spec.ts'],
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.base.json',
      },
    ],
  },
  moduleNameMapper: {
    '^@ptah-extension/shared$': '<rootDir>/libs/shared/src/index.ts',
    '^@ptah-extension/(.*)$': '<rootDir>/libs/$1/src/index.ts',
  },
  globals: {
    'ts-jest': {
      isolatedModules: true,
    },
  },
  // E2E tests may take longer
  testTimeout: 60000,
  // Verbose output for debugging
  verbose: true,
  // Run tests serially (not in parallel)
  maxWorkers: 1,
};
