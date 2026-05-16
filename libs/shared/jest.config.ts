export default {
  displayName: 'shared',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/libs/shared',
  // Rounded down to the nearest 5 so minor variation doesn't flake CI.
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 85,
      functions: 70,
      lines: 85,
    },
  },
};
