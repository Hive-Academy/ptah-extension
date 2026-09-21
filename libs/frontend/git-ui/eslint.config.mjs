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
