/**
 * `ptah harness` command stub.
 *
 * TASK_2026_104 Batch 2 — scaffold only. Real implementation lands in Batch 4
 * (idempotent `.ptah/` scaffolding, skill install, skill list).
 */

import type { GlobalOptions } from '../router.js';

export type HarnessSubcommand = 'init' | 'install-skill' | 'list-skills';

export interface HarnessOptions {
  subcommand: HarnessSubcommand;
  dir?: string;
  skills?: string;
  name?: string;
}

/**
 * Execute the `harness` command. Currently prints a "not yet implemented"
 * notice to stdout and returns exit code 0.
 */
export async function execute(
  opts: HarnessOptions,
  _globals: GlobalOptions,
): Promise<number> {
  process.stdout.write(
    `ptah harness ${opts.subcommand}: not yet implemented (TASK_2026_104 batch 2 scaffold)\n`,
  );
  return 0;
}
