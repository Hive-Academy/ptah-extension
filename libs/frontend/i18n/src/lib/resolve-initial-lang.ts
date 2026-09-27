import { isSupportedLang, type SupportedLang } from './lang.config';

export interface InitialLangInput {
  /** Raw persisted value, unvalidated (`null` when absent or unreadable). */
  readonly stored: string | null;
  /** `navigator.languages`, or `undefined` where there is no navigator. */
  readonly languages: readonly string[] | undefined;
}

/**
 * The detection rule, and its single source of truth: the app's pre-paint
 * inline script is tested against this function, so a change here must be
 * mirrored there (the sync spec fails otherwise).
 *
 * 1. A valid stored preference wins.
 * 2. Otherwise a first browser language starting with `ar` selects Arabic.
 * 3. Otherwise English.
 */
export function resolveInitialLang(input: InitialLangInput): SupportedLang {
  if (isSupportedLang(input.stored)) return input.stored;
  const first = input.languages?.[0];
  if (typeof first === 'string' && first.toLowerCase().startsWith('ar')) {
    return 'ar';
  }
  return 'en';
}
