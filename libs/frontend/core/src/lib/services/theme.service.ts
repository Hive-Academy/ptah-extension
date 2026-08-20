/**
 * ThemeService - Signal-based theme state management
 *
 * Provides centralized theme state management with:
 * - Signal-based reactive state (matching Angular 21+ patterns)
 * - Persistence via VSCodeService state API
 * - Automatic DOM data-theme attribute updates via effect()
 * - VS Code theme synchronization for initial state
 * - Support for all DaisyUI v4 prebuilt themes + custom Anubis themes
 */

import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';

/**
 * All available DaisyUI theme names (custom + prebuilt)
 */
export type ThemeName =
  | 'anubis'
  | 'anubis-light'
  | 'light'
  | 'dark'
  | 'cupcake'
  | 'bumblebee'
  | 'emerald'
  | 'corporate'
  | 'synthwave'
  | 'retro'
  | 'cyberpunk'
  | 'valentine'
  | 'halloween'
  | 'garden'
  | 'forest'
  | 'aqua'
  | 'lofi'
  | 'pastel'
  | 'fantasy'
  | 'wireframe'
  | 'black'
  | 'luxury'
  | 'dracula'
  | 'cmyk'
  | 'autumn'
  | 'business'
  | 'acid'
  | 'lemonade'
  | 'night'
  | 'coffee'
  | 'winter'
  | 'dim'
  | 'nord'
  | 'sunset';

/**
 * Theme metadata for the theme picker UI
 */
export interface ThemeInfo {
  readonly name: ThemeName;
  readonly label: string;
  readonly isDark: boolean;
}

/**
 * Complete list of themes with display labels and dark/light classification.
 * Order matches DaisyUI's official theme list.
 */
export const DAISYUI_THEMES: readonly ThemeInfo[] = [
  { name: 'anubis', label: 'Anubis', isDark: true },
  { name: 'anubis-light', label: 'Anubis Light', isDark: false },
  { name: 'light', label: 'Light', isDark: false },
  { name: 'dark', label: 'Dark', isDark: true },
  { name: 'cupcake', label: 'Cupcake', isDark: false },
  { name: 'bumblebee', label: 'Bumblebee', isDark: false },
  { name: 'emerald', label: 'Emerald', isDark: false },
  { name: 'corporate', label: 'Corporate', isDark: false },
  { name: 'synthwave', label: 'Synthwave', isDark: true },
  { name: 'retro', label: 'Retro', isDark: false },
  { name: 'cyberpunk', label: 'Cyberpunk', isDark: false },
  { name: 'valentine', label: 'Valentine', isDark: false },
  { name: 'halloween', label: 'Halloween', isDark: true },
  { name: 'garden', label: 'Garden', isDark: false },
  { name: 'forest', label: 'Forest', isDark: true },
  { name: 'aqua', label: 'Aqua', isDark: true },
  { name: 'lofi', label: 'Lofi', isDark: false },
  { name: 'pastel', label: 'Pastel', isDark: false },
  { name: 'fantasy', label: 'Fantasy', isDark: false },
  { name: 'wireframe', label: 'Wireframe', isDark: false },
  { name: 'black', label: 'Black', isDark: true },
  { name: 'luxury', label: 'Luxury', isDark: true },
  { name: 'dracula', label: 'Dracula', isDark: true },
  { name: 'cmyk', label: 'CMYK', isDark: false },
  { name: 'autumn', label: 'Autumn', isDark: false },
  { name: 'business', label: 'Business', isDark: true },
  { name: 'acid', label: 'Acid', isDark: false },
  { name: 'lemonade', label: 'Lemonade', isDark: false },
  { name: 'night', label: 'Night', isDark: true },
  { name: 'coffee', label: 'Coffee', isDark: true },
  { name: 'winter', label: 'Winter', isDark: false },
  { name: 'dim', label: 'Dim', isDark: true },
  { name: 'nord', label: 'Nord', isDark: false },
  { name: 'sunset', label: 'Sunset', isDark: true },
] as const;

/** Set of dark theme names for O(1) lookup */
const DARK_THEMES: ReadonlySet<string> = new Set(
  DAISYUI_THEMES.filter((t) => t.isDark).map((t) => t.name),
);

/** Set of all valid theme names for validation */
const ALL_THEME_NAMES: ReadonlySet<string> = new Set(
  DAISYUI_THEMES.map((t) => t.name),
);

/**
 * State storage key for theme persistence
 */
const THEME_STATE_KEY = 'theme';

/**
 * The two themes compiled into the initial `styles.css`. Every other entry of
 * `DAISYUI_THEMES` lives in the deferred `theme-extra.css` sheet, which is
 * emitted by the build but not linked from `index.html`.
 */
const EAGER_THEMES: ReadonlySet<string> = new Set(['anubis', 'anubis-light']);

/**
 * `localStorage` mirror of the persisted theme.
 *
 * `vscode.getState()` is the authoritative store, but it is unreachable from
 * `index.html`'s pre-paint script inside the VS Code webview (the host injects
 * `acquireVsCodeApi()` at the end of `<body>`). `localStorage` is readable
 * synchronously in `<head>` in both hosts, so the pre-paint script uses this
 * mirror to decide whether it must block the first paint on `theme-extra.css`.
 *
 * Must match the key read by `apps/ptah-extension-webview/src/index.html`.
 */
const THEME_HINT_KEY = 'ptah-theme';

/** Non-fetching `<link>` in `index.html` that carries the deferred sheet URL. */
const DEFERRED_SHEET_MARKER_ID = 'ptah-theme-extra';

/** id of the real `<link rel="stylesheet">` once the deferred sheet is in. */
const DEFERRED_SHEET_LINK_ID = 'ptah-theme-extra-sheet';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly vscode = inject(VSCodeService);

  /**
   * Private mutable signal for current theme
   * Default to 'anubis' (dark) to prevent flash of unstyled content
   */
  private readonly _currentTheme = signal<ThemeName>('anubis');

  /**
   * Public readonly signal for current theme
   * Components should use this to react to theme changes
   */
  readonly currentTheme = this._currentTheme.asReadonly();

  /**
   * Computed signal indicating if dark mode is active
   */
  readonly isDarkMode = computed(() => DARK_THEMES.has(this._currentTheme()));

  /**
   * In-flight (or settled) load of `theme-extra.css`. `null` until something
   * asks for a deferred theme.
   */
  private deferredSheetLoad: Promise<void> | null = null;

  /** True once `theme-extra.css` is known to be applied to the document. */
  private deferredSheetReady = false;

  constructor() {
    // The pre-paint script in index.html inserts the sheet render-blocking, so
    // if the link is already here the sheet has already been applied.
    if (document.getElementById(DEFERRED_SHEET_LINK_ID)) {
      this.deferredSheetReady = true;
      this.deferredSheetLoad = Promise.resolve();
    }

    this.initializeTheme();

    effect(() => {
      const theme = this._currentTheme();
      const root = document.documentElement;
      root.setAttribute('data-theme', theme);
      // Expose a coarse light/dark marker so brand tokens (e.g. --ptah-gold)
      // can adapt to ANY selected daisyUI theme without per-theme CSS.
      root.setAttribute(
        'data-theme-mode',
        DARK_THEMES.has(theme) ? 'dark' : 'light',
      );
    });
  }

  /**
   * Initialize theme from persisted state or VS Code theme setting.
   *
   * Priority:
   * 1. Persisted theme from VS Code state (user's last selection)
   * 2. VS Code theme kind mapping (first-launch default)
   * 3. Default 'anubis' (dark)
   */
  private initializeTheme(): void {
    const persisted = this.vscode.getState<string>(THEME_STATE_KEY);
    if (persisted && this.isValidTheme(persisted)) {
      this._currentTheme.set(persisted);
      // Re-arm the pre-paint hint. On the first launch after upgrade the
      // mirror does not exist yet, so a VS Code user on one of the 32 deferred
      // themes gets one last frame of `anubis` — exactly what happens on every
      // launch today. Writing it here means it does not happen again.
      this.writeThemeHint(persisted);
      if (!EAGER_THEMES.has(persisted)) {
        // Sheet is normally already in the document (inserted render-blocking
        // by index.html). This covers the upgrade path above, where it is not.
        void this.loadDeferredThemeSheet();
      }
      return;
    }

    // Theme-kind fallback can only ever pick `anubis-light`, which is in
    // styles.css — this path never needs the deferred sheet.
    const vscodeTheme = this.vscode.config().theme;
    if (vscodeTheme === 'light') {
      this._currentTheme.set('anubis-light');
    }
  }

  /**
   * Mirror the theme into `localStorage` for the pre-paint script. Best effort:
   * storage can be unavailable (disabled, quota, partitioned context) and a
   * failure here only costs one frame of the default theme on the next launch.
   */
  private writeThemeHint(theme: ThemeName): void {
    try {
      localStorage.setItem(THEME_HINT_KEY, theme);
    } catch {
      /* storage unavailable — the hint is an optimisation, not the source */
    }
  }

  /**
   * Insert `theme-extra.css` if it is not already present.
   *
   * Returns `null` when this document carries no deferred sheet at all (unit
   * tests, the extension host's fallback HTML) — callers must then apply the
   * theme immediately rather than wait forever.
   */
  private loadDeferredThemeSheet(): Promise<void> | null {
    if (this.deferredSheetLoad) {
      return this.deferredSheetLoad;
    }

    const marker = document.getElementById(DEFERRED_SHEET_MARKER_ID);
    const url = marker instanceof HTMLLinkElement ? marker.href : '';
    if (!url) {
      return null;
    }

    this.deferredSheetLoad = new Promise<void>((resolve) => {
      const settle = (): void => {
        // Resolve on error too: a missing sheet must not strand the picker on
        // the old theme. The user gets `:root` (anubis) variables instead.
        this.deferredSheetReady = true;
        resolve();
      };
      const sheet = document.createElement('link');
      sheet.id = DEFERRED_SHEET_LINK_ID;
      sheet.rel = 'stylesheet';
      sheet.href = url;
      sheet.addEventListener('load', settle, { once: true });
      sheet.addEventListener('error', settle, { once: true });
      document.head.appendChild(sheet);
    });
    return this.deferredSheetLoad;
  }

  /**
   * Type guard to validate theme name
   */
  private isValidTheme(theme: unknown): theme is ThemeName {
    return typeof theme === 'string' && ALL_THEME_NAMES.has(theme);
  }

  /**
   * Set theme and persist preference.
   *
   * Persistence is always synchronous. Application is synchronous too, except
   * for the FIRST switch in a session to one of the 32 deferred themes: those
   * live in `theme-extra.css`, and flipping `data-theme` before that sheet
   * lands would leave `[data-theme=<x>]` matching nothing, so the UI would fall
   * back to the `:root` (anubis) variables — a dark flicker for anyone
   * switching between two light themes. Waiting for the sheet costs one local
   * read; every later switch is synchronous again.
   */
  setTheme(theme: ThemeName): void {
    this.vscode.setState(THEME_STATE_KEY, theme);
    this.writeThemeHint(theme);

    if (EAGER_THEMES.has(theme) || this.deferredSheetReady) {
      this._currentTheme.set(theme);
      return;
    }

    const pending = this.loadDeferredThemeSheet();
    if (!pending) {
      this._currentTheme.set(theme);
      return;
    }
    void pending.then(() => this._currentTheme.set(theme));
  }

  /**
   * Toggle between dark and light themes (legacy convenience method)
   */
  toggleTheme(): void {
    const newTheme =
      this._currentTheme() === 'anubis' ? 'anubis-light' : 'anubis';
    this.setTheme(newTheme);
  }
}
