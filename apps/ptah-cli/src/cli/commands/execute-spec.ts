/**
 * `ptah execute-spec` command stub.
 *
 * TASK_2026_104 Batch 2 — scaffold only. Real implementation lands in Batch 5
 * (resolve `<cwd>/.ptah/specs/TASK_xxx/`, validate required files, invoke
 * Team Leader execution, stream events).
 */

import type { GlobalOptions } from '../router.js';

export interface ExecuteSpecOptions {
  id: string;
}

/**
 * Execute the `execute-spec` command. Currently prints a "not yet implemented"
 * notice to stdout and returns exit code 0.
 */
export async function execute(
  _opts: ExecuteSpecOptions,
  _globals: GlobalOptions,
): Promise<number> {
  process.stdout.write(
    `ptah execute-spec: not yet implemented (TASK_2026_104 batch 2 scaffold)\n`,
  );
  return 0;
}
