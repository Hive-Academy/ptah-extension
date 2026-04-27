/**
 * `ptah profile` command — DEPRECATION SHIM (TASK_2026_104 B7).
 *
 * The agent surface replaces the profile surface. This shim writes a fixed
 * deprecation message to stderr and exits with `UsageError` (2). It does
 * NOT call `withEngine`, does NOT touch the DI container, and does NOT
 * resolve any services — by design, so unbootstrapped or broken workspaces
 * still receive a clean error.
 *
 * Locked by architect — DO NOT add behavior. The next release removes this
 * file entirely.
 */

import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';

export type ProfileSubcommand = 'apply' | 'list';

export interface ProfileOptions {
  subcommand: ProfileSubcommand;
  name?: string;
}

export interface ProfileStderrLike {
  write(chunk: string): boolean;
}

export interface ProfileExecuteHooks {
  stderr?: ProfileStderrLike;
}

/**
 * Locked deprecation message — referenced verbatim by `profile.spec.ts`.
 * Do NOT edit without updating the spec.
 */
export const PROFILE_DEPRECATION_MESSAGE =
  'Use `ptah agent install` instead. The `ptah profile` command will be removed in the next release.\n';

export async function execute(
  _opts: ProfileOptions,
  _globals: GlobalOptions,
  hooks: ProfileExecuteHooks = {},
): Promise<number> {
  const stderr: ProfileStderrLike = hooks.stderr ?? process.stderr;
  stderr.write(PROFILE_DEPRECATION_MESSAGE);
  return ExitCode.UsageError;
}
