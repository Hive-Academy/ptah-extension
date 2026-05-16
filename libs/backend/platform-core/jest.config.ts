export default {
  displayName: 'platform-core',
  preset: '../../../jest.preset.js',
  testEnvironment: 'node',
  transform: {
    '^.+\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../../coverage/libs/backend/platform-core',
  coverageThreshold: {
    global: {
      statements: 85,
      branches: 65,
      functions: 90,
      lines: 85,
    },
  },
};
