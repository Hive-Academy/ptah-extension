/* eslint-disable */
export default {
  displayName: 'ptah-license-server',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/ptah-license-server',
  // Ratchet floor from TASK_2025_294 W8.B1 baseline (S 66.39 / B 55.16 /
  // F 58.98 / L 65.99). Rounded down to the nearest 5.
  coverageThreshold: {
    global: {
      statements: 65,
      branches: 55,
      functions: 55,
      lines: 65,
    },
  },
};
