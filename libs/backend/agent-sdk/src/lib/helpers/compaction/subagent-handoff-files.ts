/**
 * SubagentHandoffFiles — where a subagent stopped by the budget monitor
 * leaves what a fresh subagent of the same type needs to continue.
 *
 * Per spawning tool_use id, under `<session workspace>/.ptah/subagent-handoffs/`:
 *
 * - `<id>.md`: the progress notes the subagent is asked to write when it
 *   nears its budget (state, findings, decisions, files touched, next steps).
 *   Written by the subagent; the host only checks that it exists.
 * - `<id>.task.md`: the subagent's full original task prompt, written by the
 *   host when it stops the subagent.
 *
 * The tool_use id comes from the SDK stream; it is reduced to
 * `[A-Za-z0-9_-]` before it becomes a file name, so it can never leave the
 * handoff directory. Without a known workspace there are no paths, and every
 * file operation is skipped. A failed write is logged (error type only) and
 * reported as `false`; it never throws.
 *
 * At a stop, {@link prepareHandoffFiles} waits at most
 * {@link HANDOFF_FILES_TIMEOUT_MS} for the file operations (a stalled or
 * network workspace must not hold the handoff back); past that the handoff
 * reports the files as unavailable, and a late result is ignored. The
 * handoff record (`subagent-handoff-record.ts`) uses the same bound through
 * {@link withinHandoffTimeout}.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import type { Logger } from '@ptah-extension/vscode-core';

/** Handoff directory, relative to the session workspace. */
export const SUBAGENT_HANDOFF_DIR = path.join('.ptah', 'subagent-handoffs');

/** The two handoff files of one subagent, as absolute paths. */
export interface SubagentHandoffPaths {
  /** Progress notes the subagent writes before its budget runs out. */
  readonly notes: string;
  /** The full original task prompt the host saves at the stop. */
  readonly task: string;
}

/** Time a stop waits for one group of handoff file operations. */
export const HANDOFF_FILES_TIMEOUT_MS = 5_000;

/** Where the handoff files of a stopped subagent stand. */
export interface HandoffFileState {
  /** Absent when the session has no known workspace. */
  readonly paths?: SubagentHandoffPaths;
  readonly taskSaved: boolean;
  readonly notesWritten: boolean;
  /** The file operations failed or did not finish in time: outcome unknown. */
  readonly unavailable?: boolean;
}

export class SubagentHandoffFiles {
  constructor(
    private readonly logger: Logger,
    /** The workspace root of a session, `undefined` when unknown. */
    private readonly workspaceOf: (sessionId: string) => string | undefined,
  ) {}

  /** The handoff paths of a subagent, or `undefined` without a workspace or a usable id. */
  paths(
    sessionId: string,
    toolCallId: string,
  ): SubagentHandoffPaths | undefined {
    const workspace = this.workspaceOf(sessionId);
    const name = toolCallId.replace(/[^A-Za-z0-9_-]/g, '_');
    if (!workspace || !/[A-Za-z0-9]/.test(name)) {
      return undefined;
    }
    const dir = path.join(workspace, SUBAGENT_HANDOFF_DIR);
    return {
      notes: path.join(dir, `${name}.md`),
      task: path.join(dir, `${name}.task.md`),
    };
  }

  /** Save the full task prompt to `paths.task`; `true` when it was written. */
  async saveTask(
    paths: SubagentHandoffPaths,
    prompt: string,
  ): Promise<boolean> {
    try {
      await fs.mkdir(path.dirname(paths.task), { recursive: true });
      await fs.writeFile(paths.task, prompt, 'utf8');
      return true;
    } catch (error: unknown) {
      const code = (error as { code?: unknown } | null)?.code;
      this.logger.warn(
        '[SubagentHandoffFiles] Could not save the subagent task prompt',
        {
          errorType: error instanceof Error ? error.name : typeof error,
          errorCode: typeof code === 'string' ? code : undefined,
        },
      );
      return false;
    }
  }

  /** Whether the subagent wrote its progress notes. */
  async notesExist(paths: SubagentHandoffPaths): Promise<boolean> {
    try {
      return (await fs.stat(paths.notes)).isFile();
    } catch {
      // A missing or unreadable notes file reads as "not written".
      return false;
    }
  }
}

/**
 * Wait at most {@link HANDOFF_FILES_TIMEOUT_MS} for `op`. Resolves `{ value }`
 * when it settles in time, `undefined` when it rejects or the time runs out;
 * never rejects. A value that arrives after the timeout goes to `onLate`, so
 * the caller can undo a write nobody waited for. The timer is cleared.
 */
export async function withinHandoffTimeout<T>(
  op: Promise<T>,
  onLate?: (value: T) => void,
): Promise<{ readonly value: T } | undefined> {
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      expired = true;
      resolve(undefined);
    }, HANDOFF_FILES_TIMEOUT_MS);
  });
  const done = op.then(
    (value) => {
      if (expired) {
        onLate?.(value);
      }
      return { value };
    },
    () => undefined,
  );
  try {
    return await Promise.race([done, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Save the full task `prompt` and check for the subagent's progress notes at
 * `paths`, waiting at most {@link HANDOFF_FILES_TIMEOUT_MS}. Never rejects.
 */
export async function prepareHandoffFiles(
  files: Pick<SubagentHandoffFiles, 'saveTask' | 'notesExist'>,
  paths: SubagentHandoffPaths | undefined,
  prompt: string | undefined,
): Promise<HandoffFileState> {
  if (!paths) {
    return { taskSaved: false, notesWritten: false };
  }
  const result = await withinHandoffTimeout(
    Promise.all([
      prompt ? files.saveTask(paths, prompt) : Promise.resolve(false),
      files.notesExist(paths),
    ]),
  );
  return result
    ? { paths, taskSaved: result.value[0], notesWritten: result.value[1] }
    : { paths, taskSaved: false, notesWritten: false, unavailable: true };
}
