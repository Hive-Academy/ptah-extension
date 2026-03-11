/**
 * ThemeService - Signal-based theme state management
 *
 * TASK_2025_100: DaisyUI Theme Consistency & Theme Toggle System
 *
 * This service provides centralized theme state management with:
 * - Signal-based reactive state (matching Angular 20+ patterns)
 * - Persistence via VSCodeService state API
 * - Automatic DOM data-theme attribute updates via effect()
 * - VS Code theme synchronization for initial state
 *
 * Theme Mapping:
 * - VS Code 'light' -> DaisyUI 'anubis-light'
 * - VS Code 'dark' -> DaisyUI 'anubis'
 * - VS Code 'high-contrast' -> DaisyUI 'anubis' (dark)
 */

import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';

/**
 * Available DaisyUI theme names
 * - 'anubis': Dark theme (Egyptian gold accent on dark background)
 * - 'anubis-light': Light theme (dark text on light background)
 */
export type ThemeName = 'anubis' | 'anubis-light';

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
   * Useful for conditional rendering based on theme
   */
  readonly isDarkMode = computed(() => this._currentTheme() === 'anubis');

  constructor() {
    // Initialize theme from VS Code theme setting
    this.initializeTheme();

    // Apply theme to DOM whenever signal changes
    // effect() runs after signal update, ensuring DOM stays in sync
    effect(() => {
      const theme = this._currentTheme();
      document.documentElement.setAttribute('data-theme', theme);
    });
  }

  /**
   * Initialize theme from VS Code theme setting
   *
   * Priority:
   * 1. VS Code theme from config (always sync with VS Code on load)
   * 2. Default to 'anubis' (dark)
   *
   * Note: We use VS Code's theme as the source of truth so the extension
   * always matches the user's VS Code color scheme on startup.
   * This ensures consistent UX - light VS Code = light extension.
   */
  private initializeTheme(): void {
    // Use VS Code theme as the default - always sync with VS Code on load
    const vscodeTheme = this.vscode.config().theme;
    if (vscodeTheme === 'light') {
      this._currentTheme.set('anubis-light');
    }
    // 'dark' and 'high-contrast' both map to 'anubis' (dark theme)
    // Default is already 'anubis', so no else branch needed
  }

  /**
   * Type guard to validate theme name
   */
  private isValidTheme(theme: unknown): theme is ThemeName {
    return theme === 'anubis' || theme === 'anubis-light';
  }

  /**
   * Set theme and persist preference
   *
   * @param theme - The theme to apply ('anubis' or 'anubis-light')
   */
  setTheme(theme: ThemeName): void {
    this._currentTheme.set(theme);
    this.vscode.setState(THEME_STATE_KEY, theme);
  }

  /**
   * Toggle between dark and light themes
   * Convenience method for theme toggle UI
   */
  toggleTheme(): void {
    const newTheme =
      this._currentTheme() === 'anubis' ? 'anubis-light' : 'anubis';
    this.setTheme(newTheme);
  }
}
