import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';
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

      // Component Lifecycle & Architecture
      '@angular-eslint/contextual-lifecycle': 'error',
      '@angular-eslint/no-empty-lifecycle-method': 'error',
      '@angular-eslint/no-conflicting-lifecycle': 'error',
      '@angular-eslint/use-lifecycle-interface': 'error',
      '@angular-eslint/no-attribute-decorator': 'error',
      // TypeScript Enhancement
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/explicit-member-accessibility': [
        'error',
        { accessibility: 'explicit' },
      ],

      // Bundle boundary (TASK_2026_187 Unit 1). The wide `@ptah-extension/editor`
      // barrel re-exports `TerminalComponent`, which value-imports xterm
      // (~380 kB). A single static import of it from the composition root makes
      // the whole editor lib eagerly reachable and defeats every existing
      // `await import('@ptah-extension/editor')` site.
      // NOTE: only the BARE specifier is banned. `@ptah-extension/editor/services`
      // is the intended replacement and must stay legal — do NOT add a
      // `patterns: ['@ptah-extension/editor/*']` group here.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@ptah-extension/editor',
              message:
                'Static import of the wide @ptah-extension/editor barrel pulls xterm (~380 kB) into the initial bundle. Use @ptah-extension/editor/services for services, or a runtime import() for components. See TASK_2026_187.',
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
      // Modern Control Flow (Angular 17+)
      '@angular-eslint/template/prefer-control-flow': 'error',

      // Template Best Practices
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'error',
      '@angular-eslint/template/no-inline-styles': 'off',
      '@angular-eslint/template/use-track-by-function': 'error',

      // Accessibility & UX
      '@angular-eslint/template/alt-text': 'warn',
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/mouse-events-have-key-events': 'warn',
      '@angular-eslint/template/valid-aria': 'error',
      '@angular-eslint/template/elements-content': 'warn',
      '@angular-eslint/template/interactive-supports-focus': 'off',
      // Performance & Structure
      '@angular-eslint/template/no-call-expression': 'off',
      '@angular-eslint/template/no-duplicate-attributes': 'off',
      '@angular-eslint/template/conditional-complexity': [
        'warn',
        { maxComplexity: 7 },
      ],
      '@angular-eslint/template/cyclomatic-complexity': [
        'off',
        { maxComplexity: 20 },
      ],

      // Modern Angular Patterns
      '@angular-eslint/template/prefer-control-flow': 'error', // @if/@for/@switch over *ngIf/*ngFor/*ngSwitch
      '@angular-eslint/template/no-negated-async': 'error',
      '@angular-eslint/template/no-any': 'warn',
    },
  },
];
