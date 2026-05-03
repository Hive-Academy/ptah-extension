export default {
  displayName: 'vscode-core',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/vscode-core',
  // Ratchet floor adjusted post-TASK_2026_HERMES: agent-session-watcher
  // subsystem (~1500 well-tested LOC) was deleted in
  // d0a57822 / 1d57fb9f, so the previously well-covered denominator
  // shrank and lower-coverage modules now dominate the global ratio.
  // Current baseline (S 76.29 / B 64.43 / F 75.77 / L 76.26),
  // rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 60,
      functions: 75,
      lines: 75,
    },
  },
};
