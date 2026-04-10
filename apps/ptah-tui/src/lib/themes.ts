/**
 * Theme definitions for the Ptah TUI.
 *
 * Provides 6 terminal-friendly color palettes that map to the TuiTheme
 * interface. The 'dark' palette preserves the original hardcoded values
 * from use-theme.ts.
 */

import type { TuiTheme } from '../hooks/use-theme.js';

export type ThemeName =
  | 'dark'
  | 'light'
  | 'monokai'
  | 'dracula'
  | 'nord'
  | 'solarized-dark';

export const DEFAULT_THEME: ThemeName = 'dark';

export const THEMES: Record<ThemeName, TuiTheme> = {
  /**
   * Default dark theme — matches the original hardcoded palette.
   */
  dark: {
    roles: {
      user: '#10b981',
      assistant: '#06b6d4',
      system: '#f59e0b',
    },
    status: {
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b',
      info: '#3b82f6',
    },
    ui: {
      border: '#374151',
      borderActive: '#06b6d4',
      borderSubtle: '#1f2937',
      dimmed: '#6b7280',
      accent: '#06b6d4',
      muted: '#9ca3af',
      brand: '#7c3aed',
    },
  },

  /**
   * Light theme — high-contrast colors for light terminal backgrounds.
   */
  light: {
    roles: {
      user: '#059669',
      assistant: '#0891b2',
      system: '#d97706',
    },
    status: {
      success: '#059669',
      error: '#dc2626',
      warning: '#d97706',
      info: '#2563eb',
    },
    ui: {
      border: '#d1d5db',
      borderActive: '#0891b2',
      borderSubtle: '#e5e7eb',
      dimmed: '#6b7280',
      accent: '#0891b2',
      muted: '#4b5563',
      brand: '#6d28d9',
    },
  },

  /**
   * Monokai — warm, vibrant colors inspired by the classic editor theme.
   */
  monokai: {
    roles: {
      user: '#a6e22e',
      assistant: '#66d9ef',
      system: '#e6db74',
    },
    status: {
      success: '#a6e22e',
      error: '#f92672',
      warning: '#e6db74',
      info: '#66d9ef',
    },
    ui: {
      border: '#49483e',
      borderActive: '#66d9ef',
      borderSubtle: '#3e3d32',
      dimmed: '#75715e',
      accent: '#f92672',
      muted: '#a59f85',
      brand: '#ae81ff',
    },
  },

  /**
   * Dracula — purple/pink/cyan palette from the popular Dracula theme.
   */
  dracula: {
    roles: {
      user: '#50fa7b',
      assistant: '#8be9fd',
      system: '#f1fa8c',
    },
    status: {
      success: '#50fa7b',
      error: '#ff5555',
      warning: '#f1fa8c',
      info: '#8be9fd',
    },
    ui: {
      border: '#44475a',
      borderActive: '#bd93f9',
      borderSubtle: '#383a59',
      dimmed: '#6272a4',
      accent: '#bd93f9',
      muted: '#9fa8c4',
      brand: '#ff79c6',
    },
  },

  /**
   * Nord — cool, arctic blue palette from the Nord color scheme.
   */
  nord: {
    roles: {
      user: '#a3be8c',
      assistant: '#88c0d0',
      system: '#ebcb8b',
    },
    status: {
      success: '#a3be8c',
      error: '#bf616a',
      warning: '#ebcb8b',
      info: '#5e81ac',
    },
    ui: {
      border: '#3b4252',
      borderActive: '#88c0d0',
      borderSubtle: '#2e3440',
      dimmed: '#616e88',
      accent: '#88c0d0',
      muted: '#8fbcbb',
      brand: '#b48ead',
    },
  },

  /**
   * Solarized Dark — Ethan Schoonover's warm-tinted dark palette.
   */
  'solarized-dark': {
    roles: {
      user: '#859900',
      assistant: '#2aa198',
      system: '#b58900',
    },
    status: {
      success: '#859900',
      error: '#dc322f',
      warning: '#b58900',
      info: '#268bd2',
    },
    ui: {
      border: '#073642',
      borderActive: '#2aa198',
      borderSubtle: '#002b36',
      dimmed: '#586e75',
      accent: '#2aa198',
      muted: '#839496',
      brand: '#6c71c4',
    },
  },
};
