/**
 * Auth command runner — capability probe for runtimes that have no terminal.
 *
 * `IPlatformCommands.openTerminal(name, command)` is fire-and-forget and
 * returns `void`: the caller can neither await the command nor observe its
 * outcome. That is fine in VS Code, where the user sees a real terminal pane
 * and drives the login themselves. It is useless in the CLI/TUI runtime, where
 * `openTerminal` is a documented no-op — `auth:codexLogin` would spawn nothing
 * and still report success.
 *
 * Rather than change `IPlatformCommands` (which would silently reroute
 * Electron as well), this module defines an OPTIONAL, structurally-detected
 * capability. A platform adapter that can actually drive an interactive login
 * command implements `runAuthCommand`; handlers probe for it with
 * {@link asAuthCommandRunner} and fall back to the historical
 * `openTerminal` + optimistic-success path when it is absent. Runtimes that do
 * not implement it are bit-for-bit unaffected.
 */

import type { IPlatformCommands } from '@ptah-extension/platform-core';

/** Outcome of an interactive auth command driven by the platform adapter. */
export interface AuthCommandResult {
  /** True only when the process exited 0. */
  readonly success: boolean;
  /** Process exit code; null when the process was killed by a signal. */
  readonly exitCode: number | null;
  /** Human-readable failure reason. Present only when `success` is false. */
  readonly error?: string;
}

/** Parameters for {@link IAuthCommandRunner.runAuthCommand}. */
export interface AuthCommandRequest {
  /**
   * Provider registry id used to tag the push events emitted while the
   * command runs (e.g. `'openai-codex'`).
   */
  readonly provider: string;
  /** Display name — mirrors the `name` argument of `openTerminal`. */
  readonly name: string;
  /** Full command line, e.g. `codex login --device-auth`. */
  readonly command: string;
}

/**
 * Optional capability: run an interactive auth command to completion and
 * report the real outcome, streaming its output to the UI as push events.
 */
export interface IAuthCommandRunner {
  runAuthCommand(request: AuthCommandRequest): Promise<AuthCommandResult>;
}

/**
 * Narrow an `IPlatformCommands` to {@link IAuthCommandRunner} when the
 * concrete adapter implements the capability. Returns `undefined` otherwise,
 * which is the signal to use the `openTerminal` path.
 */
export function asAuthCommandRunner(
  commands: IPlatformCommands,
): IAuthCommandRunner | undefined {
  const candidate = commands as Partial<IAuthCommandRunner>;
  return typeof candidate.runAuthCommand === 'function'
    ? (candidate as IAuthCommandRunner)
    : undefined;
}
