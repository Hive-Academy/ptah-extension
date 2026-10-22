/**
 * ThemeService - Signal-based theme state management
 *
 * Provides centralized theme state management with:
 * - Signal-based reactive state (matching Angular 21+ patterns)
 * - Persistence via VSCodeService state API
 * - Automatic DOM data-theme attribute updates via effect()
 * - VS Code theme synchronization for initial state
 * - Support for all DaisyUI v4 prebuilt themes and custom Ptah/Anubis themes
 */

import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';

/**
 * All available DaisyUI theme names (custom + prebuilt)
 */
export type ThemeName =
  | 'ptah-glass'
  | 'ptah-glass-light'
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
  readonly glass?: boolean;
}

export type AccentName = 'gold' | 'rose' | 'moonstone';
export const ACCENTS: readonly AccentName[] = ['gold', 'rose', 'moonstone'];
export const DEFAULT_ACCENT: AccentName = 'gold';
/** C4 accent hex source, mirrored from glass/c4/accents.cjs and theme.config.js. */
export const ACCENT_COLORS = {
  'ptah-glass': {
    gold: { p: '#e4b94a', pc: '#1b1403', a: '#f6d675', b: '#d9a928', ink: '#1b1403', link: '#f0cf7a', focus: '#f2cd6b' },
    rose: { p: '#f2a9bd', pc: '#3a0a1a', a: '#f9c6d4', b: '#e98fab', ink: '#3a0a1a', link: '#ffc3d3', focus: '#ffd3df' },
    moonstone: { p: '#cfd6e6', pc: '#12151f', a: '#eef1f8', b: '#bcc4d6', ink: '#12151f', link: '#dfe5f2', focus: '#f2f5fb' },
  },
  'ptah-glass-light': {
    gold: { p: '#7c5700', pc: '#fff8e6', a: '#f6d675', b: '#dfac33', ink: '#241a02', link: '#6e4a00', focus: '#6e4a00' },
    rose: { p: '#a3265c', pc: '#fff1f6', a: '#f7b3c6', b: '#e97d9c', ink: '#3a0618', link: '#861d4a', focus: '#861d4a' },
    moonstone: { p: '#3d4560', pc: '#f4f6fb', a: '#5d678a', b: '#3f4766', ink: '#f4f6fb', link: '#363d58', focus: '#363d58' },
  },
} as const;
const ACCENT_STATE_KEY = 'ptah-accent';
const ACCENT_HINT_KEY = 'ptah-accent';
function isValidAccent(value: unknown): value is AccentName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(ACCENT_COLORS['ptah-glass'], value);
}

/**
 * Complete list of themes with display labels and dark/light classification.
 * Order matches DaisyUI's official theme list.
 */
export const DAISYUI_THEMES: readonly ThemeInfo[] = [
  { name: 'ptah-glass', label: 'Ptah Glass', isDark: true, glass: true },
  { name: 'ptah-glass-light', label: 'Ptah Glass Light', isDark: false, glass: true },
  { name: 'anubis', label: 'Anubis', isDark: true },
  { name: 'anubis-light', label: 'Anubis Light', isDark: false },
  { name: 'light', label: 'Light', isDark: false },
  { name: 'dark', label: 'Dark', isDark: true, glass: true },
  { name: 'cupcake', label: 'Cupcake', isDark: false, glass: true },
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
  { name: 'dracula', label: 'Dracula', isDark: true, glass: true },
  { name: 'cmyk', label: 'CMYK', isDark: false },
  { name: 'autumn', label: 'Autumn', isDark: false },
  { name: 'business', label: 'Business', isDark: true },
  { name: 'acid', label: 'Acid', isDark: false },
  { name: 'lemonade', label: 'Lemonade', isDark: false },
  { name: 'night', label: 'Night', isDark: true },
  { name: 'coffee', label: 'Coffee', isDark: true },
  { name: 'winter', label: 'Winter', isDark: false },
  { name: 'dim', label: 'Dim', isDark: true },
  { name: 'nord', label: 'Nord', isDark: false, glass: true },
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
 * The four themes compiled into the initial `styles.css`. Every other entry of
 * `DAISYUI_THEMES` lives in the deferred `theme-extra.css` sheet, which is
 * emitted by the build but not linked from `index.html`.
 */
const EAGER_THEMES: ReadonlySet<string> = new Set(['anubis', 'anubis-light', 'ptah-glass', 'ptah-glass-light']);

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
   * Default to Ptah glass (dark) to prevent flash of unstyled content
   */
  private readonly _currentTheme = signal<ThemeName>('ptah-glass');
  private readonly _accent = signal<AccentName>(DEFAULT_ACCENT);
  readonly accent = this._accent.asReadonly();

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
    this.initializeAccent();

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
      const info = DAISYUI_THEMES.find((item) => item.name === theme);
      if (info?.glass) {
        root.setAttribute('data-glass', 'on');
        root.setAttribute('data-glass-mode', info.isDark ? 'dark' : 'light');
      } else {
        root.removeAttribute('data-glass');
        root.removeAttribute('data-glass-mode');
      }
      const accent = this._accent();
      if (accent === DEFAULT_ACCENT) root.removeAttribute('data-accent');
      else root.setAttribute('data-accent', accent);
    });
  }

  /**
   * Initialize theme from persisted state or VS Code theme setting.
   *
   * Priority — the SAME source order the pre-paint script in
   * `apps/ptah-extension-webview/src/index.html` uses, and it must stay that
   * way:
   * 1. Persisted theme from `vscode.getState()` (authoritative)
   * 2. The `localStorage` mirror this service writes on every `setTheme`
   * 3. VS Code theme kind mapping (first-launch default)
   * 4. Default 'ptah-glass' (dark)
   *
   * Step 2 is not redundant. The pre-paint script has already applied the
   * user's theme from whichever of (1) or (2) answered first; if this service
   * then resolved only (1) and found it empty, it would fall through to the
   * default and its `data-theme` effect would REPAINT the correct pre-paint
   * theme back to `anubis` a frame later. That is not hypothetical: VS Code
   * discards a webview's `getState()` payload when the webview is disposed,
   * while `localStorage` is keyed to the origin and survives — so the mirror
   * is the only surviving record of the user's choice on exactly that path.
   */
  private initializeTheme(): void {
    const authoritative = this.vscode.getState<string>(THEME_STATE_KEY);
    const persisted = authoritative ?? this.readThemeHint();
    if (persisted && this.isValidTheme(persisted)) {
      this._currentTheme.set(persisted);
      // Re-arm the pre-paint hint. On the first launch after upgrade the
      // mirror does not exist yet, so a VS Code user on one of the 32 deferred
      // themes gets one last frame of `anubis` — exactly what happens on every
      // launch today. Writing it here means it does not happen again.
      this.writeThemeHint(persisted);
      if (authoritative === undefined) {
        // Recovered from the mirror: repair the authoritative store so the
        // choice does not depend on `localStorage` surviving alone.
        this.vscode.setState(THEME_STATE_KEY, persisted);
      }
      if (!EAGER_THEMES.has(persisted)) {
        // Sheet is normally already in the document (inserted render-blocking
        // by index.html). This covers the upgrade path above, where it is not.
        void this.loadDeferredThemeSheet();
      }
      return;
    }

    // Theme-kind fallback can only ever pick `ptah-glass-light`, which is in
    // styles.css — this path never needs the deferred sheet.
    const vscodeTheme = this.vscode.config().theme;
    if (vscodeTheme === 'light') {
      this._currentTheme.set('ptah-glass-light');
    }
  }

  private initializeAccent(): void {
    const state = this.vscode.getState<string>(ACCENT_STATE_KEY);
    let hint: string | null = null;
    try { hint = localStorage.getItem(ACCENT_HINT_KEY); } catch { /* optional mirror */ }
    const accent = isValidAccent(state) ? state : isValidAccent(hint) ? hint : DEFAULT_ACCENT;
    this._accent.set(accent);
    // Repair the authoritative store only when there is something to repair.
    // A present value that is not a valid accent (a retired name) is rewritten.
    // An absent key is rewritten only when the mirror holds a non-default
    // accent the state lost (rose / moonstone). An absent key plus the default
    // gold — including the hint this method itself writes below — is not a
    // lost choice: gold is already the meaning of "no key" in the pre-paint
    // script and in this service. Writing it would replace the whole state
    // record from a snapshot that can be stale next to concurrent
    // main-process writers (Electron webview state marker loss, PR #805),
    // and the first boot's gold hint would arm that write on the second boot.
    const mirrorLostNonDefault =
      isValidAccent(hint) && hint !== DEFAULT_ACCENT;
    if (state === undefined ? mirrorLostNonDefault : !isValidAccent(state)) {
      this.vscode.setState(ACCENT_STATE_KEY, accent);
    }
    try { localStorage.setItem(ACCENT_HINT_KEY, accent); } catch { /* optional mirror */ }
  }

  setAccent(accent: AccentName): void {
    if (!isValidAccent(accent)) return;
    this._accent.set(accent);
    this.vscode.setState(ACCENT_STATE_KEY, accent);
    try { localStorage.setItem(ACCENT_HINT_KEY, accent); } catch { /* optional mirror */ }
  }

  /**
   * Read the `localStorage` mirror written by {@link writeThemeHint}. Best
   * effort for the same reasons: storage can be unavailable, and an absent or
   * unreadable hint simply means the next fallback decides.
   */
  private readThemeHint(): string | undefined {
    try {
      return localStorage.getItem(THEME_HINT_KEY) ?? undefined;
    } catch {
      // degradation-audit: optional-capability - the localStorage hint only
      // buys one pre-paint frame of the correct theme at launch; where storage
      // is blocked, partitioned or over quota, `undefined` hands the decision
      // to the vscode.setState mirror and then the theme-kind fallback, both
      // of which already produce a correct theme without it.
      return undefined;
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
      this.insertDeferredSheet(sheet);
    });
    return this.deferredSheetLoad;
  }

  /**
   * Insert the deferred sheet BEFORE `styles.css`.
   *
   * Both sheets carry (0,1,0) selectors, so sheet order alone decides the
   * winner. `theme-extra.css` opens with daisyUI's `:root` copy of the `light`
   * theme, which would otherwise outrank the `[data-theme=anubis]` block in
   * `styles.css` and repaint both eager themes as `light`. Appending to
   * `<head>` puts it last, so it must be inserted, not appended. This mirrors
   * the pre-paint script in `apps/ptah-extension-webview/src/index.html`.
   */
  private insertDeferredSheet(sheet: HTMLLinkElement): void {
    const firstSheet = document.head.querySelector('link[rel="stylesheet"]');
    if (firstSheet) {
      document.head.insertBefore(sheet, firstSheet);
      return;
    }
    document.head.appendChild(sheet);
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
    const current = this._currentTheme();
    const isDark = DAISYUI_THEMES.find((theme) => theme.name === current)?.isDark;
    const newTheme = isDark ? 'ptah-glass-light' : 'ptah-glass';
    this.setTheme(newTheme);
  }
}
