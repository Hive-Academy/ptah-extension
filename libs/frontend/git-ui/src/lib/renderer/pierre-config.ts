import {
  registerCustomLanguage,
  registerCustomTheme,
  type FileDiffOptions,
  type ThemeRegistration,
} from '@pierre/diffs';

/**
 * `@pierre/diffs` configuration for the review renderer (implementation-plan
 * Component 17, Requirement 3.2). This module imports Pierre at runtime, so it
 * must only ever be reached through a lazy chunk — never from the git-ui
 * barrels the eager bundle imports.
 */

export type PierreDiffStyle = 'unified' | 'split';
export type PierreThemeMode = 'light' | 'dark';

/**
 * Fine-grained grammar loaders, one dynamic import per language, so the build
 * emits one small chunk per grammar and only the ones a rendered file needs are
 * fetched (research-report evidence row 1: ~58 KB gz for a realistic first
 * diff, against 1.8 MB gz for Shiki's whole `bundledLanguages` table).
 * Extensions not listed here fall back to Pierre's own lookup, which is lazy too.
 */
const LANGUAGES: ReadonlyArray<{
  readonly name: string;
  readonly load: () => Promise<{ default: unknown }>;
  readonly extensions: readonly string[];
}> = [
  {
    name: 'typescript',
    load: () => import('shiki/langs/typescript.mjs'),
    extensions: ['ts', 'mts', 'cts'],
  },
  {
    name: 'tsx',
    load: () => import('shiki/langs/tsx.mjs'),
    extensions: ['tsx'],
  },
  {
    name: 'javascript',
    load: () => import('shiki/langs/javascript.mjs'),
    extensions: ['js', 'mjs', 'cjs'],
  },
  {
    name: 'jsx',
    load: () => import('shiki/langs/jsx.mjs'),
    extensions: ['jsx'],
  },
  {
    name: 'json',
    load: () => import('shiki/langs/json.mjs'),
    extensions: ['json'],
  },
  {
    name: 'css',
    load: () => import('shiki/langs/css.mjs'),
    extensions: ['css'],
  },
  {
    name: 'scss',
    load: () => import('shiki/langs/scss.mjs'),
    extensions: ['scss'],
  },
  {
    name: 'html',
    load: () => import('shiki/langs/html.mjs'),
    extensions: ['html'],
  },
  {
    name: 'markdown',
    load: () => import('shiki/langs/markdown.mjs'),
    extensions: ['md'],
  },
  {
    name: 'yaml',
    load: () => import('shiki/langs/yaml.mjs'),
    extensions: ['yml', 'yaml'],
  },
];

/**
 * The light diff theme. Pierre's own `pierre-light` fails WCAG AA on the light
 * app theme (Batch 68 axe): its addition count is 3.2:1 on white, deletion
 * line numbers 4.4:1, and several token colours (#d5901c, #08c0ef) land
 * between 1.8:1 and 2.7:1 on the tinted change rows.
 *
 * GitHub Light High Contrast, which Shiki ships, clears 4.5:1 for the counts
 * (8.1:1), the line numbers (7.0:1) and every token on the change rows and
 * their word highlights, except comments (#66707b: 4.1:1 on a deleted row,
 * 3.2:1 under a word highlight). `ptah-light` is that theme with the comment
 * ink deepened to {@link LIGHT_COMMENT_INK} (6.4:1 and 4.9:1). The dark theme
 * stays `pierre-dark`.
 */
export const PIERRE_LIGHT_THEME = 'ptah-light';
const LIGHT_COMMENT_INK = '#4b535d';

/** `base` with every comment rule's foreground set to {@link LIGHT_COMMENT_INK}. */
export function createPtahLightTheme(
  base: ThemeRegistration,
): ThemeRegistration {
  return {
    ...base,
    name: PIERRE_LIGHT_THEME,
    displayName: 'Ptah Light',
    tokenColors: base.tokenColors?.map((rule) => {
      const scopes = Array.isArray(rule.scope) ? rule.scope : [rule.scope];
      return scopes.includes('comment') && rule.settings.foreground
        ? {
            ...rule,
            settings: { ...rule.settings, foreground: LIGHT_COMMENT_INK },
          }
        : rule;
    }),
  };
}

let resourcesRegistered = false;

/**
 * Register the grammar loaders and the `ptah-light` theme with Pierre once per
 * page. Pierre logs an error for a second registration of the same name, so
 * this is guarded. The theme must be registered before anything resolves
 * {@link PIERRE_HIGHLIGHT_OPTIONS}: the worker pool resolves themes on the main
 * thread and hands the resolved data to its workers.
 */
export function registerPierreResources(): void {
  if (resourcesRegistered) return;
  resourcesRegistered = true;
  for (const { name, load, extensions } of LANGUAGES) {
    registerCustomLanguage(
      name,
      load as Parameters<typeof registerCustomLanguage>[1],
      [...extensions],
    );
  }
  registerCustomTheme(PIERRE_LIGHT_THEME, () =>
    loadPtahLightTheme(
      () => import('shiki/themes/github-light-high-contrast.mjs'),
    ),
  );
}

/**
 * Plain dark-on-white text, used when the base theme's chunk cannot load: the
 * diff stays readable (16:1) without token colours instead of failing to
 * highlight at all.
 */
const PTAH_LIGHT_FALLBACK: ThemeRegistration = {
  name: PIERRE_LIGHT_THEME,
  displayName: 'Ptah Light',
  type: 'light',
  colors: { 'editor.background': '#ffffff', 'editor.foreground': '#1f2328' },
  tokenColors: [],
};

/**
 * `ptah-light` from the base theme `loadBase` imports, or the plain
 * {@link PTAH_LIGHT_FALLBACK} (logged) when that import fails.
 */
export async function loadPtahLightTheme(
  loadBase: () => Promise<{ default: unknown }>,
): Promise<ThemeRegistration> {
  try {
    return createPtahLightTheme(
      (await loadBase()).default as ThemeRegistration,
    );
  } catch (error: unknown) {
    console.error(
      '[pierre-config] Could not load the light diff theme; showing plain text colours.',
      error,
    );
    return PTAH_LIGHT_FALLBACK;
  }
}

/**
 * The webview's coarse light/dark marker, written by ThemeService on
 * `<html data-theme-mode>` (apps/ptah-extension-webview/src/styles.css:109-117).
 * Read rather than injected: the renderer must not import `@ptah-extension/core`.
 */
export function readDocumentThemeMode(): PierreThemeMode {
  return document.documentElement.getAttribute('data-theme-mode') === 'light'
    ? 'light'
    : 'dark';
}

/**
 * Highlighting options shared by every `FileDiff` and by the worker pool. With
 * a working pool Pierre takes `theme` and `lineDiffType` from the pool, not the
 * instance, so both must carry the same values.
 *
 * - `lineDiffType: 'word'` marks only the changed word regions. `'word-alt'`
 *   (Pierre's default) joins regions across a single character and
 *   `'word-line'` highlights whole lines (Gate 1.7 open item 2).
 * - `preferredHighlighter: 'shiki-js'`: the JavaScript regex engine. The WASM
 *   engine is the configuration the research measured at ~377 KB gz.
 * - `theme`: Pierre's own `pierre-dark` (its default dark theme, passing in
 *   the Batch 68 sweep) and {@link PIERRE_LIGHT_THEME}, which
 *   {@link registerPierreResources} registers. Literal names, so loading this
 *   module reads nothing from `@pierre/diffs`.
 */
export const PIERRE_HIGHLIGHT_OPTIONS = {
  preferredHighlighter: 'shiki-js',
  theme: { dark: 'pierre-dark', light: PIERRE_LIGHT_THEME },
  lineDiffType: 'word',
} as const;

/**
 * Focus ring for the code panes {@link labelPierreDiff} makes focusable.
 * Pierre's shadow root does not see the page's utility classes, so the ring is
 * injected through its `unsafeCSS` option (wrapped in Pierre's `unsafe` cascade
 * layer). Custom properties do cross the shadow boundary, so the ring uses the
 * theme's base-content ink, as the `focus-visible:outline-base-content`
 * controls elsewhere do.
 */
export const PIERRE_CODE_PANE_FOCUS_CSS = `
  code[data-code]:focus-visible {
    outline: 2px solid oklch(var(--bc, 60% 0 0));
    outline-offset: -2px;
  }
`;

/**
 * Options for one `FileDiff` instance: {@link PIERRE_HIGHLIGHT_OPTIONS} plus
 * `hunkSeparators: 'line-info'` with `expandUnchanged: false`, so collapsed
 * context is shown as a line count, never expanded by default.
 */
export function createPierreDiffOptions(
  diffStyle: PierreDiffStyle,
  themeType: PierreThemeMode,
): FileDiffOptions<undefined, undefined> {
  return {
    ...PIERRE_HIGHLIGHT_OPTIONS,
    themeType,
    diffStyle,
    hunkSeparators: 'line-info',
    expandUnchanged: false,
    unsafeCSS: PIERRE_CODE_PANE_FOCUS_CSS,
  };
}

/**
 * Name what Pierre renders unnamed, inside a diff's shadow root. Pierre 1.5.1
 * has no option for either. Called from `onPostRender`, which fires after
 * every mount and update, so elements Pierre creates or replaces are covered.
 *
 * - Code panes: the horizontally scrolling `<code data-unified|data-deletions|
 *   data-additions>` get a tab stop and a side-specific name (axe
 *   `scrollable-region-focusable`). `role="group"` is what allows the name:
 *   the implicit `code` role prohibits `aria-label`, and `region` would add a
 *   landmark per file.
 * - Expand buttons: the icon-only `[data-expand-button][role=button]` in the
 *   collapsed-context separators (axe `aria-command-name`).
 */
export function labelPierreDiff(
  root: ParentNode | null | undefined,
  fileName: string,
): void {
  if (!root) return;
  const file = fileName || 'file';
  for (const pane of Array.from(
    root.querySelectorAll<HTMLElement>('code[data-code]'),
  )) {
    const label = pane.hasAttribute('data-deletions')
      ? `Original lines of ${file}`
      : pane.hasAttribute('data-additions')
        ? `Changed lines of ${file}`
        : `Diff of ${file}`;
    if (pane.getAttribute('tabindex') !== '0')
      pane.setAttribute('tabindex', '0');
    if (pane.getAttribute('role') !== 'group')
      pane.setAttribute('role', 'group');
    setLabel(pane, label);
  }
  for (const button of Array.from(
    root.querySelectorAll<HTMLElement>(
      '[data-expand-button]:not([data-expand-all-button])',
    ),
  )) {
    setLabel(button, expandButtonLabel(button));
  }
}

function setLabel(element: HTMLElement, label: string): void {
  if (element.getAttribute('aria-label') !== label) {
    element.setAttribute('aria-label', label);
  }
}

/**
 * The name of one expand button, read from its separator. Pierre's separator
 * text is "N unmodified lines"; the count is used when it parses.
 *
 * A gap no longer than Pierre's expansion step has one button that reveals
 * all of it. A longer gap is "chunked": its buttons reveal one step at a time
 * from either edge (`data-expand-up` grows the gap's start, next to the change
 * above; `data-expand-down` its end, next to the change below) and Pierre adds
 * a separate, already-labelled "Expand all" button.
 */
function expandButtonLabel(button: HTMLElement): string {
  const wrapper = button.closest('[data-separator-wrapper]');
  const count = /\d+/.exec(
    wrapper?.querySelector('[data-unmodified-lines]')?.textContent ?? '',
  )?.[0];
  const lines =
    count === undefined
      ? 'hidden lines'
      : `${count} hidden ${count === '1' ? 'line' : 'lines'}`;
  if (!wrapper?.querySelector('[data-expand-all-button]')) {
    return `Show ${lines}`;
  }
  return button.hasAttribute('data-expand-up')
    ? `Show more of ${lines} after the change above`
    : `Show more of ${lines} before the change below`;
}
