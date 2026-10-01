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
 * Options for one `FileDiff` instance.
 *
 * - `lineDiffType: 'word'` marks only the changed word regions. `'word-alt'`
 *   (Pierre's default) joins regions across a single character and
 *   `'word-line'` highlights whole lines (Gate 1.7 open item 2).
 * - `preferredHighlighter: 'shiki-js'`: the JavaScript regex engine. The WASM
 *   engine is the configuration the research measured at ~377 KB gz.
 * - `hunkSeparators: 'line-info'` with `expandUnchanged: false`: collapsed
 *   context is shown as a line count, never expanded by default.
 */
export function createPierreDiffOptions(
  diffStyle: PierreDiffStyle,
  themeType: PierreThemeMode,
): FileDiffOptions<undefined, undefined> {
  return {
    preferredHighlighter: 'shiki-js',
    theme: DEFAULT_THEMES,
    themeType,
    diffStyle,
    lineDiffType: 'word',
    hunkSeparators: 'line-info',
    expandUnchanged: false,
  };
}
