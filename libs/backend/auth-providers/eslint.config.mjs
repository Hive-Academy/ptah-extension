import baseConfig from '../../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/esbuild.config.{js,ts,mjs,mts}',
          ],
          // `@openai/codex` is resolved dynamically, not imported: see
          // `src/lib/providers/codex/codex-account-usage.service.ts`
          // (`require.resolve('@openai/codex/package.json')`), which locates the
          // packaged `bin/codex.js` on disk. Nx's static analysis cannot see a
          // `require.resolve` subpath call, so it reports the declared
          // dependency as unused. The declaration is real and must stay —
          // removing it breaks that resolution in a packaged install.
          ignoredDependencies: ['@openai/codex'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
