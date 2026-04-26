/**
 * `ptah execute-spec` command — execute a stored spec via the Team Leader.
 *
 * TASK_2026_104 Sub-batch B10d. Replaces the Batch 2 27-line stub.
 *
 * Resolves `<cwd>/.ptah/specs/<id>/{task-description,implementation-plan}.md`,
 * builds a Team Leader execution prompt that interpolates both files'
 * contents, and delegates to `executeSessionStart` from `session.ts:B10c`.
 *
 * Failure modes (all exit 1, `ptah_code: 'unknown'`):
 *   - missing `--id`
 *   - spec folder missing (TASK_DOES_NOT_EXIST)
 *   - either of the two required files missing
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import { executeSessionStart } from './session.js';

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
 * Build the Team Leader execution prompt. Single template literal — kept
 * minimal because the Team Leader sub-agent has its own system prompt that
 * already understands batch coordination. The interpolated task-description
 * + implementation-plan provide the per-task context.
 *
 * NOTE: a search of the codebase (B10_EXPANSION § B10d guidance) for
 * `team_leader` / `team-leader-prompt` / `teamLeaderPrompt` and the Electron
 * `wizard:run` flow returned no canonical Ptah-side template, so this
 * inline template is authored fresh per the spec's fallback path.
 */
export function buildTeamLeaderPrompt(
  specId: string,
  taskDescription: string,
  implementationPlan: string,
): string {
  return [
    'You are coordinating execution of a pre-planned task.',
    '',
    `Task ID: ${specId}`,
    '',
    '## Task description',
    taskDescription,
    '',
    '## Implementation plan',
    implementationPlan,
    '',
    'Execute the plan. Coordinate sub-agents per the implementation-plan batch breakdown. After each batch, run the validation gates (typecheck, test, lint, build) for the affected workspaces. Report progress before each batch and verification results after each batch. Halt and surface any blocker rather than improvising.',
  ].join('\n');
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

  // ---- 1. Validate --id was supplied ---------------------------------------
  const specId = opts.id?.trim();
  if (!specId) {
    await formatter.writeNotification('task.error', {
      ptah_code: 'unknown',
      message: 'execute-spec requires --id',
      command: 'execute-spec',
    });
    return ExitCode.GeneralError;
  }

  // ---- 2. Resolve + read required files ------------------------------------
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

  // ---- 3. Build the Team Leader prompt -------------------------------------
  const prompt = buildTeamLeaderPrompt(
    specId,
    taskDescription,
    implementationPlan,
  );

  // ---- 4. Delegate to `session start` (single-turn) ------------------------
  // The B10c `executeSessionStart` signature treats `task` as the free-form
  // prompt forwarded to `chat:start`, so we pass the built Team Leader prompt
  // as `task`. `once: true` — execute-spec is a one-shot.
  return delegate(
    {
      task: prompt,
      once: true,
      cwd,
    },
    globals,
  );
}
