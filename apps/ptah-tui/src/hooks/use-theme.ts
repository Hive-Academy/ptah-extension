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
