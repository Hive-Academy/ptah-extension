import nx from '@nx/eslint-plugin';
import baseConfig from '../../../eslint.config.mjs';

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
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {
      // Modern Control Flow (Angular 17+)
      '@angular-eslint/template/prefer-control-flow': 'error',

      // Template Best Practices
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'off',
      '@angular-eslint/template/no-inline-styles': 'off',
      '@angular-eslint/template/use-track-by-function': 'error',

      // Accessibility & UX
      '@angular-eslint/template/alt-text': 'warn',
      '@angular-eslint/template/click-events-have-key-events': 'off',
      '@angular-eslint/template/interactive-supports-focus': 'off',
      '@angular-eslint/template/mouse-events-have-key-events': 'warn',
      '@angular-eslint/template/valid-aria': 'error',
      '@angular-eslint/template/elements-content': 'warn',
      '@angular-eslint/template/no-call-expression': 'off',

      '@angular-eslint/template/no-duplicate-attributes': 'error',
      '@angular-eslint/template/conditional-complexity': [
        'warn',
        { maxComplexity: 10 },
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
  {
    // Inline test host components declared in specs are throwaway fixtures
    // driven by explicit fixture.detectChanges(). Angular 22 makes OnPush the
    // default, and the change-detection-eager codemod wrote an explicit Eager
    // into these fixtures to preserve their behaviour. That is correct: under
    // OnPush a test that assigns a component property directly would stop
    // re-rendering. Nx 23 ships this rule as an error in its flat/angular
    // preset, which this project spreads after the root config, so the rule
    // has to be switched off here rather than at the root. Production
    // components in this library are unaffected and still linted.
    files: ['**/*.spec.ts', '**/testing/**/*.ts'],
    rules: {
      '@angular-eslint/prefer-on-push-component-change-detection': 'off',
    },
  },
];
