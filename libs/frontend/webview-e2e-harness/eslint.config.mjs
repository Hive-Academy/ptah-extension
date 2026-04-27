import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {},
  },
  {
    // Playwright config + scenario builders are infra; permit looser
    // shapes than feature-library code.
    files: ['playwright.config.ts', 'src/lib/scenarios/**/*.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
];
