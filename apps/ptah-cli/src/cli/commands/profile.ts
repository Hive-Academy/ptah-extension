/**
 * `ptah profile` command stub.
 *
 * TASK_2026_104 Batch 2 — scaffold only. Real implementation lands in Batch 4
 * (content-diff aware profile apply, registry list).
 */

import type { GlobalOptions } from '../router.js';

export type ProfileSubcommand = 'apply' | 'list';

export interface ProfileOptions {
  subcommand: ProfileSubcommand;
  name?: string;
}

/**
 * Execute the `profile` command. Currently prints a "not yet implemented"
 * notice to stdout and returns exit code 0.
 */
export async function execute(
  opts: ProfileOptions,
  _globals: GlobalOptions,
): Promise<number> {
  process.stdout.write(
    `ptah profile ${opts.subcommand}: not yet implemented (TASK_2026_104 batch 2 scaffold)\n`,
  );
  return 0;
}
