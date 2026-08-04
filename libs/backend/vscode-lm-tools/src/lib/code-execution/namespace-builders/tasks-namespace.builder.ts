/**
 * Tasks namespace builder — exposes `.ptah/specs/` to the agent as MCP tools
 * (TASK_2026_179, step 17).
 *
 * ## Why this namespace is ALWAYS ON
 *
 * It is deliberately not registered as a toggleable namespace and never appears
 * in `disabledMcpNamespaces`. The whole failure this task set exists to fix is
 * task folders going silently missing because agents wrote task metadata by
 * hand. Giving agents a real, validated write path only helps if that path is
 * present on every runtime, in every configuration — a tool an agent cannot
 * rely on being there is a tool it will route around.
 *
 * ## There is NO `set_section` tool, and that is the point
 *
 * The contract splits ownership: `task.md` is machine-owned METADATA, and
 * `context.md` and its siblings are agent-owned PROSE. This namespace can
 * therefore create a task, move its status, and read it back — and it has no
 * ability whatsoever to write prose into the carrier. A section-writing tool
 * would collapse that boundary in one step: it would put agent narrative onto
 * the exact file the Tasks board mutates, which is how the original
 * lost-status bug happens. Agents write prose with their ordinary file tools,
 * into `context.md`, where nothing else is writing.
 *
 * ## Degradation
 *
 * Every collaborator is resolved through a lazy getter and every method
 * degrades to a typed `{ error }` result rather than throwing, so a host
 * without the task-spec services registered reports the fact instead of
 * killing the tool call. Same shape as `memory-namespace.builder.ts`.
 */

import { z } from 'zod';
import {
  CONTEXT_FILE,
  TASK_STATUSES,
  TASK_TYPES,
  type ExcludedTaskFolder,
  type TaskSpecDetail,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
} from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Narrow structural collaborators
// ---------------------------------------------------------------------------
//
// Declared here as the minimum surface this namespace actually calls, rather
// than importing the concrete service classes. Same reasoning as
// `harness-namespace.builder.ts`: it keeps the builder unit-testable without a
// DI container, and it keeps the coupling to `task-specs` at exactly one site
// (`ptah-api-builder.service.ts`, which does the injecting).

/** The subset of `TaskWriterService` this namespace uses. */
export interface TaskSpecWriterLike {
  create(
    workspaceRoot: string,
    input: {
      title: string;
      type: TaskType;
      description?: string;
      dependsOn?: string[];
      executor?: string;
    },
  ): Promise<
    | { success: true; task: TaskSpecSummary }
    | { success: false; error: { code: string; message: string } }
  >;
  updateStatus(
    workspaceRoot: string,
    taskId: string,
    status: TaskStatus,
  ): Promise<
    | { success: true; task: TaskSpecSummary }
    | { success: false; error: { code: string; message: string } }
  >;
}

/** The subset of `TaskIndexService` this namespace uses. */
export interface TaskSpecIndexLike {
  ensureStarted(workspaceRoot: string): Promise<void>;
  list(
    workspaceRoot: string,
    filters?: { status?: TaskStatus[]; type?: TaskType[] },
  ): Promise<{
    tasks: TaskSpecSummary[];
    excluded: ExcludedTaskFolder[];
    excludedCount: number;
    specsDirExists: boolean;
  }>;
  getDetail(
    workspaceRoot: string,
    taskId: string,
  ): Promise<TaskSpecDetail | null>;
}

export interface TasksNamespaceDependencies {
  getWriter: () => TaskSpecWriterLike | undefined;
  getIndex: () => TaskSpecIndexLike | undefined;
  getWorkspaceRoot: () => string;
}

// ---------------------------------------------------------------------------
// Zod boundary — these args arrive as untrusted JSON from an agent
// ---------------------------------------------------------------------------

const statusEnum = z.enum(TASK_STATUSES);
const typeEnum = z.enum(TASK_TYPES);

/**
 * `taskId` is a FOLDER NAME and gets joined onto `.ptah/specs` before a write.
 * Constraining it to a single path segment is a containment guarantee, not
 * cosmetics: a `..` or a separator would let a tool call steer that write
 * anywhere on disk.
 */
const taskIdSchema = z
  .string()
  .min(1)
  .refine((id) => !id.includes('/') && !id.includes('\\') && id !== '..', {
    message: 'taskId must be a single folder name, not a path',
  });

export const TaskCreateArgsSchema = z.object({
  title: z.string().min(1),
  type: typeEnum,
  description: z.string().optional(),
  dependsOn: z.array(z.string().min(1)).optional(),
  executor: z.string().optional(),
});

export const TaskUpdateArgsSchema = z.object({
  taskId: taskIdSchema,
  status: statusEnum,
});

export const TaskGetArgsSchema = z.object({ taskId: taskIdSchema });

export const TaskListArgsSchema = z.object({
  status: z.array(statusEnum).optional(),
  type: z.array(typeEnum).optional(),
});

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export type TaskMutationResult =
  | { ok: true; task: TaskSpecSummary; note?: string }
  | { ok: false; error: string; code?: string };

export type TaskGetResult =
  | { ok: true; task: TaskSpecDetail }
  | { ok: false; error: string; code?: string };

export type TaskListResult =
  | {
      ok: true;
      tasks: TaskSpecSummary[];
      count: number;
      excludedCount: number;
      specsDirExists: boolean;
    }
  | { ok: false; error: string };

/**
 * A health report for the whole spec tree.
 *
 * `excluded` carries every skipped folder BY NAME with its typed reason. A bare
 * count is what made these folders invisible in the first place — the agent
 * running `check` needs to know WHICH folder and WHY to do anything about it.
 */
export type TaskCheckResult =
  | {
      ok: true;
      healthy: boolean;
      taskCount: number;
      excluded: ExcludedTaskFolder[];
      invalid: Array<{
        taskId: string;
        issues: Array<{ field: string; code: string; message: string }>;
      }>;
      specsDirExists: boolean;
    }
  | { ok: false; error: string };

export interface TasksNamespace {
  create(args: unknown): Promise<TaskMutationResult>;
  update(args: unknown): Promise<TaskMutationResult>;
  get(args: unknown): Promise<TaskGetResult>;
  list(args?: unknown): Promise<TaskListResult>;
  check(): Promise<TaskCheckResult>;
}

/** Render a Zod failure as one readable line for the agent. */
function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

export function buildTasksNamespace(
  deps: TasksNamespaceDependencies,
): TasksNamespace {
  /**
   * Resolve the collaborators plus a workspace root, or explain what is
   * missing. Warming the index here (rather than per-method) keeps the derived
   * board in step with a write the agent is about to make.
   */
  const ready = async (): Promise<
    | {
        ok: true;
        root: string;
        writer?: TaskSpecWriterLike;
        index?: TaskSpecIndexLike;
      }
    | { ok: false; error: string }
  > => {
    const root = deps.getWorkspaceRoot();
    if (!root) {
      return { ok: false, error: 'No workspace is open.' };
    }
    const index = deps.getIndex();
    if (index) {
      try {
        await index.ensureStarted(root);
      } catch {
        // A cold index is not a reason to refuse a write — the file is the
        // source of truth and the writer notifies the index itself.
      }
    }
    return { ok: true, root, writer: deps.getWriter(), index };
  };

  const failure = (error: unknown): string =>
    error instanceof Error ? error.message : String(error);

  return {
    async create(args: unknown): Promise<TaskMutationResult> {
      const parsed = TaskCreateArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: formatZodError(parsed.error),
          code: 'INVALID_ARGS',
        };
      }
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.writer) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        const result = await context.writer.create(context.root, parsed.data);
        if (!result.success) {
          return {
            ok: false,
            error: result.error.message,
            code: result.error.code,
          };
        }
        return {
          ok: true,
          task: result.task,
          note:
            `Folder created with a metadata-only carrier. Write the background, ` +
            `plan and discussion to ${CONTEXT_FILE} in the same folder — never ` +
            `into the carrier.`,
        };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },

    async update(args: unknown): Promise<TaskMutationResult> {
      const parsed = TaskUpdateArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: formatZodError(parsed.error),
          code: 'INVALID_ARGS',
        };
      }
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.writer) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        const result = await context.writer.updateStatus(
          context.root,
          parsed.data.taskId,
          parsed.data.status,
        );
        if (!result.success) {
          // TASK_CONFLICT arrives here when somebody else changed the carrier
          // between our read and our write. It is RETRYABLE and the message
          // says so — the agent should re-read rather than force the write.
          return {
            ok: false,
            error: result.error.message,
            code: result.error.code,
          };
        }
        return { ok: true, task: result.task };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },

    async get(args: unknown): Promise<TaskGetResult> {
      const parsed = TaskGetArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return {
          ok: false,
          error: formatZodError(parsed.error),
          code: 'INVALID_ARGS',
        };
      }
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.index) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        const task = await context.index.getDetail(
          context.root,
          parsed.data.taskId,
        );
        if (!task) {
          return {
            ok: false,
            code: 'TASK_NOT_FOUND',
            error: `No task '${parsed.data.taskId}'. It may have no carrier — run the spec doctor to see skipped folders.`,
          };
        }
        return { ok: true, task };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },

    async list(args?: unknown): Promise<TaskListResult> {
      const parsed = TaskListArgsSchema.safeParse(args ?? {});
      if (!parsed.success) {
        return { ok: false, error: formatZodError(parsed.error) };
      }
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.index) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        const result = await context.index.list(context.root, parsed.data);
        return {
          ok: true,
          tasks: result.tasks,
          count: result.tasks.length,
          excludedCount: result.excludedCount,
          specsDirExists: result.specsDirExists,
        };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },

    async check(): Promise<TaskCheckResult> {
      const context = await ready();
      if (!context.ok) return { ok: false, error: context.error };
      if (!context.index) {
        return {
          ok: false,
          error: 'Task specs are not available on this runtime.',
        };
      }
      try {
        const result = await context.index.list(context.root);
        const invalid = result.tasks
          .filter((task) => task.validationIssues.length > 0)
          .map((task) => ({
            taskId: task.id,
            issues: task.validationIssues.map((issue) => ({
              field: issue.field,
              code: issue.code,
              message: issue.message,
            })),
          }));
        return {
          ok: true,
          healthy: invalid.length === 0 && result.excluded.length === 0,
          taskCount: result.tasks.length,
          excluded: result.excluded,
          invalid,
          specsDirExists: result.specsDirExists,
        };
      } catch (error: unknown) {
        return { ok: false, error: failure(error) };
      }
    },
  };
}
