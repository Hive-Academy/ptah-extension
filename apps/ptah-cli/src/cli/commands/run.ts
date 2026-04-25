/**
 * `ptah run` command stub.
 *
 * TASK_2026_104 Batch 2 — scaffold only. Real implementation lands in Batch 5
 * (full DI bootstrap, agent SDK task submission, JSON-RPC streaming, stdio
 * approval gate).
 */

import type { GlobalOptions } from '../router.js';

export interface RunOptions {
  task: string;
}

/**
 * Execute the `run` command. Currently prints a "not yet implemented"
 * notice to stdout and returns exit code 0.
 */
export async function execute(
  _opts: RunOptions,
  _globals: GlobalOptions,
): Promise<number> {
  process.stdout.write(
    `ptah run: not yet implemented (TASK_2026_104 batch 2 scaffold)\n`,
  );
  return 0;
}
