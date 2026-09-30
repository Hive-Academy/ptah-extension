import { isSupportedLang, type SupportedLang } from './lang.config';

/**
 * Persists the visitor's language choice in `localStorage[storageKey]`.
 *
 * Constructed by `I18nService` with the app's storage key and the platform
 * check, so it stays free of DI and trivially testable.
 *
 * Every access is guarded: private-mode Safari and hardened browsers throw on
 * `localStorage` access instead of returning null, and a language preference is
 * never worth breaking bootstrap over (same posture as `MemberThemeService`).
 * On the server both methods are no-ops.
 */
export class LangPreferenceStore {
  constructor(
    private readonly storageKey: string,
    private readonly isBrowser: boolean,
  ) {}

  /**
   * The stored language, or `null` when nothing valid is stored. An unknown or
   * malformed value is treated as absent so detection applies; it is never
   * handed to the runtime.
   */
  read(): SupportedLang | null {
    if (!this.isBrowser) return null;
    try {
      const stored = localStorage.getItem(this.storageKey);
      return isSupportedLang(stored) ? stored : null;
    } catch {
      // degradation-audit: optional-capability - blocked or throwing storage
      // means no saved preference; null lets detection pick the language.
      return null;
    }
  }

  /**
   * Stores `lang`. A storage failure is swallowed: the in-memory language has
   * already switched, only persistence across reloads is lost.
   */
  write(lang: SupportedLang): void {
    if (!this.isBrowser) return;
    try {
      localStorage.setItem(this.storageKey, lang);
    } catch {
      // See the class comment: persistence is best effort.
    }
  }
}
