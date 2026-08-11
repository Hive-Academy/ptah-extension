import { inject, injectable } from 'tsyringe';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  FileType,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CARRIER_FILE,
  isSingleTaskPathSegment,
  renderTaskMd,
  type TaskEstimate,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
} from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { allocateTaskId } from './id-allocator';
import { parseTaskFile } from './task-frontmatter';
import { updateFrontmatter, type TaskFrontmatter } from './task-frontmatter';
import {
  TASK_INDEX_NOTIFIER_TOKEN,
  type ITaskIndexNotifier,
} from './task-index.port';

export interface CreateTaskInput {
  title: string;
  type: TaskType;
  description?: string;
  dependsOn?: string[];
  executor?: string;
  /**
   * Optional metadata written at creation time (TASK_2026_181).
   *
   * Every one of these is OMITTED-WHEN-EMPTY by `renderTaskMd`, so a create
   * that supplies none of them produces a carrier byte-identical to the one
   * this writer produced before the fields existed.
   */
  labels?: readonly string[];
  estimate?: TaskEstimate;
  parent?: string;
  duplicates?: readonly string[];
  relatesTo?: readonly string[];
}

export type CreateTaskResult =
  | { success: true; task: TaskSpecSummary }
  | {
      success: false;
      error: {
        /**
         * `ID_ALLOCATION_EXHAUSTED` (TASK_2026_179, step 13 / risk R6): every
         * one of `MAX_CREATE_ATTEMPTS` candidate ids lost the exclusive-create
         * race. Surfaced as a TYPED result rather than a bare throw so the
         * caller can distinguish "someone else is creating tasks right now,
         * retry" from a genuine write failure. Ids may be skipped by a losing
         * attempt; that is acceptable. Silently overwriting somebody else's
         * folder is not.
         */
        code:
          | 'TASK_FOLDER_EXISTS'
          | 'WRITE_FAILED'
          | 'INVALID_PARAMS'
          | 'ID_ALLOCATION_EXHAUSTED';
        message: string;
      };
    };

/** Input for {@link TaskWriterService.adoptFolder}. */
export interface AdoptFolderInput {
  title: string;
  type: TaskType;
  /** Status to record. The doctor infers this from the folder's artifacts. */
  status: TaskSpecSummary['status'];
  description?: string;
  dependsOn?: string[];
  executor?: string;
  /** Emits `status_inferred: true`. The doctor always sets it. */
  statusInferred?: boolean;
}

export type AdoptFolderResult =
  | { success: true; task: TaskSpecSummary }
  | {
      success: false;
      error: {
        /**
         * `CARRIER_EXISTS` is the load-bearing one: adoption must ABORT when
         * the folder already has a `task.md`. It must never fall through to
         * allocating a fresh id, because that would leave the workspace with
         * two folders claiming one task.
         */
        code:
          | 'FOLDER_NOT_FOUND'
          | 'CARRIER_EXISTS'
          | 'WRITE_FAILED'
          | 'INVALID_PARAMS';
        message: string;
      };
    };

/**
 * Bound on the allocate → claim retry loop (risk R6).
 *
 * Each attempt re-scans the folders on disk, so a lost race converges: the
 * winner's folder is visible to the next allocation and pushes it past the
 * collision. The bound exists for the pathological case where the scan is stale
 * (a network share, an aggressive FS cache) and the loop would otherwise spin.
 */
const MAX_CREATE_ATTEMPTS = 5;

/**
 * Multiset equality over two label arrays, ignoring order.
 *
 * Sorted COPIES: sorting either argument in place would mutate the parser's
 * `TaskSpecSummary` or the caller's own array as a side effect of a comparison.
 */
function sameLabelMultiset(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((value, index) => value === right[index]);
}

/** True for the `EEXIST` rejection `createDirectoryExclusive` promises. */
function isAlreadyExists(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === 'EEXIST'
  );
}

export type UpdateStatusResult =
  | { success: true; task: TaskSpecSummary }
  | {
      success: false;
      error: {
        /**
         * `TASK_CONFLICT` (TASK_2026_179, step 4): the carrier changed on disk
         * between our read and our write. We REFUSE the write rather than
         * clobber the other writer — `.ptah/**` is gitignored, so a clobbered
         * status has no undo. The caller should re-read and retry.
         */
        code:
          | 'TASK_NOT_FOUND'
          | 'TASK_EXCLUDED'
          | 'WRITE_FAILED'
          | 'TASK_CONFLICT';
        message: string;
      };
    };

/**
 * Input for {@link TaskWriterService.updateMetadata}.
 *
 * EVERY field is a full replacement, never a merge — see the method doc for
 * why the writer refuses to do read-modify-write on a caller's behalf.
 */
export interface UpdateMetadataInput {
  status?: TaskStatus;
  /** Full replacement. `[]` REMOVES the key. */
  labels?: readonly string[];
  /** `null` REMOVES the key. */
  estimate?: TaskEstimate | null;
  /** `null` REMOVES the key. */
  parent?: string | null;
  /** Full replacement. `[]` REMOVES the key. */
  duplicates?: readonly string[];
  /** Full replacement. `[]` REMOVES the key. */
  relatesTo?: readonly string[];
  /** Full replacement. `[]` is WRITTEN as `[]` — the documented exception. */
  dependsOn?: readonly string[];
}

export type UpdateMetadataResult =
  | { success: true; task: TaskSpecSummary }
  | {
      success: false;
      error: {
        /**
         * `INVALID_PARAMS` is this union's only addition over
         * {@link UpdateStatusResult}: a patch that asks for nothing, or a
         * `taskId`/`parent` that is a path rather than a folder name. Callers
         * Zod-validate upstream, so it is a backstop — `updateStatus` folds it
         * onto `WRITE_FAILED` rather than widen its own wire union for a case
         * that cannot reach it.
         */
        code:
          | 'TASK_NOT_FOUND'
          | 'TASK_EXCLUDED'
          | 'WRITE_FAILED'
          | 'TASK_CONFLICT'
          | 'INVALID_PARAMS';
        message: string;
      };
    };

/**
 * Writes `task.md` carriers (R1.4/R1.5/R4.6/R6.3).
 *
 *  - `create`: id-alloc → existence guard → leaf mkdir → write full valid
 *    frontmatter → round-trip parse with zero issues before returning. Never
 *    overwrites: an existing target folder/carrier yields `TASK_FOLDER_EXISTS`.
 *  - `updateStatus`: read raw → byte-preserving `updateFrontmatter` →
 *    PRE-WRITE RE-READ → write → reparse. The file mutation is ALWAYS the first
 *    step (R3.5 write-order), then the narrow index notifier reparses that one
 *    folder.
 *
 * The carrier BODY is rendered by the shared contract module
 * (`renderTaskMd` in `@ptah-extension/shared`) so the Tasks board, the CLI and
 * this writer all agree on one carrier shape. Note the asymmetry, which is
 * deliberate: the WRITE path uses the contract module's dependency-free YAML
 * emitter (it must stay importable from the frontend), while the READ path
 * still goes through `gray-matter` inside `parseTaskFile` / `updateFrontmatter`.
 * Every `create` round-trips its own output through `parseTaskFile` before
 * returning, which is what keeps the two halves honest.
 */
@injectable()
export class TaskWriterService {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    @inject(TASK_INDEX_NOTIFIER_TOKEN)
    private readonly indexNotifier: ITaskIndexNotifier,
  ) {}

  async create(
    workspaceRoot: string,
    input: CreateTaskInput,
  ): Promise<CreateTaskResult> {
    if (!input.title || input.title.trim().length === 0) {
      return {
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'title is required.' },
      };
    }

    const root = normalizeWorkspaceRoot(workspaceRoot);
    const specsDir = path.join(root, '.ptah', 'specs');

    try {
      // `createDirectoryExclusive` is NON-recursive by contract — it never
      // creates parents — so `.ptah/specs` must exist before we can claim a
      // leaf inside it. This recursive call is safe precisely because it is
      // idempotent; it claims nothing.
      await this.fs.createDirectory(specsDir);

      // Allocate → CLAIM → retry (TASK_2026_179, step 13). The claim is
      // `createDirectoryExclusive`, the port's only compare-and-swap: it either
      // creates the folder or rejects with EEXIST, with no window in between.
      // The old `exists()`-then-`createDirectory()` sequence was a check
      // followed by a recursive, EEXIST-tolerant create — two operations that
      // together could not detect a concurrent winner at all.
      let claimedId: string | undefined;
      const contended: string[] = [];

      for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
        // Re-scan every attempt. This is what makes the retry converge rather
        // than re-propose the same losing id.
        const id = allocateTaskId(await this.listFolderNames(specsDir));
        try {
          await this.fs.createDirectoryExclusive(path.join(specsDir, id));
          claimedId = id;
          break;
        } catch (error: unknown) {
          if (!isAlreadyExists(error)) throw error;
          contended.push(id);
          this.logger.warn(
            '[task-specs] create lost an id race, re-allocating',
            {
              id,
              attempt: attempt + 1,
            },
          );
        }
      }

      if (claimedId === undefined) {
        return {
          success: false,
          error: {
            code: 'ID_ALLOCATION_EXHAUSTED',
            message:
              `Could not claim a task id after ${MAX_CREATE_ATTEMPTS} attempts ` +
              `(contended: ${contended.join(', ')}). Another process is creating ` +
              `tasks concurrently — nothing was written. Try again.`,
          },
        };
      }

      // The folder is ours and provably brand new: an exclusive create cannot
      // succeed onto an existing path, so there is no carrier here to clobber.
      const written = await this.writeCarrier(
        root,
        claimedId,
        renderTaskMd({
          id: claimedId,
          title: input.title,
          type: input.type,
          description: input.description,
          dependsOn: input.dependsOn,
          executor: input.executor,
          // The five metadata fields ride through to the emitter. Mapping them
          // explicitly (rather than spreading `input`) is what keeps this call
          // honest: a field added to `CreateTaskInput` and forgotten here is
          // silently dropped, which is exactly what happened between the schema
          // landing and this line existing.
          labels: input.labels,
          estimate: input.estimate,
          parent: input.parent,
          duplicates: input.duplicates,
          relatesTo: input.relatesTo,
        }),
      );
      return written;
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] create failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to write task.md.' },
      };
    }
  }

  /**
   * Give an EXISTING, carrier-less folder a `task.md` so the Tasks board can
   * see it. The folder name is, and stays, the canonical id.
   *
   * This is deliberately a separate method from `create` rather than a flag on
   * it. `create` allocates an id; `adoptFolder` must NEVER do that. If adoption
   * fell back to `allocateTaskId` on any failure path it would mint a second
   * folder for a task that already exists on disk — which is precisely the
   * class of bug this whole task set exists to remove. There is therefore no
   * code path from here into the allocator.
   *
   * Aborts with `CARRIER_EXISTS` when a carrier is already present. It never
   * overwrites one: `.ptah/**` is gitignored, so an overwrite has no undo.
   */
  async adoptFolder(
    workspaceRoot: string,
    folderName: string,
    input: AdoptFolderInput,
  ): Promise<AdoptFolderResult> {
    if (!folderName || folderName.trim().length === 0) {
      return {
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'folderName is required.' },
      };
    }
    if (!input.title || input.title.trim().length === 0) {
      return {
        success: false,
        error: { code: 'INVALID_PARAMS', message: 'title is required.' },
      };
    }

    const root = normalizeWorkspaceRoot(workspaceRoot);
    const folderPath = path.join(root, '.ptah', 'specs', folderName);
    const carrier = path.join(folderPath, CARRIER_FILE);

    try {
      if (!(await this.fs.exists(folderPath))) {
        return {
          success: false,
          error: {
            code: 'FOLDER_NOT_FOUND',
            message: `Folder '${folderName}' does not exist under .ptah/specs.`,
          },
        };
      }

      if (await this.fs.exists(carrier)) {
        return {
          success: false,
          error: {
            code: 'CARRIER_EXISTS',
            message: `Folder '${folderName}' already has a carrier; adoption aborted. Nothing was written and no id was allocated.`,
          },
        };
      }

      return await this.writeCarrier(
        root,
        folderName,
        renderTaskMd({
          id: folderName,
          title: input.title,
          type: input.type,
          status: input.status,
          description: input.description,
          dependsOn: input.dependsOn,
          executor: input.executor,
          statusInferred: input.statusInferred,
        }),
      );
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] adoptFolder failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to write task.md.' },
      };
    }
  }

  /**
   * Write a rendered carrier into an owned folder, round-trip it through
   * `parseTaskFile`, then notify the index (file first — R3.5 write-order).
   *
   * The round-trip is what keeps the dependency-free YAML emitter on the write
   * side honest against `gray-matter` on the read side.
   */
  private async writeCarrier(
    root: string,
    folderName: string,
    content: string,
  ): Promise<
    | { success: true; task: TaskSpecSummary }
    | {
        success: false;
        error: { code: 'WRITE_FAILED'; message: string };
      }
  > {
    const carrier = path.join(root, '.ptah', 'specs', folderName, CARRIER_FILE);
    await this.fs.writeFile(carrier, content);

    const parsed = parseTaskFile(folderName, content);
    if (parsed.kind !== 'task' || parsed.task.validationIssues.length > 0) {
      return {
        success: false,
        error: {
          code: 'WRITE_FAILED',
          message: 'Generated task.md failed round-trip validation.',
        },
      };
    }

    await this.notify(root, folderName);
    return { success: true, task: parsed.task };
  }

  /**
   * Change a task's status.
   *
   * Now a thin delegate over {@link updateMetadata} — status is one metadata
   * field among seven and there is no reason for it to have its own conflict
   * domain. The exported signature and the `UpdateStatusResult` union are
   * UNCHANGED, so the RPC handler, the MCP namespace and `apps/ptah-cli` need
   * no edit on this path.
   */
  async updateStatus(
    workspaceRoot: string,
    taskId: string,
    status: TaskSpecSummary['status'],
  ): Promise<UpdateStatusResult> {
    const result = await this.updateMetadata(workspaceRoot, taskId, { status });
    if (result.success) return result;

    // Destructured so the narrowing below survives: TypeScript does not narrow
    // a union through a property access on a property.
    const { code, message } = result.error;
    if (code === 'INVALID_PARAMS') {
      // UNREACHABLE in practice: the only `INVALID_PARAMS` this path can
      // produce is a non-segment `taskId`, and every caller Zod-validates that
      // upstream. It is mapped rather than propagated because widening
      // `UpdateStatusResult` — and with it the wire union in
      // `rpc-tasks.types.ts` and every consumer's exhaustive switch — for a
      // case that cannot occur costs more than it explains. The message is
      // preserved verbatim, so a caller that somehow provokes it still learns
      // exactly what was wrong.
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message },
      };
    }
    return { success: false, error: { code, message } };
  }

  /**
   * Change any subset of a task's metadata in ONE write, one conflict domain.
   *
   * **Every field is a FULL REPLACEMENT, never a merge.** Adding or removing a
   * single label is arithmetic the caller does against the task it already
   * holds; doing it here would make this a read-modify-write the writer has no
   * way to make atomic, and the pre-write re-read would start conflicting with
   * the caller's own stale snapshot rather than with a genuine third party.
   *
   * `null` (`estimate`, `parent`) and `[]` (`labels`, `duplicates`,
   * `relatesTo`) both mean REMOVE THE KEY. `dependsOn: []` is the documented
   * exception — it is still written as `[]`.
   *
   * ## `opts.expectLabels` — the precondition the re-read cannot express
   *
   * A bulk label ADD is unavoidably a read-modify-write. `labels` is a full
   * replacement, so a caller wanting to add one element must first read the
   * array it is adding to. That read happens in the CALLER, before this method
   * is even entered.
   *
   * The pre-write re-read below does not cover that gap. It compares this
   * call's OWN snapshot (`raw`) against a re-read taken moments later, so it
   * detects a third party who wrote between the WRITER's read and the WRITER's
   * write. It cannot detect one who wrote between the CALLER's read and the
   * writer's read — by then their change is already part of `raw`, both reads
   * agree, and the write lands cleanly. What it discards is silent: the
   * caller's array was computed from a snapshot that predates the other
   * writer's label change, so replacing `labels` wholesale drops it.
   *
   * `expectLabels` closes exactly that window, for exactly that field. The
   * caller states which labels it believed the task carried; this method
   * compares that against the labels it parsed from its own read and REFUSES
   * with `TASK_CONFLICT` when they differ, writing nothing.
   *
   * Deliberately narrow. It is not a general optimistic-concurrency token: it
   * guards the one field whose write shape forces a caller-side read, and it
   * is `undefined` for every pre-existing caller, which therefore behaves
   * exactly as before.
   */
  async updateMetadata(
    workspaceRoot: string,
    taskId: string,
    input: UpdateMetadataInput,
    opts?: { deferNotify?: boolean; expectLabels?: readonly string[] },
  ): Promise<UpdateMetadataResult> {
    // `taskId` is joined onto the spec root two lines into
    // `applyFrontmatterPatch`. Every boundary above this one already rejects a
    // non-segment id, so this is defence in depth rather than the primary
    // guard — but this method is the funnel EVERY carrier write passes
    // through, which makes it the one place worth being certain.
    if (!isSingleTaskPathSegment(taskId)) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: `Task id '${taskId}' must be a single task folder name, not a path.`,
        },
      };
    }

    const patch: Partial<TaskFrontmatter> = {};
    const remove: string[] = [];

    if (input.status !== undefined) patch.status = input.status;

    if (input.estimate !== undefined) {
      if (input.estimate === null) remove.push('estimate');
      else patch.estimate = input.estimate;
    }

    if (input.parent !== undefined) {
      if (input.parent === null) {
        remove.push('parent');
      } else if (!isSingleTaskPathSegment(input.parent)) {
        return {
          success: false,
          error: {
            code: 'INVALID_PARAMS',
            message: `parent '${input.parent}' must be a single task folder name, not a path.`,
          },
        };
      } else {
        patch.parent = input.parent;
      }
    }

    // The three array fields where EMPTY means "the key should stop existing".
    // Expressed as a table rather than three near-identical blocks so the
    // asymmetry with `depends_on` below is visible instead of buried.
    const emptyRemovesKey = [
      ['labels', input.labels],
      ['duplicates', input.duplicates],
      ['relates_to', input.relatesTo],
    ] as const;
    for (const [key, value] of emptyRemovesKey) {
      if (value === undefined) continue;
      if (value.length === 0) remove.push(key);
      else patch[key] = [...value];
    }

    // `depends_on` is the deliberate exception: an empty array is WRITTEN as
    // `[]`. Every carrier on disk already has that line and normalizing it away
    // would rewrite the frontmatter of every task in every workspace to change
    // nothing a reader can see.
    if (input.dependsOn !== undefined) patch.depends_on = [...input.dependsOn];

    if (Object.keys(patch).length === 0 && remove.length === 0) {
      return {
        success: false,
        error: {
          code: 'INVALID_PARAMS',
          message: 'The patch asks for no change; nothing was written.',
        },
      };
    }

    return this.applyFrontmatterPatch(
      normalizeWorkspaceRoot(workspaceRoot),
      taskId,
      patch,
      remove,
      opts?.deferNotify === true,
      opts?.expectLabels,
    );
  }

  /**
   * read → parse → patch → PRE-WRITE RE-READ → byte-compare → write → notify.
   *
   * The single carrier-write funnel: `updateStatus` and `updateMetadata` are
   * the only entry points into it, and nothing else in this service mutates an
   * existing carrier. Keeping one implementation is the whole point — a second
   * write path is a second conflict domain, and the two would drift.
   *
   * @param remove frontmatter keys deleted after the patch merge (FR-B5.5).
   * @param deferNotify skip the per-write index notification. Bulk callers set
   *   it so N writes cause ONE rescan and ONE `tasks:changed` broadcast instead
   *   of N of each; they are then responsible for notifying once at the end.
   * @param expectLabels the labels the CALLER believed this task carried when
   *   it computed its patch. `undefined` disables the check entirely (the
   *   pre-existing behaviour). See {@link updateMetadata} for why the pre-write
   *   re-read below cannot substitute for it.
   */
  private async applyFrontmatterPatch(
    root: string,
    taskId: string,
    patch: Partial<TaskFrontmatter>,
    remove: readonly string[],
    deferNotify: boolean,
    expectLabels: readonly string[] | undefined,
  ): Promise<UpdateMetadataResult> {
    const carrier = path.join(root, '.ptah', 'specs', taskId, CARRIER_FILE);

    let raw: string;
    try {
      if (!(await this.fs.exists(carrier))) {
        return {
          success: false,
          error: {
            code: 'TASK_NOT_FOUND',
            message: `Task '${taskId}' not found.`,
          },
        };
      }
      raw = await this.fs.readFile(carrier);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] carrier read failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to read task.md.' },
      };
    }

    const parsed = parseTaskFile(taskId, raw);
    if (parsed.kind === 'excluded') {
      return {
        success: false,
        error: {
          code: 'TASK_EXCLUDED',
          message: `Task '${taskId}' has invalid frontmatter and cannot be mutated.`,
        },
      };
    }

    // The caller-side precondition (see `updateMetadata`). Compared against the
    // labels parsed from OUR OWN read, which is the only snapshot that can be
    // shown to predate the write we are about to issue.
    //
    // `parsed.task.labels` is always an array — absent, malformed and empty all
    // collapse to `[]` in the parser — so there is nothing to null-coalesce.
    //
    // Order-insensitive: label order is authored, not meaningful, and a caller
    // that reordered while adding has still discarded nothing. String
    // comparison is EXACT, unlike label MATCHING elsewhere: a third party who
    // recased `Licensing` to `licensing` did change the bytes this caller's
    // full-replacement array would overwrite, and folding that away would be
    // this check declining to notice the one thing it exists to notice.
    if (
      expectLabels !== undefined &&
      !sameLabelMultiset(parsed.task.labels, expectLabels)
    ) {
      this.logger.warn(
        '[task-specs] carrier label precondition failed — write refused',
        {
          taskId,
        },
      );
      return {
        success: false,
        error: {
          code: 'TASK_CONFLICT',
          message: `Task '${taskId}' had its labels changed on disk before the update; nothing was written. Reload and try again.`,
        },
      };
    }

    const nextRaw = updateFrontmatter(
      raw,
      { ...patch, updated: new Date().toISOString() },
      { remove },
    );

    // Pre-write re-read (TASK_2026_179, step 4). `.ptah/**` is gitignored, so a
    // clobbered carrier has no undo — if anything changed the file since our
    // snapshot (an agent's `Edit`, another host, a second board), REFUSE the
    // write and report the conflict instead of silently discarding their
    // change. This is a plain content comparison rather than a hash: it is the
    // collision-free form of the same check, and the file is small.
    //
    // It compares the WHOLE file, deliberately. Narrowing it to the keys this
    // patch touches would let a metadata write silently discard somebody else's
    // body edit, and the conflict-fatigue that costs is accepted, not a defect
    // to tune away.
    //
    // This narrows the loss window; it does not close it. There is still a gap
    // between this read and the write below, and no cross-process lock can shut
    // it (an external `Edit` would not honour one). Closing it entirely needs a
    // real CAS, which the port does not have.
    let current: string;
    try {
      current = await this.fs.readFile(carrier);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] carrier re-read failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to read task.md.' },
      };
    }

    if (current !== raw) {
      this.logger.warn('[task-specs] carrier conflict — write refused', {
        taskId,
      });
      return {
        success: false,
        error: {
          code: 'TASK_CONFLICT',
          message: `Task '${taskId}' changed on disk during the update; nothing was written. Reload and try again.`,
        },
      };
    }

    try {
      await this.fs.writeFile(carrier, nextRaw);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] carrier write failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        success: false,
        error: { code: 'WRITE_FAILED', message: 'Failed to write task.md.' },
      };
    }

    // File mutated first (R3.5) — now let the index reparse this folder.
    if (!deferNotify) await this.notify(root, taskId);

    const reparsed = parseTaskFile(taskId, nextRaw);
    const task = reparsed.kind === 'task' ? reparsed.task : parsed.task;
    return { success: true, task };
  }

  private async notify(root: string, folderName: string): Promise<void> {
    try {
      await this.indexNotifier.applyFolderChange(root, folderName);
    } catch (error: unknown) {
      this.logger.warn('[task-specs] index notify failed', {
        folderName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async listFolderNames(specsDir: string): Promise<string[]> {
    try {
      if (!(await this.fs.exists(specsDir))) return [];
      const entries = await this.fs.readDirectory(specsDir);
      return entries
        .filter((e) => e.type === FileType.Directory)
        .map((e) => e.name);
    } catch {
      return [];
    }
  }
}
