export default {
  displayName: 'vscode-core',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        diagnostics: { ignoreCodes: [151002] },
      },
    ],
  },
  // Real-git specs spawn real `git` processes with 60-120 s budgets and time
  // out when they share a machine with ~15 parallel jest workers. They run
  // serially through the `test-real-git` target (jest.real-git.config.ts).
  testPathIgnorePatterns: ['/node_modules/', '\\.real-git\\.spec\\.ts$'],
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/vscode-core',
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 50,
      functions: 70,
      lines: 65,
    },
  },
};
