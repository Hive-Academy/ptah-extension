/**
 * `ptah run` command — thin deprecation alias for `ptah session start --task`.
 *
 * Prints a single-line deprecation notice on stderr (so JSON-RPC stdout stays
 * clean) and delegates to `executeSessionStart` from `session.ts`.
 *
 * `ptah run` will be removed in the next release; callers should migrate to
 * `ptah session start --task <text>`.
 */

import type { GlobalOptions } from '../router.js';
import { executeSessionStart } from './session.js';

export interface RunOptions {
  /** Free-form task prompt (required by Commander). */
  task: string;
  /** Optional sub-agent profile to forward to `session start`. */
  profile?: string;
}

/**
 * Execute the `run` command. Always single-turn (`once: true`) — `ptah run`
 * never streamed beyond a single task in any released version.
 */
export async function execute(
  opts: RunOptions,
  globals: GlobalOptions,
): Promise<number> {
  process.stderr.write(
    "Use 'ptah session start --task <task>' instead. The 'ptah run' alias will be removed in the next release.\n",
  );

  return executeSessionStart(
    {
      task: opts.task,
      once: true,
      profile: opts.profile,
      cwd: globals.cwd,
    },
    globals,
  );
}
