export default {
  displayName: 'tool-output-reducers',
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
  moduleFileExtensions: ['ts', 'js', 'html'],
  // `marked` ships ESM only; ts-jest transpiles it to CommonJS for the specs.
  transformIgnorePatterns: ['node_modules/(?!marked/)'],
  coverageDirectory: '../../../coverage/libs/backend/tool-output-reducers',
};
