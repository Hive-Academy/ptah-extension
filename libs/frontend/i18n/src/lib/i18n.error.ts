/**
 * Root error class of `@ptah-extension/i18n` (CONVENTIONS.md §7).
 *
 * Every error this library throws itself is an `I18nError` or a subclass, so a
 * consumer can tell it apart from a platform or Transloco error with
 * `instanceof I18nError`. Errors that reach the library from outside, such as a
 * rejected `import()` of a scope chunk or Transloco's `TranslationLoadError`,
 * are passed on unchanged.
 */
export class I18nError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'I18nError';
  }
}
