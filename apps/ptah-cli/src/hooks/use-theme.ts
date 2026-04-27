/**
 * useTheme -- Terminal color theme for consistent TUI styling.
 *
 * Provides a centralized theme object so all components use consistent
 * colors for roles, status indicators, and UI chrome.
 *
 * Delegates to ThemeContext, which manages multi-theme switching and
 * persistence. Components should continue to call useTheme() — the
 * context wiring is an implementation detail.
 */

import { useThemeContext } from '../context/ThemeContext.js';

export interface TuiTheme {
  roles: {
    user: string;
    assistant: string;
    system: string;
  };
  status: {
    success: string;
    error: string;
    warning: string;
    info: string;
  };
  ui: {
    border: string;
    borderActive: string;
    borderSubtle: string;
    dimmed: string;
    accent: string;
    muted: string;
    brand: string;
  };
}

export function useTheme(): TuiTheme {
  const { theme } = useThemeContext();
  return theme;
}
