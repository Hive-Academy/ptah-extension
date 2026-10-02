import {
  DEFAULT_THEMES,
  registerCustomLanguage,
  type FileDiffOptions,
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

let languagesRegistered = false;

/**
 * Register the grammar loaders with Pierre once per page. Pierre logs an error
 * for a second registration of the same name, so this is guarded.
 */
export function registerPierreLanguages(): void {
  if (languagesRegistered) return;
  languagesRegistered = true;
  for (const { name, load, extensions } of LANGUAGES) {
    registerCustomLanguage(
      name,
      load as Parameters<typeof registerCustomLanguage>[1],
      [...extensions],
    );
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
 */
export const PIERRE_HIGHLIGHT_OPTIONS = {
  preferredHighlighter: 'shiki-js',
  theme: DEFAULT_THEMES,
  lineDiffType: 'word',
} as const;

/**
 * Focus ring for the code panes {@link labelPierreCodePanes} makes focusable.
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
 * Make Pierre's horizontally scrolling code panes keyboard-reachable (axe
 * `scrollable-region-focusable`). Pierre 1.5.1 has no option for this: its
 * `<code data-unified|data-deletions|data-additions>` panes are rendered
 * without a tabindex or a name. Called from `onPostRender`, which fires after
 * every mount and update, so panes Pierre creates or replaces are covered.
 *
 * `role="group"` is what allows the name: the implicit `code` role prohibits
 * `aria-label`, and `region` would add a landmark per file.
 */
export function labelPierreCodePanes(
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
    if (pane.getAttribute('tabindex') !== '0') pane.setAttribute('tabindex', '0');
    if (pane.getAttribute('role') !== 'group') pane.setAttribute('role', 'group');
    if (pane.getAttribute('aria-label') !== label) {
      pane.setAttribute('aria-label', label);
    }
  }
}
