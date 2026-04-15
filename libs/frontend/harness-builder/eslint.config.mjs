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
        'warn',
        { accessibility: 'explicit' },
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
      '@angular-eslint/template/prefer-ngsrc': 'error',
      '@angular-eslint/template/no-inline-styles': 'off',
      '@angular-eslint/template/use-track-by-function': 'error',
      '@angular-eslint/template/alt-text': 'warn',
      '@angular-eslint/template/click-events-have-key-events': 'warn',
      '@angular-eslint/template/mouse-events-have-key-events': 'warn',
      '@angular-eslint/template/valid-aria': 'error',
      '@angular-eslint/template/elements-content': 'warn',
      '@angular-eslint/template/interactive-supports-focus': 'off',
      '@angular-eslint/template/no-call-expression': 'off',
      '@angular-eslint/template/no-duplicate-attributes': 'off',
      '@angular-eslint/template/conditional-complexity': [
        'warn',
        { maxComplexity: 7 },
      ],
      '@angular-eslint/template/cyclomatic-complexity': [
        'off',
        { maxComplexity: 40 },
      ],
      '@angular-eslint/template/no-negated-async': 'error',
      '@angular-eslint/template/no-any': 'warn',
    },
  },
];
