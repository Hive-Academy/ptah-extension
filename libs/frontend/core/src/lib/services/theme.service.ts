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

  constructor() {
    this.initializeTheme();

    effect(() => {
      const theme = this._currentTheme();
      document.documentElement.setAttribute('data-theme', theme);
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
      return;
    }

    const vscodeTheme = this.vscode.config().theme;
    if (vscodeTheme === 'light') {
      this._currentTheme.set('anubis-light');
    }
  }

  /**
   * Type guard to validate theme name
   */
  private isValidTheme(theme: unknown): theme is ThemeName {
    return typeof theme === 'string' && ALL_THEME_NAMES.has(theme);
  }

  /**
   * Set theme and persist preference
   */
  setTheme(theme: ThemeName): void {
    this._currentTheme.set(theme);
    this.vscode.setState(THEME_STATE_KEY, theme);
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
