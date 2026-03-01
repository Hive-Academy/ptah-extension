/**
 * Build a minimal environment for custom agent processes.
 *
 * Only passes platform-essential variables (PATH, HOME, TEMP, etc.)
 * plus the provider-specific auth variables (e.g., ANTHROPIC_API_KEY,
 * ANTHROPIC_BASE_URL, tier mappings). This prevents leaking sensitive
 * host environment variables to third-party API endpoints.
 *
 * Used by both PtahCliRegistry (for validation queries) and
 * PtahCliAdapter (for chat sessions).
 *
 * @param authEnv - Provider-specific environment variables
 * @returns Minimal env safe for custom agent processes
 */
import type { AuthEnv } from '@ptah-extension/shared';

export function buildSafeEnv(
  authEnv: AuthEnv
): Record<string, string | undefined> {
  return {
    // Platform essentials for process execution
    PATH: process.env['PATH'],
    HOME: process.env['HOME'],
    USERPROFILE: process.env['USERPROFILE'],
    // Temp directories (cross-platform)
    TMPDIR: process.env['TMPDIR'],
    TEMP: process.env['TEMP'],
    TMP: process.env['TMP'],
    // Windows system essentials
    APPDATA: process.env['APPDATA'],
    LOCALAPPDATA: process.env['LOCALAPPDATA'],
    SystemRoot: process.env['SystemRoot'],
    COMSPEC: process.env['COMSPEC'],
    // Locale
    LANG: process.env['LANG'],
    // Provider-specific auth and config (e.g., ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL)
    ...authEnv,
  };
}
