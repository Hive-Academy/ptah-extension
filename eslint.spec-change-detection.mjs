/**
 * Flat-config block that exempts spec fixtures from the OnPush rule.
 *
 * Inline test host components declared in specs are throwaway fixtures driven
 * by explicit `fixture.detectChanges()`. Angular 22 makes OnPush the default,
 * and the change-detection-eager codemod wrote an explicit Eager into these
 * fixtures to preserve their behaviour. That is correct: under OnPush a test
 * that assigns a component property directly would stop re-rendering.
 *
 * Nx 23 ships `prefer-on-push-component-change-detection` as an error in its
 * `flat/angular` preset. Each Angular project spreads that preset AFTER the
 * root config, so the rule cannot be switched off at the root — a root-level
 * entry would simply be overridden by the preset. It has to come after the
 * spread, in the consuming project's own config, which is why this is a shared
 * OBJECT rather than something folded into `eslint.config.mjs`.
 *
 * Production components are unaffected and still linted: the `files` globs
 * below cover only spec files and `testing/` helpers.
 *
 * Append it LAST in each consumer:
 *
 *   import specChangeDetection from '../../../eslint.spec-change-detection.mjs';
 *   export default [...baseConfig, ...nx.configs['flat/angular'], specChangeDetection];
 *
 * Several older Angular projects switch the same rule off as a single line
 * inside a larger `rules` object they already had. Those are a different shape
 * and are deliberately left alone; do not rewrite them just to use this file.
 */
export default {
  files: ['**/*.spec.ts', '**/testing/**/*.ts'],
  rules: {
    '@angular-eslint/prefer-on-push-component-change-detection': 'off',
  },
};
