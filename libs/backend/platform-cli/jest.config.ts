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
  // Ratchet floor from TASK_2026_100 F9 post-fix baseline (S 91.98 /
  // B 74.56 / F 89.53 / L 93.55). Rounded down to the nearest 5. The
  // baseline was captured after F9 repaired chokidar/fs.cp/path/stub
  // divergences; ptah-cli callers reach nearly every branch of the
  // provider surface.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 65,
      functions: 80,
      lines: 85,
    },
  },
};
