export default {
  displayName: 'agent-generation',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/agent-generation',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
  // Ratchet floor after TASK_2026_100 P2.B1 (orchestrator.service spec
  // rewrite). Post-fix baseline measured: S 88.04 / B 73.69 / F 87.69 /
  // L 88.87 (287 tests passing, 7 skipped). Floor rounded down to the
  // nearest 5, never exceeding actual. Pre-P2 baseline (TASK_2025_294 F6):
  // S 87.86 / B 72.66 / F 87.61 / L 88.02 — thresholds unchanged.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 70,
      functions: 85,
      lines: 85,
    },
  },
};
