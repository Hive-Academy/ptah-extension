/**
 * `ptah execute-spec` command — execute a stored spec via the Team Leader.
 *
 * Resolves `<cwd>/.ptah/specs/<id>/{task-description,implementation-plan}.md`,
 * builds a Team Leader execution prompt that interpolates both files'
 * contents, and delegates to `executeSessionStart` from `session.ts:B10c`.
 *
 * Failure modes (all exit 1, `ptah_code: 'unknown'`):
 *   - missing `--id`
 *   - spec folder missing
 *   - either of the two required files missing
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import { executeSessionStart } from './session.js';
import { buildTeamLeaderPrompt } from './team-leader-prompt.js';

/**
 * Re-export the shared Team Leader prompt builder so existing call sites
 * (`session_submit` MCP tool, future Team Leader consumers) can import it
 * from a single canonical module.
 */
export { buildTeamLeaderPrompt };

export interface ExecuteSpecOptions {
  /** Task spec id (e.g. `TASK_2026_104`). Required. */
  id?: string;
}

export interface ExecuteSpecHooks {
  formatter?: Formatter;
  /** Override hook for tests — defaults to `node:fs/promises.readFile`. */
  readFile?: (p: string) => Promise<string>;
  /** Override hook for tests — defaults to delegating into B10c. */
  executeSessionStart?: typeof executeSessionStart;
}

/**
 * Execute the `execute-spec` command. Validates the spec folder layout, reads
 * both required files, builds a Team Leader prompt, and delegates to
 * `executeSessionStart({ task: <prompt>, once: true, ... })`.
 */
export async function execute(
  opts: ExecuteSpecOptions,
  globals: GlobalOptions,
  hooks: ExecuteSpecHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const readFile = hooks.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const delegate = hooks.executeSessionStart ?? executeSessionStart;
  const specId = opts.id?.trim();
  if (!specId) {
    await formatter.writeNotification('task.error', {
      ptah_code: 'unknown',
      message: 'execute-spec requires --id',
      command: 'execute-spec',
    });
    return ExitCode.GeneralError;
  }
  const cwd = globals.cwd;
  const specDir = path.join(cwd, '.ptah', 'specs', specId);
  const taskDescPath = path.join(specDir, 'task-description.md');
  const implPlanPath = path.join(specDir, 'implementation-plan.md');

  let taskDescription: string;
  try {
    taskDescription = await readFile(taskDescPath);
  } catch {
    await formatter.writeNotification('task.error', {
      ptah_code: 'unknown',
      message: 'spec folder not found',
      spec_id: specId,
      command: 'execute-spec',
    });
    return ExitCode.GeneralError;
  }

  let implementationPlan: string;
  try {
    implementationPlan = await readFile(implPlanPath);
  } catch {
    await formatter.writeNotification('task.error', {
      ptah_code: 'unknown',
      message: 'spec folder not found',
      spec_id: specId,
      command: 'execute-spec',
    });
    return ExitCode.GeneralError;
  }
  const prompt = buildTeamLeaderPrompt(
    specId,
    taskDescription,
    implementationPlan,
  );
  return delegate(
    {
      task: prompt,
      once: true,
      cwd,
    },
    globals,
  );
}
