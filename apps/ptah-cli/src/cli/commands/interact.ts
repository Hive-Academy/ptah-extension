/**
 * `ptah interact` command stub.
 *
 * TASK_2026_104 Batch 2 — scaffold only. Real implementation lands in Batch 6
 * (persistent JSON-RPC 2.0 stdio loop with bidirectional task.submit /
 * task.cancel / session.shutdown / session.history handlers).
 */

import type { GlobalOptions } from '../router.js';

export interface InteractOptions {
  session?: string;
}

/**
 * Execute the `interact` command. Currently prints a "not yet implemented"
 * notice to stdout and returns exit code 0.
 */
export async function execute(
  _opts: InteractOptions,
  _globals: GlobalOptions,
): Promise<number> {
  process.stdout.write(
    `ptah interact: not yet implemented (TASK_2026_104 batch 2 scaffold)\n`,
  );
  return 0;
}
