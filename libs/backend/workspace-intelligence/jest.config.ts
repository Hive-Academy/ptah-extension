export default {
  displayName: 'workspace-intelligence',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/workspace-intelligence',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
  // Ratchet floor from TASK_2026_100 F2 post-fix baseline (S 79.03 / B 63.84
  // / F 83.82 / L 78.60). Rounded down to the nearest 5. Adjusted DOWN from
  // TASK_2025_294 W8.B1 levels because the F2 spec refactor replaced direct
  // production exercise with jest.mock-based isolation and extracted the
  // wasm-bundle-dir helper (not directly covered by the surviving specs).
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 60,
      functions: 80,
      lines: 75,
    },
  },
};
