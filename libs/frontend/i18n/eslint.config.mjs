import nx from '@nx/eslint-plugin';
import baseConfig from '../../../eslint.config.mjs';

// No `@nx/dependency-checks` block: this lib has no build target and is
// consumed from source, like the libs/web/* domains. Its "npm only, no
// workspace imports" rule is enforced by `scope:shared` module boundaries.
export default [
  ...baseConfig,
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: ['ptah'], style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: ['ptah'], style: 'kebab-case' },
      ],
    },
  },
];
