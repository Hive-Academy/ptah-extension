export default {
  displayName: 'platform-vscode',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  moduleNameMapper: {
    // The `vscode` package is only available at runtime inside the extension
    // host. Tests route to our stateful in-memory test double so contract
    // specs can assert real round-trip behaviour.
    '^vscode$': '<rootDir>/__mocks__/vscode.ts',
  },
  coverageDirectory: '../../../coverage/libs/backend/platform-vscode',
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 93.36 / B 78.03 /
  // F 93.5 / L 94.65). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 75,
      functions: 90,
      lines: 90,
    },
  },
};
