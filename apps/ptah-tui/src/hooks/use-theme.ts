/**
 * useTheme -- Terminal color theme for consistent TUI styling.
 *
 * Provides a centralized theme object so all components use consistent
 * colors for roles, status indicators, and UI chrome.
 */

import { useMemo } from 'react';

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
  return useMemo<TuiTheme>(
    () => ({
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
    }),
    [],
  );
}
