import nx from '@nx/eslint-plugin';
import baseConfig from '../../../eslint.config.mjs';
import angularTemplate from '@angular-eslint/eslint-plugin-template';

export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'ptah',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'ptah',
          style: 'kebab-case',
        },
      ],
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
      '@angular-eslint/prefer-standalone': 'error',
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/use-injectable-provided-in': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'warn',
        { accessibility: 'explicit' },
      ],
    },
  },
  {
    // The Skills tab must never inherit the Monaco / xterm bundle. The ONLY
    // legal route to `@ptah-extension/editor` is the runtime `import()` inside
    // `lazy-diff-view.component.ts`; a static import anywhere else silently
    // defeats that boundary, so it is a lint error rather than a convention.
    files: ['**/*.ts'],
    ignores: ['**/lazy-diff-view.component.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@ptah-extension/editor',
              message:
                'Static import of @ptah-extension/editor pulls Monaco/xterm into the Skills bundle. Go through lazy-diff-view.component.ts, which loads it with a runtime import().',
            },
          ],
          patterns: [
            {
              group: ['@ptah-extension/editor/*'],
              message:
                'Static import of @ptah-extension/editor pulls Monaco/xterm into the Skills bundle. Go through lazy-diff-view.component.ts, which loads it with a runtime import().',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    plugins: {
      '@angular-eslint/template': angularTemplate,
    },
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/use-track-by-function': 'error',
      '@angular-eslint/template/valid-aria': 'error',
      '@angular-eslint/template/no-any': 'error',
    },
  },
];
