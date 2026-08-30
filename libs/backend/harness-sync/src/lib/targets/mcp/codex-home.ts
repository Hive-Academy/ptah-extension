/**
 * Where Codex keeps its user-global state, resolved once for every reader and
 * writer of it.
 *
 * `~/.codex` is the DEFAULT, not the rule. `CODEX_HOME` relocates the whole
 * directory, and the config file then sits directly inside it rather than under
 * a nested `.codex`. Verified on codex-cli 0.150.1:
 *
 *     CODEX_HOME=/tmp/xyz codex doctor
 *       CODEX_HOME    /tmp/xyz (dir)
 *       config.toml   /tmp/xyz/config.toml
 *
 * The variable is not exotic — the `codex` binary carries ~80 references to it,
 * against 2 for `XDG_CONFIG_HOME` — and relocating a tool's dotfile directory is
 * ordinary practice on Linux and macOS. A module that hardcodes `~/.codex` reads
 * and writes a file Codex is not looking at, silently, which is the same class
 * of failure as the untrusted-project case next door.
 *
 * It lives in its own file because TWO modules need the same answer —
 * `CodexTomlMcpFacet` (home scope) and `codex-project-trust.ts` — and a facet
 * that wrote one path while the trust reader read another would be a bug that
 * only appears on a machine with the variable set.
 */

import { homedir } from 'os';
import { join } from 'path';

export interface CodexHomeOptions {
  /**
   * Pretend the user's home directory is this. Specs pass it so they never
   * touch the developer's own `~/.codex`.
   *
   * **An explicit `homeDir` PINS the resolution and suppresses the `CODEX_HOME`
   * lookup.** That is what keeps a spec hermetic on a developer machine that
   * happens to export the variable. No host passes it — it is specs-only — so
   * production always gets the environment's answer.
   */
  homeDir?: string;
  /** Explicit override, ahead of everything. Mostly for specs. */
  codexHome?: string;
}

/** The Codex home DIRECTORY: `$CODEX_HOME`, else `<home>/.codex`. */
export function codexHomeDir(options: CodexHomeOptions = {}): string {
  if (options.codexHome !== undefined && options.codexHome !== '') {
    return options.codexHome;
  }
  if (options.homeDir !== undefined) {
    return join(options.homeDir, '.codex');
  }
  const fromEnv = process.env['CODEX_HOME'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv;
  return join(homedir(), '.codex');
}

/** The user-global `config.toml` inside {@link codexHomeDir}. */
export function codexHomeConfigFile(options: CodexHomeOptions = {}): string {
  return join(codexHomeDir(options), 'config.toml');
}
