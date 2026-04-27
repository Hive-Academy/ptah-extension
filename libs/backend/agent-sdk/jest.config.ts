export default {
  displayName: 'agent-sdk',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/agent-sdk',
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
  },
  // Ratchet floor from TASK_2026_100 F4 post-fix baseline (S 57.98 /
  // B 42.32 / F 46.45 / L 58.5). Rounded down to the nearest 5, never
  // exceeding actual baseline. Functions bumps 40 -> 45 as F4 restored
  // coverage from 3 previously failing suites (codex-cli.adapter,
  // agent-process-manager, prompt-designer-agent). This library still
  // has sizable untested surface area — later waves will lift the floor.
  coverageThreshold: {
    global: {
      statements: 55,
      branches: 40,
      functions: 45,
      lines: 55,
    },
  },
};
