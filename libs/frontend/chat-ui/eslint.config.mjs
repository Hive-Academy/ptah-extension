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
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'off',
      '@angular-eslint/template/no-inline-styles': 'off',
      '@angular-eslint/template/use-track-by-function': 'error',
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
      '@angular-eslint/template/no-negated-async': 'error',
      '@angular-eslint/template/no-any': 'warn',
    },
  },
];
