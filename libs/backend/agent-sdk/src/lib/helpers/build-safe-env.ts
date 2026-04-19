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
import { buildTierEnvDefaults } from './sdk-model-service';

export function buildSafeEnv(
  authEnv: AuthEnv,
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
    // Windows system essentials (required for subprocess spawning & cmd.exe)
    APPDATA: process.env['APPDATA'],
    LOCALAPPDATA: process.env['LOCALAPPDATA'],
    SystemRoot: process.env['SystemRoot'],
    COMSPEC: process.env['COMSPEC'],
    HOMEDRIVE: process.env['HOMEDRIVE'],
    HOMEPATH: process.env['HOMEPATH'],
    windir: process.env['windir'],
    PROGRAMFILES: process.env['PROGRAMFILES'],
    'PROGRAMFILES(X86)': process.env['PROGRAMFILES(X86)'],
    PROGRAMDATA: process.env['PROGRAMDATA'],
    CommonProgramFiles: process.env['CommonProgramFiles'],
    // Processor info (some tools check these)
    NUMBER_OF_PROCESSORS: process.env['NUMBER_OF_PROCESSORS'],
    PROCESSOR_ARCHITECTURE: process.env['PROCESSOR_ARCHITECTURE'],
    OS: process.env['OS'],
    // Node.js essentials (required for SDK subagent subprocess spawning)
    NODE_OPTIONS: process.env['NODE_OPTIONS'],
    NODE_PATH: process.env['NODE_PATH'],
    NODE_ENV: process.env['NODE_ENV'],
    // npm/pnpm config (needed for module resolution in subprocesses)
    npm_config_prefix: process.env['npm_config_prefix'],
    npm_config_cache: process.env['npm_config_cache'],
    // XDG directories (Linux/macOS config paths)
    XDG_CONFIG_HOME: process.env['XDG_CONFIG_HOME'],
    XDG_DATA_HOME: process.env['XDG_DATA_HOME'],
    XDG_CACHE_HOME: process.env['XDG_CACHE_HOME'],
    // Locale
    LANG: process.env['LANG'],
    LC_ALL: process.env['LC_ALL'],
    // Terminal
    TERM: process.env['TERM'],
    SHELL: process.env['SHELL'],
    // Guarantee tier env vars so subprocesses can resolve bare tier names
    ...buildTierEnvDefaults(authEnv),
    // Provider-specific auth and config (e.g., ANTHROPIC_API_KEY, ANTHROPIC_BASE_URL)
    // Spread AFTER tier defaults so explicit authEnv overrides take precedence
    ...authEnv,
    // Disable experimental betas for any non-Anthropic base URL — prevents the SDK
    // from enabling context-management-2025-06-27 which third-party endpoints don't support
    ...(() => {
      const baseUrl = authEnv.ANTHROPIC_BASE_URL?.trim();
      return baseUrl && !/^https?:\/\/api\.anthropic\.com\/?$/i.test(baseUrl)
        ? { CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }
        : {};
    })(),
  };
}
