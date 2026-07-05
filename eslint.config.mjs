import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/.vscode-test/**',
      // ptah-video-studio transient artifacts: Remotion bundle output, the
      // whisper.cpp binary/model cache, and rendered mp4 output. All are
      // generated/downloaded (gitignored) and must never be linted.
      'apps/ptah-video-studio/build/**',
      'apps/ptah-video-studio/.whisper/**',
      'apps/ptah-video-studio/out/**',
      'apps/ptah-video-studio/.remotion/**',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // Strict 'error' severity (TASK_2026_103 W5 + F4). Both scope:*
      // and type:* constraints are clean after retagging
      // @ptah-extension/rpc-handlers from type:util to type:feature
      // (matches its actual role as an RPC orchestration feature).
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'scope:extension',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:extension'],
            },
            {
              sourceTag: 'scope:webview',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:webview'],
            },
            {
              sourceTag: 'scope:landing',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:landing'],
            },
            {
              sourceTag: 'scope:electron',
              onlyDependOnLibsWithTags: [
                'scope:shared',
                'scope:electron',
                'scope:extension',
              ],
            },
            {
              sourceTag: 'scope:cli',
              onlyDependOnLibsWithTags: [
                'scope:shared',
                'scope:cli',
                'scope:extension',
              ],
            },
            // e2e harnesses drive the runtime apps and consume shared
            // contracts (e.g. @ptah-extension/showcase-manifest). Without
            // this entry, scope:e2e matches no sourceTag and any workspace
            // import trips projectWithoutTagsCannotHaveDependencies.
            {
              sourceTag: 'scope:e2e',
              onlyDependOnLibsWithTags: ['scope:shared', 'scope:e2e'],
            },
            {
              sourceTag: 'type:application',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
              ],
            },
            // type:* import direction (TASK_2026_103 W5 + F4).
            // Enforced as 'error' after rpc-handlers was retagged
            // type:feature (F4) — no remaining violations.
            {
              sourceTag: 'type:app',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
                'type:core',
              ],
            },
            {
              sourceTag: 'type:feature',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
                'type:core',
              ],
            },
            {
              sourceTag: 'type:data-access',
              onlyDependOnLibsWithTags: ['type:data-access', 'type:util'],
            },
            {
              sourceTag: 'type:ui',
              onlyDependOnLibsWithTags: ['type:ui', 'type:util'],
            },
            {
              sourceTag: 'type:util',
              onlyDependOnLibsWithTags: ['type:util'],
            },
            {
              sourceTag: 'type:core',
              onlyDependOnLibsWithTags: ['type:core', 'type:util'],
            },
            // e2e is an application-level consumer (mirrors type:app): it may
            // depend on feature/data-access/ui/util/core libs it exercises.
            {
              sourceTag: 'type:e2e',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
                'type:core',
              ],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-empty-function': ['warn'],
    },
  },
  {
    files: ['**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            "CallExpression[callee.property.name='postStrictMessage'][arguments.0.type='Literal']",
          message:
            'Use MESSAGE_TYPES constants instead of string literals for message types. Import from @ptah-extension/shared.',
        },
        {
          selector:
            "CallExpression[callee.property.name='publish'][arguments.0.type='Literal']",
          message:
            'Use MESSAGE_TYPES constants instead of string literals for event types. Import from @ptah-extension/shared.',
        },
      ],
    },
  },
];
