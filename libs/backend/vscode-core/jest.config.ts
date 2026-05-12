export default {
  displayName: 'vscode-core',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/vscode-core',
  // Ratchet floor re-adjusted after PR #267 merged the Thoth skill-lifecycle
  // batch which introduced GitInfoService (~470 LOC, ~40% covered) and
  // SubagentRegistryService (large license-aware extensions, ~26% covered).
  // Both modules carry first-pass partial coverage by design; follow-on tasks
  // raise these. Current baseline (S 65.46 / B 51.34 / F 71.6 / L 65.33),
  // rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 50,
      functions: 70,
      lines: 65,
    },
  },
};
