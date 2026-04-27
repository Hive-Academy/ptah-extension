import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {},
  },
  {
    // Playwright config + test fixtures are infra; permit looser shapes
    // than feature-library code (IPC payloads are unknown by nature).
    files: [
      'playwright.config.ts',
      'src/support/**/*.ts',
      'src/specs/**/*.ts',
    ],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
