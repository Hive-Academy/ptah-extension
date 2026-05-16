export default {
  displayName: 'platform-cli',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/platform-cli',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  // Ratchet floor baseline (S 91.98 / B 74.56 / F 89.53 / L 93.55),
  // rounded down to the nearest 5. ptah-cli callers reach nearly every
  // branch of the provider surface.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 65,
      functions: 80,
      lines: 85,
    },
  },
};
