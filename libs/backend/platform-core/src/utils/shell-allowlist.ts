/**
 * Shell allowlist — the single source of truth for which `shell` values a
 * renderer may hand to a PTY spawn.
 *
 * Consumed on BOTH sides of the terminal spawn path so the two guards cannot
 * drift:
 *   - `terminal-rpc.schema.ts` (the RPC boundary refine, in `rpc-handlers`)
 *   - `pty-manager.service.ts` (the spawn-site defence, in `apps/ptah-electron`)
 *
 * Policy: a per-platform BASENAME allowlist with path separators rejected
 * outright. The caller may name a well-known shell (`bash`, `cmd.exe`, …) and
 * node-pty resolves it through the OS `PATH` — the standard trusted resolution.
 * The caller may NOT supply a path, so it cannot point the spawn at a binary in
 * a directory it controls (`/tmp/evil/bash`, `C:\\evil\\cmd.exe`, a UNC path),
 * which is the exact sideload primitive this guard closes.
 *
 * Pure function, `process.platform`-aware — like `workspace-path-guards.ts` in
 * this directory. Not a port: no `PLATFORM_TOKENS` entry, no adapter.
 */

/**
 * Allowed bare shell basenames on win32, compared case-insensitively.
 */
export const WIN_SHELLS: ReadonlySet<string> = new Set([
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'wsl.exe',
  'bash.exe',
]);

/**
 * Allowed bare shell basenames on POSIX platforms, compared case-sensitively.
 */
export const POSIX_SHELLS: ReadonlySet<string> = new Set([
  'bash',
  'sh',
  'zsh',
  'fish',
  'dash',
  'ksh',
]);

/**
 * Decide whether a renderer-supplied `shell` override is permitted.
 *
 * - `undefined` → `true`: absent means "use the host default", the common case.
 * - contains `/` or `\` → `false`: no attacker-chosen path (absolute, relative,
 *   or UNC), including `/bin/bash` and `C:\\Windows\\System32\\cmd.exe`.
 * - win32 → membership in {@link WIN_SHELLS}, case-insensitive.
 * - otherwise → membership in {@link POSIX_SHELLS}, case-sensitive.
 *
 * @param shell    The caller-supplied override, or `undefined` when absent.
 * @param platform Node platform string; defaults to `process.platform` so tests
 *                 can drive it explicitly and stay OS-independent.
 */
export function isAllowedShell(
  shell?: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  if (shell === undefined) return true;
  if (shell.includes('/') || shell.includes('\\')) return false;
  if (platform === 'win32') {
    return WIN_SHELLS.has(shell.toLowerCase());
  }
  return POSIX_SHELLS.has(shell);
}
