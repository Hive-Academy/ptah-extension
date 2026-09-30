export default {
  displayName: 'i18n-check',
  preset: '../../jest.preset.js',
  testEnvironment: 'node',
  // Specs live next to the helpers; the planted fixture tree is data only.
  roots: ['<rootDir>/src'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
    // `@angular/compiler` ships ESM only (`fesm2022/*.mjs`). Node's runtime
    // loads it through require(esm), Jest's module system does not, so Jest
    // transpiles it to CommonJS.
    '^.+\\.mjs$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs' }, diagnostics: false },
    ],
    // `parse5` 8 and its `entities` dependency are `"type": "module"` `.js`
    // packages: same reason, same transform.
    'node_modules/(parse5|entities)/.+\\.js$': [
      'ts-jest',
      { tsconfig: { allowJs: true, module: 'commonjs' }, diagnostics: false },
    ],
  },
  transformIgnorePatterns: [
    'node_modules/(?!(@angular/compiler|parse5|entities)/)',
  ],
  moduleFileExtensions: ['ts', 'js', 'mjs', 'json'],
  coverageDirectory: '../../coverage/tools/i18n-check',
};
