/**
 * `ptah new-project` command — New Project Wizard surface.
 *
 * TASK_2026_104 Sub-batch B9b. Backed by the New Project Wizard handlers
 * inside `SetupRpcHandlers` (registered globally via `registerAllRpcHandlers
 * ()`):
 *
 *   select-type <type>            RPC `wizard:new-project-select-type` →
 *                                 emits `new_project.session.started`
 *   submit-answers --file <path>  RPC `wizard:new-project-submit-answers` →
 *                                 emits `new_project.answers.received`
 *                                 (or `task.error` on `success: false`)
 *   get-plan <session-id>         RPC `wizard:new-project-get-plan` →
 *                                 emits `new_project.plan`
 *   approve-plan <session-id>     RPC `wizard:new-project-approve-plan
 *                                 { approved: true }` → emits
 *                                 `new_project.plan.approved`
 *
 * The `<session-id>` argument on `get-plan` / `approve-plan` is currently
 * advisory — the backend stores per-workspace, not per-session — but we
 * accept it for forward compat so consumers can adopt the surface today.
 *
 * `submit-answers` reads a JSON file off disk and validates that the
 * required top-level fields (`projectType`, `projectName`, `answers`) are
 * present BEFORE bootstrapping DI. Schema-invalid files exit 2 (UsageError).
 */

import { promises as fs } from 'node:fs';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
  WizardNewProjectSelectTypeResult,
  WizardNewProjectSubmitAnswersResult,
  WizardNewProjectGetPlanResult,
  WizardNewProjectApprovePlanResult,
  NewProjectType,
  DiscoveryAnswers,
} from '@ptah-extension/shared';

export type NewProjectSubcommand =
  | 'select-type'
  | 'submit-answers'
  | 'get-plan'
  | 'approve-plan';

export interface NewProjectOptions {
  subcommand: NewProjectSubcommand;
  /** For `select-type` — the project type id (e.g. full-saas, nestjs-api). */
  projectType?: string;
  /** For `submit-answers` — path to a JSON file with the answers payload. */
  file?: string;
  /** For `get-plan` / `approve-plan` — advisory session id. */
  sessionId?: string;
}

export interface NewProjectStderrLike {
  write(chunk: string): boolean;
}

export interface NewProjectExecuteHooks {
  stderr?: NewProjectStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override hook for tests — defaults to `node:fs/promises.readFile`. */
  readFile?: (path: string) => Promise<string>;
}

interface SubmitAnswersFile {
  projectType: NewProjectType;
  projectName: string;
  answers: DiscoveryAnswers;
  /** When true, force regenerate by deleting the existing plan first. */
  force?: boolean;
}

export async function execute(
  opts: NewProjectOptions,
  globals: GlobalOptions,
  hooks: NewProjectExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: NewProjectStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;
  const readFile = hooks.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  try {
    switch (opts.subcommand) {
      case 'select-type':
        return await runSelectType(opts, globals, formatter, stderr, engine);
      case 'submit-answers':
        return await runSubmitAnswers(
          opts,
          globals,
          formatter,
          stderr,
          engine,
          readFile,
        );
      case 'get-plan':
        return await runGetPlan(opts, globals, formatter, stderr, engine);
      case 'approve-plan':
        return await runApprovePlan(opts, globals, formatter, stderr, engine);
      default:
        stderr.write(
          `ptah new-project: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

// ---------------------------------------------------------------------------
// select-type — RPC `wizard:new-project-select-type`
// ---------------------------------------------------------------------------

async function runSelectType(
  opts: NewProjectOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: NewProjectStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.projectType || opts.projectType.trim().length === 0) {
    stderr.write('ptah new-project select-type: <type> is required\n');
    return ExitCode.UsageError;
  }
  const projectType = opts.projectType as NewProjectType;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<WizardNewProjectSelectTypeResult>(
      ctx.transport,
      'wizard:new-project-select-type',
      { projectType },
    );
    const groups = result?.groups ?? [];
    await formatter.writeNotification('new_project.session.started', {
      projectType,
      groupCount: groups.length,
      groups,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// submit-answers — RPC `wizard:new-project-submit-answers`
// ---------------------------------------------------------------------------

async function runSubmitAnswers(
  opts: NewProjectOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: NewProjectStderrLike,
  engine: typeof withEngine,
  readFile: (path: string) => Promise<string>,
): Promise<number> {
  if (!opts.file || opts.file.trim().length === 0) {
    stderr.write(
      'ptah new-project submit-answers: --file <path> is required\n',
    );
    return ExitCode.UsageError;
  }

  let raw: string;
  try {
    raw = await readFile(opts.file);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(
      `ptah new-project submit-answers: failed to read ${opts.file}: ${message}\n`,
    );
    return ExitCode.UsageError;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(
      `ptah new-project submit-answers: invalid JSON in ${opts.file}: ${message}\n`,
    );
    return ExitCode.UsageError;
  }

  const validated = validateAnswersFile(parsed);
  if ('error' in validated) {
    stderr.write(`ptah new-project submit-answers: ${validated.error}\n`);
    return ExitCode.UsageError;
  }
  const payload = validated.payload;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const params: SubmitAnswersFile = {
      projectType: payload.projectType,
      projectName: payload.projectName,
      answers: payload.answers,
    };
    if (payload.force) {
      params.force = true;
    }

    const result = await callRpc<WizardNewProjectSubmitAnswersResult>(
      ctx.transport,
      'wizard:new-project-submit-answers',
      params,
    );

    if (!result?.success) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'internal_failure',
        message:
          result?.error ?? 'wizard:new-project-submit-answers reported failure',
      });
      return ExitCode.InternalFailure;
    }

    await formatter.writeNotification('new_project.answers.received', {
      projectType: payload.projectType,
      projectName: payload.projectName,
      answerCount: Object.keys(payload.answers).length,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// get-plan — RPC `wizard:new-project-get-plan`
// ---------------------------------------------------------------------------

async function runGetPlan(
  opts: NewProjectOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: NewProjectStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.sessionId || opts.sessionId.trim().length === 0) {
    stderr.write('ptah new-project get-plan: <session-id> is required\n');
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<WizardNewProjectGetPlanResult>(
      ctx.transport,
      'wizard:new-project-get-plan',
      {},
    );
    await formatter.writeNotification('new_project.plan', {
      sessionId: opts.sessionId,
      plan: result?.plan,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// approve-plan — RPC `wizard:new-project-approve-plan { approved: true }`
// ---------------------------------------------------------------------------

async function runApprovePlan(
  opts: NewProjectOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: NewProjectStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.sessionId || opts.sessionId.trim().length === 0) {
    stderr.write('ptah new-project approve-plan: <session-id> is required\n');
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<WizardNewProjectApprovePlanResult>(
      ctx.transport,
      'wizard:new-project-approve-plan',
      { approved: true },
    );
    if (!result?.success) {
      throw new Error(
        'wizard:new-project-approve-plan reported failure (success: false)',
      );
    }
    await formatter.writeNotification('new_project.plan.approved', {
      sessionId: opts.sessionId,
      planPath: result.planPath,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

interface ValidatedAnswers {
  payload: SubmitAnswersFile;
}

interface AnswersError {
  error: string;
}

function validateAnswersFile(value: unknown): ValidatedAnswers | AnswersError {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'answers file must contain a JSON object' };
  }
  const obj = value as Record<string, unknown>;

  const projectType = obj['projectType'];
  if (typeof projectType !== 'string' || projectType.trim().length === 0) {
    return { error: 'answers.projectType must be a non-empty string' };
  }

  const projectName = obj['projectName'];
  if (typeof projectName !== 'string' || projectName.trim().length === 0) {
    return { error: 'answers.projectName must be a non-empty string' };
  }

  const answers = obj['answers'];
  if (
    typeof answers !== 'object' ||
    answers === null ||
    Array.isArray(answers)
  ) {
    return { error: 'answers.answers must be a JSON object' };
  }

  // Validate each answer value is string | string[].
  for (const [key, val] of Object.entries(answers as Record<string, unknown>)) {
    const isString = typeof val === 'string';
    const isStringArray =
      Array.isArray(val) && val.every((entry) => typeof entry === 'string');
    if (!isString && !isStringArray) {
      return {
        error: `answers.answers["${key}"] must be a string or string[]`,
      };
    }
  }

  const force = obj['force'];
  if (force !== undefined && typeof force !== 'boolean') {
    return { error: 'answers.force must be a boolean if provided' };
  }

  const payload: SubmitAnswersFile = {
    projectType: projectType as NewProjectType,
    projectName,
    answers: answers as DiscoveryAnswers,
  };
  if (force === true) payload.force = true;

  return { payload };
}

async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      (err as unknown as { code: string }).code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T) ?? (null as unknown as T);
}
