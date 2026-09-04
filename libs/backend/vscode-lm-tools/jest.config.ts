export default {
  displayName: 'vscode-lm-tools',
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
  // `@ptah-extension/vscode-core`'s barrel loads its API wrappers, which
  // `import * as vscode from 'vscode'` at runtime — a package that does not
  // exist outside the extension host. Existing specs here worked around that
  // by mocking the whole `vscode-core` module, which is only viable while a
  // spec touches two or three of its exports. The shared stub every other
  // backend lib maps lets a spec load the real thing instead.
  moduleNameMapper: {
    '^vscode$': '<rootDir>/../../../__mocks__/vscode.ts',
    // `workspace-intelligence`'s tree-sitter loader uses `import.meta.url`,
    // which CommonJS ts-jest cannot parse — so reaching that lib's barrel for
    // anything at all fails on a module this lib never uses.
    '(^|/)wasm-bundle-dir(\\.js)?$': '<rootDir>/__mocks__/wasm-bundle-dir.ts',
  },
  coverageDirectory: '../../../coverage/libs/backend/vscode-lm-tools',
  coverageThreshold: {
    global: {
      statements: 75,
      branches: 60,
      functions: 85,
      lines: 75,
    },
  },
};
