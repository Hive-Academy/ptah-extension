/**
 * `TaskDoctorService` — diagnose and (only when asked) repair `.ptah/specs/`.
 *
 * ## The two rules that shape this whole file
 *
 * 1. **Nothing here ever runs by itself.** `plan()` is pure computation;
 *    `apply()` is the only method that touches a task file, and it must be
 *    called explicitly by a human-facing surface. Nothing wires the doctor into
 *    `ensureStarted` or any activation path, and nothing should: a migration
 *    that runs on launch is a migration nobody consented to.
 *
 * 2. **The journal IS the undo.** `.ptah/**` is gitignored, so there is no
 *    `git checkout` waiting behind a bad repair. `apply()` therefore writes
 *    `.doctor-journal.json` — recording every creation, rename and deletion,
 *    the latter two WITH the original bytes — BEFORE it mutates anything, and
 *    aborts outright if that write fails. A mutation with no undo record is not
 *    a repair, it is data loss with good intentions.
 *
 * ## Why a file stamp and not a SQLite column
 *
 * Migration gating reads `.ptah-spec-contract.json`. It cannot be a SQLite
 * column: the index store is selected LAZILY in `di/register.ts` and falls back
 * to `InMemoryTaskIndexStore` whenever better-sqlite3 fails to load, so on those
 * hosts a "have I migrated?" column would be empty on every launch and the
 * migration would re-run forever. A file in the directory being migrated is the
 * only thing whose availability matches the thing it gates.
 *
 * An UNREADABLE stamp fails closed. "I cannot tell what state this tree is in"
 * must never be treated as "it is fine to mutate".
 *
 * ## What the doctor deliberately does NOT do
 *
 *  - It never auto-normalizes a mismatched frontmatter `id:`. That mismatch is
 *    the only surviving record that an id was once declared; erasing it would
 *    let the folder-scan allocator re-issue that id to a different task. It is
 *    reported as a WARNING and nothing else.
 *  - It never backfills the carrier banner or the contract version into an
 *    existing carrier. Rewriting a file the user did not ask about is exactly
 *    the clobbering this task set exists to stop.
 */
import { inject, injectable } from 'tsyringe';
import * as path from 'path';
import {
  PLATFORM_TOKENS,
  FileType,
  type IFileSystemProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  BATCHES_FILE,
  CARRIER_FILE,
  COMPLETION_ARTIFACTS,
  CONTEXT_FILE,
  LEGACY_BATCHES_FILE,
  PLANNING_ARTIFACTS,
  SPEC_CONTRACT_VERSION,
  type TaskStatus,
  type TaskType,
} from '@ptah-extension/shared';
import { normalizeWorkspaceRoot } from './normalize-workspace-root';
import { parseTaskFile } from './task-frontmatter';
import { TaskWriterService } from './task-writer.service';

/** Doctor-private bookkeeping files. Nothing outside this service reads them. */
const JOURNAL_FILE = '.doctor-journal.json';
const CONTRACT_STAMP_FILE = '.ptah-spec-contract.json';

/** Only `TASK_*` folders are in scope; anything else is not a task folder. */
const TASK_FOLDER_RE = /^TASK_/;

// ---------------------------------------------------------------------------
// Plan model
// ---------------------------------------------------------------------------

/** Adopt a carrier-less folder by writing it a `task.md`. */
export interface AdoptAction {
  kind: 'adopt';
  folderName: string;
  title: string;
  type: TaskType;
  /** Deduced from `inferredFrom`; always written alongside `status_inferred`. */
  status: TaskStatus;
  /** The artifact filenames the status was deduced from. Empty ⇒ `backlog`. */
  inferredFrom: string[];
}

/** Move a legacy batch breakdown onto its current name. */
export interface RenameBatchesAction {
  kind: 'renameLegacyBatches';
  folderName: string;
  from: string;
  to: string;
}

export type DoctorAction = AdoptAction | RenameBatchesAction;

export interface DoctorWarning {
  folderName: string;
  code: 'id_mismatch' | 'unparseable_carrier';
  message: string;
}

export interface DoctorPlan {
  /** Normalized workspace root the plan was computed against. */
  workspaceRoot: string;
  /** Contract version this build writes. */
  contractVersion: number;
  /** Version recorded on disk, or null when the tree was never stamped. */
  stampVersion: number | null;
  actions: DoctorAction[];
  warnings: DoctorWarning[];
}

export type DoctorPlanResult =
  | { ok: true; plan: DoctorPlan }
  | { ok: false; error: { code: DoctorErrorCode; message: string } };

export type DoctorErrorCode =
  /** The stamp exists but could not be read or parsed — refuse to guess. */
  | 'STAMP_UNREADABLE'
  /** The undo record could not be written, so nothing was mutated. */
  | 'JOURNAL_WRITE_FAILED'
  /** No journal to undo. */
  | 'JOURNAL_NOT_FOUND'
  | 'JOURNAL_UNREADABLE'
  | 'SCAN_FAILED'
  | 'APPLY_FAILED';

export interface DoctorApplyResult {
  ok: boolean;
  /** Actions actually carried out. */
  applied: DoctorAction[];
  /** Where the undo record was written, or null when there was nothing to do. */
  journalPath: string | null;
  error?: { code: DoctorErrorCode; message: string };
}

export interface DoctorUndoResult {
  ok: boolean;
  reverted: number;
  error?: { code: DoctorErrorCode; message: string };
}

// ---------------------------------------------------------------------------
// Journal model
// ---------------------------------------------------------------------------

/**
 * One reversible filesystem effect.
 *
 * `delete` and `rename` carry the original bytes base64-encoded, because a
 * gitignored tree offers no other way to get them back. `create` needs no bytes
 * — its inverse is a deletion.
 */
export type DoctorJournalEntry =
  | { kind: 'create'; path: string }
  | { kind: 'delete'; path: string; contentBase64: string }
  | { kind: 'rename'; from: string; to: string; contentBase64: string };

export interface DoctorJournal {
  version: 1;
  createdAt: string;
  entries: DoctorJournalEntry[];
}

type StampState =
  | { state: 'absent' }
  | { state: 'present'; version: number }
  | { state: 'unreadable'; reason: string };

@injectable()
export class TaskDoctorService {
  constructor(
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(TOKENS.LOGGER)
    private readonly logger: Logger,
    private readonly writer: TaskWriterService,
  ) {}

  // -------------------------------------------------------------------------
  // plan — pure computation, zero writes
  // -------------------------------------------------------------------------

  /**
   * Work out what is wrong and what would fix it. Writes NOTHING.
   *
   * Callers can show the result verbatim and let a human decide; `apply()` takes
   * the returned plan back unchanged.
   */
  async plan(workspaceRoot: string): Promise<DoctorPlanResult> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const specsDir = path.join(root, '.ptah', 'specs');

    const stamp = await this.readStamp(specsDir);
    if (stamp.state === 'unreadable') {
      return this.stampRefusal(stamp.reason);
    }

    let folders: string[];
    try {
      folders = await this.listTaskFolders(specsDir);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] doctor scan failed',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        ok: false,
        error: {
          code: 'SCAN_FAILED',
          message: `Could not read ${specsDir}.`,
        },
      };
    }

    const actions: DoctorAction[] = [];
    const warnings: DoctorWarning[] = [];

    for (const folderName of folders) {
      const folderPath = path.join(specsDir, folderName);
      const docs = await this.listFileNames(folderPath);

      if (docs.includes(CARRIER_FILE)) {
        warnings.push(...(await this.inspectCarrier(folderPath, folderName)));
      } else {
        actions.push(await this.planAdoption(folderPath, folderName, docs));
      }

      // The collider rename is independent of the carrier: a folder can have a
      // perfectly good `task.md` and still hold the batch breakdown under its
      // pre-rename name.
      if (docs.includes(LEGACY_BATCHES_FILE) && !docs.includes(BATCHES_FILE)) {
        actions.push({
          kind: 'renameLegacyBatches',
          folderName,
          from: path.join(folderPath, LEGACY_BATCHES_FILE),
          to: path.join(folderPath, BATCHES_FILE),
        });
      }
    }

    return {
      ok: true,
      plan: {
        workspaceRoot: root,
        contractVersion: SPEC_CONTRACT_VERSION,
        stampVersion: stamp.state === 'present' ? stamp.version : null,
        actions,
        warnings,
      },
    };
  }

  // -------------------------------------------------------------------------
  // apply — the only mutating path, and it is fail-closed
  // -------------------------------------------------------------------------

  /**
   * Carry out a plan.
   *
   * Ordering is the safety property, not an implementation detail:
   *   1. re-check the stamp (it may have changed since `plan()`),
   *   2. compute the COMPLETE undo record, reading every byte we are about to
   *      destroy,
   *   3. write the journal,
   *   4. only then mutate.
   *
   * If step 3 fails we return before step 4. There is no partial-journal state.
   */
  async apply(plan: DoctorPlan): Promise<DoctorApplyResult> {
    const specsDir = path.join(plan.workspaceRoot, '.ptah', 'specs');

    const stamp = await this.readStamp(specsDir);
    if (stamp.state === 'unreadable') {
      const refusal = this.stampRefusal(stamp.reason);
      return {
        ok: false,
        applied: [],
        journalPath: null,
        error: refusal.error,
      };
    }

    if (plan.actions.length === 0) {
      return { ok: true, applied: [], journalPath: null };
    }

    const journalPath = path.join(specsDir, JOURNAL_FILE);

    // Step 2 — build the undo record FIRST. This reads the bytes of everything
    // a rename is going to remove, while those bytes still exist.
    let entries: DoctorJournalEntry[];
    try {
      entries = await this.buildJournalEntries(specsDir, plan, stamp);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] doctor could not build the undo record',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        ok: false,
        applied: [],
        journalPath: null,
        error: {
          code: 'JOURNAL_WRITE_FAILED',
          message:
            'Could not read the files this repair would replace, so no undo ' +
            'record could be built. Nothing was changed.',
        },
      };
    }

    // Step 3 — the fail-closed gate (R7).
    const journal: DoctorJournal = {
      version: 1,
      createdAt: new Date().toISOString(),
      entries,
    };
    try {
      await this.fs.writeFile(journalPath, JSON.stringify(journal, null, 2));
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] doctor journal write failed — aborting before any mutation',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        ok: false,
        applied: [],
        journalPath: null,
        error: {
          code: 'JOURNAL_WRITE_FAILED',
          message:
            'Could not write the undo journal. `.ptah/**` is gitignored, so ' +
            'without it a repair could not be reversed. Nothing was changed.',
        },
      };
    }

    // Step 4 — mutate.
    const applied: DoctorAction[] = [];
    try {
      for (const action of plan.actions) {
        await this.executeAction(plan.workspaceRoot, action);
        applied.push(action);
      }
      await this.fs.writeFile(
        path.join(specsDir, CONTRACT_STAMP_FILE),
        JSON.stringify(
          { version: SPEC_CONTRACT_VERSION, appliedAt: journal.createdAt },
          null,
          2,
        ),
      );
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] doctor apply failed part-way — journal retained for undo',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        ok: false,
        applied,
        journalPath,
        error: {
          code: 'APPLY_FAILED',
          message:
            `Applied ${applied.length} of ${plan.actions.length} action(s) before failing. ` +
            `The undo journal at ${JOURNAL_FILE} is intact — run undo to roll back.`,
        },
      };
    }

    return { ok: true, applied, journalPath };
  }

  // -------------------------------------------------------------------------
  // undo — reverse creations, renames and deletions alike
  // -------------------------------------------------------------------------

  /** Reverse the last `apply()`, newest effect first. */
  async undo(workspaceRoot: string): Promise<DoctorUndoResult> {
    const root = normalizeWorkspaceRoot(workspaceRoot);
    const specsDir = path.join(root, '.ptah', 'specs');
    const journalPath = path.join(specsDir, JOURNAL_FILE);

    if (!(await this.fs.exists(journalPath))) {
      return {
        ok: false,
        reverted: 0,
        error: {
          code: 'JOURNAL_NOT_FOUND',
          message: `No ${JOURNAL_FILE} found; there is nothing to undo.`,
        },
      };
    }

    let journal: DoctorJournal;
    try {
      const raw = await this.fs.readFile(journalPath);
      journal = JSON.parse(raw) as DoctorJournal;
      if (!Array.isArray(journal.entries)) {
        throw new Error('journal has no entries array');
      }
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] doctor journal unreadable',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        ok: false,
        reverted: 0,
        error: {
          code: 'JOURNAL_UNREADABLE',
          message: `${JOURNAL_FILE} could not be parsed; refusing to guess at a rollback.`,
        },
      };
    }

    let reverted = 0;
    try {
      // Reverse order: a later effect may depend on an earlier one.
      for (const entry of [...journal.entries].reverse()) {
        await this.revertEntry(entry);
        reverted++;
      }
      await this.fs.delete(journalPath);
    } catch (error: unknown) {
      this.logger.error(
        '[task-specs] doctor undo failed part-way',
        error instanceof Error ? error : new Error(String(error)),
      );
      return {
        ok: false,
        reverted,
        error: {
          code: 'APPLY_FAILED',
          message: `Reverted ${reverted} of ${journal.entries.length} effect(s) before failing.`,
        },
      };
    }

    return { ok: true, reverted };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private stampRefusal(reason: string): {
    ok: false;
    error: { code: DoctorErrorCode; message: string };
  } {
    this.logger.warn(
      '[task-specs] doctor refused — contract stamp unreadable',
      {
        reason,
      },
    );
    return {
      ok: false,
      error: {
        code: 'STAMP_UNREADABLE',
        message:
          `${CONTRACT_STAMP_FILE} exists but could not be read (${reason}). ` +
          `Refusing to run: an unreadable stamp means the migration state of ` +
          `this tree is unknown, and guessing risks re-running a repair that ` +
          `already happened.`,
      },
    };
  }

  /**
   * Read the migration stamp.
   *
   * ABSENT is a legitimate state (a tree that was never stamped) and permits the
   * doctor to run. UNREADABLE is not: it is indistinguishable from a corrupted
   * or partially-written stamp, so it fails closed.
   */
  private async readStamp(specsDir: string): Promise<StampState> {
    const stampPath = path.join(specsDir, CONTRACT_STAMP_FILE);
    let exists: boolean;
    try {
      exists = await this.fs.exists(stampPath);
    } catch (error: unknown) {
      return {
        state: 'unreadable',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
    if (!exists) return { state: 'absent' };

    try {
      const raw = await this.fs.readFile(stampPath);
      const parsed = JSON.parse(raw) as { version?: unknown };
      if (typeof parsed.version !== 'number') {
        return { state: 'unreadable', reason: 'no numeric "version" field' };
      }
      return { state: 'present', version: parsed.version };
    } catch (error: unknown) {
      return {
        state: 'unreadable',
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async listTaskFolders(specsDir: string): Promise<string[]> {
    if (!(await this.fs.exists(specsDir))) return [];
    const entries = await this.fs.readDirectory(specsDir);
    return entries
      .filter((e) => e.type === FileType.Directory)
      .map((e) => e.name)
      .filter((name) => TASK_FOLDER_RE.test(name))
      .sort();
  }

  private async listFileNames(folderPath: string): Promise<string[]> {
    try {
      const entries = await this.fs.readDirectory(folderPath);
      return entries.filter((e) => e.type === FileType.File).map((e) => e.name);
    } catch {
      return [];
    }
  }

  /**
   * Inspect an existing carrier for things worth SAYING but not worth changing.
   *
   * A mismatched `id:` lands here and nowhere else — see the class comment for
   * why normalizing it would destroy information.
   */
  private async inspectCarrier(
    folderPath: string,
    folderName: string,
  ): Promise<DoctorWarning[]> {
    let raw: string;
    try {
      raw = await this.fs.readFile(path.join(folderPath, CARRIER_FILE));
    } catch {
      return [
        {
          folderName,
          code: 'unparseable_carrier',
          message: `${folderName} has a carrier that could not be read.`,
        },
      ];
    }

    const parsed = parseTaskFile(folderName, raw);
    if (parsed.kind !== 'task') {
      return [
        {
          folderName,
          code: 'unparseable_carrier',
          message: `${folderName} has a carrier excluded as '${parsed.excluded.reason}'. Fix it by hand — the doctor will not rewrite a carrier it cannot read.`,
        },
      ];
    }

    return parsed.task.validationIssues
      .filter((issue) => issue.code === 'id_mismatch')
      .map((issue) => ({
        folderName,
        code: 'id_mismatch' as const,
        message:
          `${issue.message} Left as-is deliberately: the declared id is the ` +
          `only record that it was ever handed out, and erasing it would let ` +
          `the allocator re-issue it to a different task.`,
      }));
  }

  /**
   * Decide what an orphaned folder should become.
   *
   * Status is DEDUCED, never asserted, so the result always carries
   * `status_inferred`. The ordering matters: a folder holding a test report or
   * a review is finished work whose carrier went missing, and calling that
   * `backlog` would misreport completed work as never started.
   */
  private async planAdoption(
    folderPath: string,
    folderName: string,
    docs: string[],
  ): Promise<AdoptAction> {
    const completion = COMPLETION_ARTIFACTS.filter((name) =>
      docs.includes(name),
    );
    const planning = PLANNING_ARTIFACTS.filter((name) => docs.includes(name));

    let status: TaskStatus = 'backlog';
    let inferredFrom: string[] = [];
    if (completion.length > 0) {
      status = 'done';
      inferredFrom = [...completion];
    } else if (planning.length > 0) {
      status = 'in_progress';
      inferredFrom = [...planning];
    }

    return {
      kind: 'adopt',
      folderName,
      title: await this.inferTitle(folderPath, folderName),
      // No artifact reliably encodes the task TYPE, so the plan states the
      // neutral default explicitly rather than pretending to know. The user
      // sees it in `--plan` output before anything is written.
      type: 'FEATURE',
      status,
      inferredFrom,
    };
  }

  /** First markdown H1 in the prose doc, else the folder name. */
  private async inferTitle(
    folderPath: string,
    folderName: string,
  ): Promise<string> {
    try {
      const raw = await this.fs.readFile(path.join(folderPath, CONTEXT_FILE));
      for (const line of raw.split(/\r?\n/)) {
        const heading = /^#\s+(.+?)\s*$/.exec(line);
        if (heading && heading[1].length > 0) return heading[1];
      }
    } catch {
      // No prose doc, or unreadable — the folder name is a perfectly honest
      // title and needs no apology.
    }
    return folderName;
  }

  /**
   * Compute the complete undo record for a plan, BEFORE anything is mutated.
   *
   * Every rename reads its source bytes here, while they still exist. The stamp
   * write is journaled too — otherwise undo would leave behind a stamp claiming
   * a migration that had been rolled back.
   */
  private async buildJournalEntries(
    specsDir: string,
    plan: DoctorPlan,
    stamp: StampState,
  ): Promise<DoctorJournalEntry[]> {
    const entries: DoctorJournalEntry[] = [];

    for (const action of plan.actions) {
      if (action.kind === 'adopt') {
        entries.push({
          kind: 'create',
          path: path.join(specsDir, action.folderName, CARRIER_FILE),
        });
        continue;
      }

      const bytes = await this.fs.readFileBytes(action.from);
      entries.push({
        kind: 'rename',
        from: action.from,
        to: action.to,
        contentBase64: Buffer.from(bytes).toString('base64'),
      });
    }

    const stampPath = path.join(specsDir, CONTRACT_STAMP_FILE);
    if (stamp.state === 'absent') {
      entries.push({ kind: 'create', path: stampPath });
    } else {
      const previous = await this.fs.readFileBytes(stampPath);
      entries.push({
        kind: 'delete',
        path: stampPath,
        contentBase64: Buffer.from(previous).toString('base64'),
      });
    }

    return entries;
  }

  private async executeAction(
    workspaceRoot: string,
    action: DoctorAction,
  ): Promise<void> {
    if (action.kind === 'adopt') {
      const result = await this.writer.adoptFolder(
        workspaceRoot,
        action.folderName,
        {
          title: action.title,
          type: action.type,
          status: action.status,
          // ALWAYS. A deduced status that does not say it was deduced is a
          // fabricated fact.
          statusInferred: true,
        },
      );
      if (!result.success) {
        throw new Error(
          `adopt ${action.folderName} failed: ${result.error.code}`,
        );
      }
      return;
    }

    // The port has no `rename` — deliberately, since `vscode.workspace.fs`
    // offers nothing atomic here either. Copy-then-delete is honest about that,
    // and the journal already holds the source bytes if this is interrupted.
    const bytes = await this.fs.readFileBytes(action.from);
    await this.fs.writeFileBytes(action.to, bytes);
    await this.fs.delete(action.from);
  }

  private async revertEntry(entry: DoctorJournalEntry): Promise<void> {
    if (entry.kind === 'create') {
      if (await this.fs.exists(entry.path)) {
        await this.fs.delete(entry.path);
      }
      return;
    }
    if (entry.kind === 'delete') {
      await this.fs.writeFileBytes(
        entry.path,
        new Uint8Array(Buffer.from(entry.contentBase64, 'base64')),
      );
      return;
    }
    // rename: put the original back byte-for-byte, then remove the copy.
    await this.fs.writeFileBytes(
      entry.from,
      new Uint8Array(Buffer.from(entry.contentBase64, 'base64')),
    );
    if (await this.fs.exists(entry.to)) {
      await this.fs.delete(entry.to);
    }
  }
}
