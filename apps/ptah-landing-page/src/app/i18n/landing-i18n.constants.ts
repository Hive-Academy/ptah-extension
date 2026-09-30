/**
 * Landing-app i18n constants. The `#ptah-i18n-prepaint` script in
 * `src/index.html` repeats each value as a literal (it runs before any bundle
 * loads); `pre-paint-script.spec.ts` fails when the two drift apart.
 */

/** `localStorage` key holding the visitor's language choice. */
export const LANDING_LANG_STORAGE_KEY = 'ptah.lang';

/** `id` of the Arabic webfont stylesheet link, so it is appended only once. */
export const ARABIC_FONT_LINK_ID = 'ptah-font-ar';

/** IBM Plex Sans Arabic, 400-700 (design-spec §3.6), requested only for `ar`. */
export const ARABIC_FONT_HREF =
  'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&display=swap';
