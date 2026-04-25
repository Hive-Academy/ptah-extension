import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: ['**/dist'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      // Severity is 'warn' (TASK_2026_103 W5). All scope:* constraints
      // currently pass cleanly, but the newly-added type:* constraints
      // surface 61 pre-existing violations in @ptah-extension/rpc-handlers
      // (tagged type:util but importing type:feature libs). Once that
      // tag mislabel is resolved, flip back to 'error'.
      '@nx/enforce-module-boundaries': [
        'warn',
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
            {
              sourceTag: 'type:application',
              onlyDependOnLibsWithTags: [
                'type:feature',
                'type:data-access',
                'type:ui',
                'type:util',
              ],
            },
            // type:* import direction (TASK_2026_103 W5).
            // Currently advisory (warn) — see commit body for the
            // pre-existing violation punch list. Flip to 'error' once
            // the listed migrations land.
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
