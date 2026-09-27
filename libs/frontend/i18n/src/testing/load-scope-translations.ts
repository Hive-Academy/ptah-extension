import type { Translation } from '@jsverse/transloco';
import type { I18nScope } from '../lib/i18n-scope';
import { unwrapJsonModule } from '../lib/i18n.service';
import { SUPPORTED_LANGS, type SupportedLang } from '../lib/lang.config';

/**
 * Runs every language loader of `scope` and returns what `I18nService` would
 * store for it: each JSON module unwrapped by the runtime's own rule. It only
 * returns data; the spec asserts, typically
 * `expect(await loadScopeTranslations(PRICING_I18N_SCOPE)).toEqual({ en, ar })`.
 * A loader that rejects rejects this call.
 */
export async function loadScopeTranslations(
  scope: I18nScope,
): Promise<Record<SupportedLang, Translation>> {
  const loaded = await Promise.all(
    SUPPORTED_LANGS.map(async (lang) => {
      const translation = await scope.loader[lang]();
      return [lang, unwrapJsonModule(translation)] as const;
    }),
  );
  return Object.fromEntries(loaded) as Record<SupportedLang, Translation>;
}
