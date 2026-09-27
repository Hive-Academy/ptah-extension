import { isDevMode } from '@angular/core';
import type {
  InlineLoader,
  ProviderScope,
  Translation,
} from '@jsverse/transloco';
import { I18nError } from './i18n.error';
import { SUPPORTED_LANGS, type SupportedLang } from './lang.config';

/**
 * One project's translations: a Transloco `ProviderScope` whose alias always
 * equals its name, so a key's first segment (`pricing.hero.title`) is the scope
 * that owns it. `loader` is keyed by language, as Transloco defines it.
 */
export interface I18nScope extends ProviderScope {
  readonly scope: string;
  readonly alias: string;
  readonly loader: Readonly<InlineLoader>;
}

/** A loader per supported language; the type rejects a missing language. */
export type I18nScopeLoaders = Readonly<
  Record<SupportedLang, () => Promise<unknown>>
>;

/**
 * camelCase, starting lower-case. Transloco camel-cases scope names unless
 * `keepCasing` is set, and the `i18n-check` key rules anchor on these names,
 * so anything else (dashes, dots, slashes, digits) is rejected up front.
 */
const SCOPE_NAME_PATTERN = /^[a-z][A-Za-z]*$/;

/**
 * Declares a project's scope, typically as
 * `defineI18nScope('pricing', { en: () => import('./en.json'), ar: () => import('./ar.json') })`.
 *
 * In dev mode a malformed scope name throws an `I18nError`, so the mistake
 * surfaces on the first run rather than as a silently mis-keyed scope. The
 * guard is dev-only: scope names are developer-authored constants, not runtime
 * input, and production builds do not validate them.
 */
export function defineI18nScope(
  scope: string,
  loaders: I18nScopeLoaders,
): I18nScope {
  if (isDevMode() && !SCOPE_NAME_PATTERN.test(scope)) {
    throw new I18nError(
      `[i18n] Invalid scope name "${scope}": it must match ${SCOPE_NAME_PATTERN} (camelCase, letters only).`,
    );
  }
  const loader: InlineLoader = {};
  for (const lang of SUPPORTED_LANGS) {
    const load = loaders[lang];
    loader[lang] = () =>
      load().then((result) => toTranslation(result, scope, lang));
  }
  return Object.freeze({
    scope,
    alias: scope,
    loader: Object.freeze(loader),
  });
}

/** The Transloco load path of `scope` in `lang` (`scope/lang`). */
export function scopeLoadPath(scope: I18nScope, lang: SupportedLang): string {
  return `${scope.scope}/${lang}`;
}

/**
 * A loader resolves to a JSON module (`{ default: {...} }`, which Transloco
 * unwraps) or to a plain translation object. Anything else is a broken loader,
 * reported as a load failure (`I18nError`) instead of being handed to Transloco.
 */
function toTranslation(
  result: unknown,
  scope: string,
  lang: SupportedLang,
): Translation {
  if (isTranslation(result)) return result;
  throw new I18nError(
    `[i18n] Loader for "${scope}/${lang}" resolved to ${result === null ? 'null' : typeof result}, expected a translation object.`,
  );
}

function isTranslation(value: unknown): value is Translation {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
