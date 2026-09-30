/**
 * Count-dependent key choice for panel-ui's own copy (`SelectionToolbar`,
 * `ThreadRow`). NOT exported from the barrel: consumers pass translated text
 * into panel-ui inputs and never need this.
 *
 * A counted phrase is a `one` / `other` key pair, declared per call site as a
 * `*I18N_KEYS` constant (`{ one, other } as const satisfies PluralI18nKeys`) so
 * `i18n-check` can verify both keys exist. The template reads
 * `keys[pluralCategory(n)] | transloco: { count: n }`.
 *
 * The split is the source language's (English: exactly 1 is `one`). Each
 * translation value then words its own count, which is why the Arabic drafts
 * avoid number agreement ("الردود: {{ count }}") instead of adding the four
 * extra CLDR categories Arabic would otherwise need.
 */
export type PluralCategory = 'one' | 'other';

export interface PluralI18nKeys {
  readonly one: string;
  readonly other: string;
}

export function pluralCategory(count: number): PluralCategory {
  return count === 1 ? 'one' : 'other';
}
