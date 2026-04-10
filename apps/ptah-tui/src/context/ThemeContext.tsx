/**
 * ThemeContext -- Provides a shared theme to the entire component tree.
 *
 * Persists the user's chosen theme name to ~/.ptah/tui-config.json so it
 * survives across TUI sessions. All components that need colors should
 * read via useTheme() (which delegates here) rather than accessing this
 * context directly.
 */

import React, { createContext, useContext, useState, useCallback } from 'react';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TuiTheme } from '../hooks/use-theme.js';
import { THEMES, DEFAULT_THEME, type ThemeName } from '../lib/themes.js';

interface ThemeContextValue {
  theme: TuiTheme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
  availableThemes: ThemeName[];
}

const ThemeCtx = createContext<ThemeContextValue | null>(null);

/** Absolute path to the persisted config file. */
function getConfigPath(): string {
  return path.join(os.homedir(), '.ptah', 'tui-config.json');
}

/** Read persisted theme name, falling back to DEFAULT_THEME. */
function loadPersistedTheme(): ThemeName {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'theme' in parsed &&
      typeof (parsed as Record<string, unknown>)['theme'] === 'string'
    ) {
      const name = (parsed as Record<string, unknown>)['theme'] as string;
      if (name in THEMES) {
        return name as ThemeName;
      }
    }
  } catch {
    // File doesn't exist or is malformed — use default.
  }
  return DEFAULT_THEME;
}

/** Persist theme name to ~/.ptah/tui-config.json, merging with existing data. */
function persistTheme(name: ThemeName): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  // Ensure directory exists.
  fs.mkdirSync(dir, { recursive: true });

  // Merge with any existing config values to avoid clobbering other settings.
  let existing: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    // No existing file or bad JSON — start fresh.
  }

  existing['theme'] = name;
  fs.writeFileSync(configPath, JSON.stringify(existing, null, 2), 'utf-8');
}

const availableThemes = Object.keys(THEMES) as ThemeName[];

export function ThemeProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [themeName, setThemeName] = useState<ThemeName>(loadPersistedTheme);

  const setTheme = useCallback((name: ThemeName) => {
    setThemeName(name);
    persistTheme(name);
  }, []);

  const theme = THEMES[themeName];

  return (
    <ThemeCtx.Provider value={{ theme, themeName, setTheme, availableThemes }}>
      {children}
    </ThemeCtx.Provider>
  );
}

/**
 * Access the shared theme context. Must be called within a ThemeProvider.
 */
export function useThemeContext(): ThemeContextValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) {
    throw new Error(
      'useThemeContext must be used within a ThemeProvider. ' +
        'Ensure the App component wraps its children with <ThemeProvider>.',
    );
  }
  return ctx;
}
