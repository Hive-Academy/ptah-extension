import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from 'react';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { TuiTheme } from '../hooks/use-theme.js';
import { THEMES, DEFAULT_THEME, type ThemeName } from '../lib/themes.js';
import { adaptTheme, resolveColorDepth } from '../lib/palette.js';

interface ThemeContextValue {
  theme: TuiTheme;
  themeName: ThemeName;
  setTheme: (name: ThemeName) => void;
  availableThemes: ThemeName[];
}

const ThemeCtx = createContext<ThemeContextValue | null>(null);

function getConfigPath(): string {
  return path.join(os.homedir(), '.ptah', 'tui-config.json');
}

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
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function persistTheme(name: ThemeName): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);

  fs.mkdirSync(dir, { recursive: true });

  let existing: Record<string, unknown> = {};
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed === 'object' && parsed !== null) {
      existing = parsed as Record<string, unknown>;
    }
  } catch {
    existing = {};
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

  // Adapted once here rather than at every call site, so components keep
  // reading `theme.ui.accent` and get whatever that colour has to become on
  // this terminal. See `lib/palette.ts` for why Ink cannot be trusted to
  // downsample the hex itself.
  const theme = useMemo(
    () =>
      adaptTheme(
        THEMES[themeName],
        resolveColorDepth(process.env),
        themeName === 'light' ? 'light' : 'dark',
      ),
    [themeName],
  );

  return (
    <ThemeCtx.Provider value={{ theme, themeName, setTheme, availableThemes }}>
      {children}
    </ThemeCtx.Provider>
  );
}

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
