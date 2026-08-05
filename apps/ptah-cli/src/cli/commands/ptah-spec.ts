/**
 * `ptah spec` command — task-spec operations over `.ptah/specs/`
 * (TASK_2026_179, step 16).
 *
 *   new --title --type [...]   RPC `tasks:create`       -> spec.created
 *   status <id> --to <status>  RPC `tasks:updateStatus` -> spec.status
 *   show <id>                  RPC `tasks:get`          -> spec.detail
 *   list [--status --type
 *         --label --estimate]  RPC `tasks:list`         -> spec.list
 *   check                      RPC `tasks:board`        -> spec.check
 *   doctor --plan|--fix|--undo TaskDoctorService        -> spec.doctor
 *
 * ## `list` filters run on the SERVER, through the shared predicate
 *
 * `--label` and `--estimate` fold into a `TaskFilterSpec` and travel as
 * `tasks:list`'s `filter` parameter. They are NOT applied here. `filterTasks`
 * in `libs/shared` is the one filter implementation in the repository
 * (FR-C1.5), and a convenience `.filter()` in this file would quietly make that
 * false — the CLI would drift from the board the first time either changed.
 *
 * The five metadata fields (`labels`, `estimate`, `parent`, `duplicates`,
 * `relatesTo`) need no code here at all: `spec.list` and `spec.detail` emit
 * whole `TaskSpecSummary` values, so `--json` carries them for free.
 *
 * ## One notification per invocation — load-bearing
 *
 * Every path below emits EXACTLY ONE notification and then returns. In the
 * default JSON mode that makes stdout a single parseable JSON document, which
 * is what lets a caller do `ptah spec list --json | jq` without stream-parsing
 * NDJSON or filtering interleaved log lines. Anything diagnostic goes to
 * stderr, never stdout. If you add a second `writeNotification` to a success
 * path here, you break that contract.
 *
 * ## Why `doctor` bypasses RPC
 *
 * `--plan` has an RPC equivalent (`tasks:doctorPlan`), but `--fix` and `--undo`
 * deliberately do NOT: mutating and rolling back a user's task tree is not
 * something a webview should be able to trigger over the message bus. All three
 * modes therefore resolve `TaskDoctorService` straight from the container, so
 * the three stay on one code path and the CLI remains the only surface that can
 * apply a repair.
 *
 * `--plan` is READ-ONLY and must stay that way. Note that it does NOT warm the
 * task index: `ensureStarted` writes `.ptah/specs/README.md` when the hash
 * differs, so warming it would make a "plan" mutate the tree it is reporting on.
 */

import { withEngine } from '@ptah-extension/cli-engine';
import {
  TASK_SPECS_TOKENS,
  type DoctorPlan,
  type TaskDoctorService,
} from '@ptah-extension/task-specs';
import type {
  TaskEstimate,
  TaskFilterSpec,
  TasksBoardResult,
  TasksCreateResult,
  TasksGetResult,
  TasksListResult,
  TasksUpdateStatusResult,
  TaskStatus,
  TaskType,
} from '@ptah-extension/shared';
import {
  EMPTY_TASK_FILTER,
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
  isTaskFilterActive,
} from '@ptah-extension/shared';

import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import { callRpc, oneshot } from './thoth-command-shared.js';

export type SpecSubcommand =
  | 'new'
  | 'status'
  | 'show'
  | 'list'
  | 'check'
  | 'doctor';

/** Which of the three mutually exclusive doctor modes was requested. */
export type SpecDoctorMode = 'plan' | 'fix' | 'undo';

export interface SpecOptions {
  subcommand: SpecSubcommand;
  /** For `show` / `status` — the task folder name. */
  id?: string;
  /** For `new`. */
  title?: string;
  /** For `new`. */
  type?: string;
  /** For `new`. */
  description?: string;
  /** For `new`. */
  dependsOn?: string[];
  /** For `new`. */
  executor?: string;
  /** For `status` — the target status. */
  to?: string;
  /** For `list` — status filter. */
  status?: string[];
  /** For `list` — type filter. */
  filterType?: string[];
  /**
   * For `list` — label filter, matched case- and whitespace-insensitively.
   *
   * ANY semantics: a task matching at least one of these is included. There is
   * no ALL switch on the CLI because there is no way to offer one without a
   * second flag whose meaning has to be explained in a help line; the board is
   * where that toggle belongs.
   */
  label?: string[];
  /**
   * For `list` — estimate filter. Accepts the {@link TASK_ESTIMATES} sizes and
   * the literal `unestimated`, which is a facet value rather than a size.
   */
  estimate?: string[];
  /** For `doctor`. Defaults to `plan` — the only non-mutating mode. */
  doctorMode?: SpecDoctorMode;
  /**
   * Subcommand-level `--json`.
   *
   * The root program already defaults to JSON, but its flag is declared on the
   * PROGRAM, so `ptah spec list --json` would otherwise die with "unknown
   * option" — commander hands trailing argv to the subcommand, which has never
   * heard of a root flag. Declaring it here makes the documented invocation
   * parse, and makes it authoritative: it forces machine output even when an
   * earlier `--human` asked for the pretty printer.
   */
  json?: boolean;
}

export interface SpecStderrLike {
  write(chunk: string): boolean;
}

export interface SpecExecuteHooks {
  stderr?: SpecStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
}

/** Narrow an untrusted string to a canonical task status. */
function toStatus(value: string | undefined): TaskStatus | null {
  return (TASK_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as TaskStatus)
    : null;
}

/** Narrow an untrusted string to a canonical task type. */
function toType(value: string | undefined): TaskType | null {
  return (TASK_TYPES as readonly string[]).includes(value ?? '')
    ? (value as TaskType)
    : null;
}

/**
 * Strip absolute paths out of a plan before it reaches stdout.
 *
 * The doctor works in absolute paths; the folder name already identifies the
 * task, so the rename endpoints are reduced to bare filenames. Same reasoning
 * as the RPC projection — output that is going to be piped somewhere should not
 * carry the user's directory layout.
 */
function toWirePlan(plan: DoctorPlan): {
  contractVersion: number;
  stampVersion: number | null;
  actions: Array<Record<string, unknown>>;
  warnings: Array<{ folderName: string; code: string; message: string }>;
} {
  const base = (filePath: string): string =>
    filePath.split(/[\\/]/).pop() ?? filePath;
  return {
    contractVersion: plan.contractVersion,
    stampVersion: plan.stampVersion,
    actions: plan.actions.map((action) =>
      action.kind === 'adopt'
        ? {
            kind: action.kind,
            folderName: action.folderName,
            title: action.title,
            type: action.type,
            status: action.status,
            // ALWAYS true for an adoption — the status was deduced from the
            // folder's artifacts, never declared, and the output says so.
            statusInferred: true,
            inferredFrom: action.inferredFrom,
          }
        : {
            kind: action.kind,
            folderName: action.folderName,
            from: base(action.from),
            to: base(action.to),
          },
    ),
    warnings: plan.warnings,
  };
}

/**
 * Execute a `spec` subcommand.
 *
 * Returns the process exit code; never throws past this boundary. Every failure
 * is reported as a single `task.error` notification so the machine contract
 * (one JSON document on stdout) holds for errors too.
 */
export async function execute(
  opts: SpecOptions,
  globals: GlobalOptions,
  hooks: SpecExecuteHooks = {},
): Promise<number> {
  // A subcommand-level `--json` overrides an earlier `--human`.
  const effectiveGlobals: GlobalOptions =
    opts.json === true ? { ...globals, json: true, human: false } : globals;
  const formatter = hooks.formatter ?? buildFormatter(effectiveGlobals);
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'new':
        return await runNew(opts, effectiveGlobals, formatter, engine);
      case 'status':
        return await runStatus(opts, effectiveGlobals, formatter, engine);
      case 'show':
        return await runShow(opts, effectiveGlobals, formatter, engine);
      case 'list':
        return await runList(opts, effectiveGlobals, formatter, engine);
      case 'check':
        return await runCheck(opts, effectiveGlobals, formatter, engine);
      case 'doctor':
        return await runDoctor(opts, effectiveGlobals, formatter, engine);
      default:
        return await usageError(
          formatter,
          `unknown spec subcommand '${String(opts.subcommand)}'`,
        );
    }
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
      command: 'spec',
    });
    return ExitCode.InternalFailure;
  }
}

async function usageError(
  formatter: Formatter,
  message: string,
): Promise<number> {
  await formatter.writeNotification('task.error', {
    ptah_code: 'unknown',
    message,
    command: 'spec',
  });
  return ExitCode.UsageError;
}

async function runNew(
  opts: SpecOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  const title = opts.title?.trim();
  if (!title) return usageError(formatter, 'spec new requires --title');
  const type = toType(opts.type);
  if (!type) {
    return usageError(
      formatter,
      `spec new requires --type (one of: ${TASK_TYPES.join(', ')})`,
    );
  }

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<TasksCreateResult>(
      ctx.transport,
      'tasks:create',
      {
        workspaceRoot: globals.cwd,
        title,
        type,
        description: opts.description,
        dependsOn: opts.dependsOn,
        executor: opts.executor,
      },
    );
    if (!result?.success) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'unknown',
        message: result?.error?.message ?? 'spec new failed',
        code: result?.error?.code,
        command: 'spec',
      });
      return ExitCode.GeneralError;
    }
    await formatter.writeNotification('spec.created', { task: result.task });
    return ExitCode.Success;
  });
}

async function runStatus(
  opts: SpecOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  const id = opts.id?.trim();
  if (!id) return usageError(formatter, 'spec status requires a task id');
  const status = toStatus(opts.to);
  if (!status) {
    return usageError(
      formatter,
      `spec status requires --to (one of: ${TASK_STATUSES.join(', ')})`,
    );
  }

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<TasksUpdateStatusResult>(
      ctx.transport,
      'tasks:updateStatus',
      { workspaceRoot: globals.cwd, taskId: id, status },
    );
    if (!result?.success) {
      // TASK_CONFLICT is retryable and says so in its message — surface the
      // code so a script can distinguish it from a hard failure.
      await formatter.writeNotification('task.error', {
        ptah_code: 'unknown',
        message: result?.error?.message ?? 'spec status failed',
        code: result?.error?.code,
        command: 'spec',
      });
      return ExitCode.GeneralError;
    }
    await formatter.writeNotification('spec.status', { task: result.task });
    return ExitCode.Success;
  });
}

async function runShow(
  opts: SpecOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  const id = opts.id?.trim();
  if (!id) return usageError(formatter, 'spec show requires a task id');

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<TasksGetResult>(ctx.transport, 'tasks:get', {
      workspaceRoot: globals.cwd,
      taskId: id,
    });
    if (!result?.task) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'unknown',
        message: `no task '${id}' — it may have no carrier; run \`ptah spec doctor --plan\``,
        command: 'spec',
      });
      return ExitCode.GeneralError;
    }
    await formatter.writeNotification('spec.detail', { task: result.task });
    return ExitCode.Success;
  });
}

/** The `--estimate` value that means "carries no size at all". */
const UNESTIMATED_FLAG_VALUE = 'unestimated';

/**
 * Fold `--label` / `--estimate` into a filter spec (V-3).
 *
 * The CLI does NOT filter locally. The spec goes over `tasks:list`, where the
 * SHARED `filterTasks` applies it — the same function the board runs. A local
 * `.filter()` here would be a second predicate, and FR-C1.5's single-predicate
 * claim would be false on exactly the surface nobody re-reads.
 *
 * Returns `null` when an estimate value is not a recognised size and is not
 * `unestimated`, so the caller can report a usage error naming the accepted
 * values instead of silently ignoring the flag.
 */
function buildListFilter(opts: SpecOptions): TaskFilterSpec | null {
  const estimates: TaskEstimate[] = [];
  let unestimated = false;
  for (const raw of opts.estimate ?? []) {
    const value = raw.trim();
    if (value.toLowerCase() === UNESTIMATED_FLAG_VALUE) {
      unestimated = true;
      continue;
    }
    if (!(TASK_ESTIMATES as readonly string[]).includes(value)) return null;
    estimates.push(value as TaskEstimate);
  }

  return {
    ...EMPTY_TASK_FILTER,
    // Stored as typed — `labelKey` normalization happens inside the predicate,
    // so the CLI must not pre-fold it and end up with a second normalizer.
    labels: opts.label?.map((value) => value.trim()).filter(Boolean) ?? [],
    labelsMode: 'any',
    estimates,
    unestimated,
  };
}

async function runList(
  opts: SpecOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  const status = opts.status?.map(toStatus) ?? [];
  if (status.some((value) => value === null)) {
    return usageError(
      formatter,
      `spec list --status accepts only: ${TASK_STATUSES.join(', ')}`,
    );
  }
  const type = opts.filterType?.map(toType) ?? [];
  if (type.some((value) => value === null)) {
    return usageError(
      formatter,
      `spec list --type accepts only: ${TASK_TYPES.join(', ')}`,
    );
  }
  const filter = buildListFilter(opts);
  if (filter === null) {
    return usageError(
      formatter,
      `spec list --estimate accepts only: ${TASK_ESTIMATES.join(
        ', ',
      )}, ${UNESTIMATED_FLAG_VALUE}`,
    );
  }

  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<TasksListResult>(ctx.transport, 'tasks:list', {
      workspaceRoot: globals.cwd,
      status: status.length > 0 ? (status as TaskStatus[]) : undefined,
      type: type.length > 0 ? (type as TaskType[]) : undefined,
      // Omitted entirely when no new facet was asked for, so an invocation that
      // predates these flags puts exactly the bytes on the wire it always did.
      filter: isTaskFilterActive(filter) ? filter : undefined,
    });
    await formatter.writeNotification('spec.list', {
      tasks: result?.tasks ?? [],
      count: result?.tasks?.length ?? 0,
      excludedCount: result?.excludedCount ?? 0,
      specsDirExists: result?.specsDirExists ?? false,
    });
    return ExitCode.Success;
  });
}

/**
 * `spec check` — the health report.
 *
 * Uses `tasks:board` rather than `tasks:list` for one reason: the board result
 * carries the excluded folders as ROWS (name + typed reason), and a bare count
 * is exactly the failure being fixed. A user whose folder vanished needs to be
 * told which folder and why.
 */
async function runCheck(
  opts: SpecOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, oneshot(), async (ctx) => {
    const result = await callRpc<TasksBoardResult>(
      ctx.transport,
      'tasks:board',
      { workspaceRoot: globals.cwd },
    );
    const tasks = Object.values(result?.columns ?? {}).flat();
    const invalid = tasks
      .filter((task) => task.validationIssues.length > 0)
      .map((task) => ({
        taskId: task.id,
        issues: task.validationIssues,
      }));
    const excluded = result?.excluded ?? [];

    await formatter.writeNotification('spec.check', {
      healthy: invalid.length === 0 && excluded.length === 0,
      taskCount: tasks.length,
      excluded,
      excludedCount: result?.excludedCount ?? excluded.length,
      invalid,
      specsDirExists: result?.specsDirExists ?? false,
    });
    // A tree with problems is reported, not treated as a command failure —
    // `check` succeeded at checking. Scripts branch on `healthy`.
    return ExitCode.Success;
  });
}

async function runDoctor(
  opts: SpecOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  const mode: SpecDoctorMode = opts.doctorMode ?? 'plan';

  return engine(globals, oneshot(), async (ctx) => {
    const doctor = ctx.container.resolve<TaskDoctorService>(
      TASK_SPECS_TOKENS.TASK_DOCTOR,
    );

    if (mode === 'undo') {
      const undone = await doctor.undo(globals.cwd);
      if (!undone.ok) {
        await formatter.writeNotification('task.error', {
          ptah_code: 'unknown',
          message: undone.error?.message ?? 'undo failed',
          code: undone.error?.code,
          command: 'spec',
        });
        return ExitCode.GeneralError;
      }
      await formatter.writeNotification('spec.doctor', {
        mode,
        reverted: undone.reverted,
      });
      return ExitCode.Success;
    }

    const planned = await doctor.plan(globals.cwd);
    if (!planned.ok) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'unknown',
        message: planned.error.message,
        code: planned.error.code,
        command: 'spec',
      });
      return ExitCode.GeneralError;
    }

    if (mode === 'plan') {
      // Nothing was written, and nothing may be: this branch returns before
      // any call that could mutate.
      await formatter.writeNotification('spec.doctor', {
        mode,
        applied: false,
        ...toWirePlan(planned.plan),
      });
      return ExitCode.Success;
    }

    const result = await doctor.apply(planned.plan);
    if (!result.ok) {
      await formatter.writeNotification('task.error', {
        ptah_code: 'unknown',
        message: result.error?.message ?? 'apply failed',
        code: result.error?.code,
        command: 'spec',
      });
      return ExitCode.GeneralError;
    }
    await formatter.writeNotification('spec.doctor', {
      mode,
      applied: true,
      appliedCount: result.applied.length,
      ...toWirePlan(planned.plan),
    });
    return ExitCode.Success;
  });
}
