/**
 * Task index store — the derived, rebuildable index over `task_specs`
 * (migration 0029). Files remain the source of truth; this table is a fast
 * read model for the board/list RPCs so they never touch disk (NFR-4).
 *
 * Two implementations satisfy ONE interface:
 *  - `SqliteTaskIndexStore` over the shared `PERSISTENCE_TOKENS.SQLITE_CONNECTION`.
 *  - `InMemoryTaskIndexStore` (Map-backed) for the no-SQLite VS Code
 *    native-module failure case (NFR-5/NFR-6). Behaviour is identical; the
 *    RPC surface degrades transparently.
 *
 * Excluded folders (no valid frontmatter) get NO row in `task_specs` — they are
 * not tasks. They ARE carried as typed rows on the scan meta so the board can
 * name every skipped folder instead of reporting a bare count (TASK_2026_179,
 * step 10).
 *
 * Store methods are synchronous (better-sqlite3 is synchronous); the async
 * seam is owned by `TaskIndexService`.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import type {
  ExcludedTaskFolder,
  TaskSpecSummary,
  TaskStatus,
  TaskType,
  TaskValidationIssue,
} from '@ptah-extension/shared';

/** Optional filters applied to a workspace listing (list/board RPCs). */
export interface TaskIndexFilters {
  status?: readonly TaskStatus[];
  type?: readonly TaskType[];
}

/** Per-workspace scan metadata — the excluded folders + last full scan. */
export interface TaskIndexMeta {
  /**
   * Every folder the scan skipped, BY NAME with its typed reason. Written and
   * read by both store impls; `excludedCount` is always `excluded.length`.
   */
  excluded: ExcludedTaskFolder[];
  excludedCount: number;
  lastFullScanAt: number | null;
}

/**
 * One store interface, two impls. All methods keyed on an already-normalized
 * `workspaceRoot` (the caller — `TaskIndexService` — normalizes once).
 */
export interface ITaskIndexStore {
  /**
   * Replace an entire workspace's rows in ONE transaction: delete every row
   * for the workspace, re-insert `tasks`, and record the `excluded` folders.
   * This is the "rebuild equivalent to fresh" guarantee (R3.2) by construction.
   *
   * `excluded` is the FULL row set, not a count — the count is derived from it
   * so the two can never disagree.
   */
  replaceWorkspace(
    workspaceRoot: string,
    tasks: readonly TaskSpecSummary[],
    excluded: readonly ExcludedTaskFolder[],
  ): void;
  /** Upsert rows without touching the rest of the workspace. */
  upsertMany(workspaceRoot: string, tasks: readonly TaskSpecSummary[]): void;
  /** Delete a single folder's row (folder removed or became excluded). */
  deleteByFolder(workspaceRoot: string, folderName: string): void;
  /** Read a workspace's rows, newest-first, with optional status/type filter. */
  listByWorkspace(
    workspaceRoot: string,
    filters?: TaskIndexFilters,
  ): TaskSpecSummary[];
  getMeta(workspaceRoot: string): TaskIndexMeta | null;
  setMeta(workspaceRoot: string, meta: TaskIndexMeta): void;
}

/** Sort newest-first by `created`; null-created last, alphabetical by folder. */
function orderSummaries(tasks: TaskSpecSummary[]): TaskSpecSummary[] {
  return [...tasks].sort((a, b) => {
    if (a.created && b.created) {
      if (a.created === b.created)
        return a.folderName.localeCompare(b.folderName);
      return a.created < b.created ? 1 : -1;
    }
    if (a.created && !b.created) return -1;
    if (!a.created && b.created) return 1;
    return a.folderName.localeCompare(b.folderName);
  });
}

/** Apply optional status/type filters (both are OR-within, AND-across). */
function applyFilters(
  tasks: TaskSpecSummary[],
  filters?: TaskIndexFilters,
): TaskSpecSummary[] {
  if (!filters) return tasks;
  return tasks.filter((t) => {
    if (filters.status && filters.status.length > 0) {
      if (!filters.status.includes(t.status)) return false;
    }
    if (filters.type && filters.type.length > 0) {
      if (t.type === null || !filters.type.includes(t.type)) return false;
    }
    return true;
  });
}

/** Copy excluded rows so no caller can mutate what the store handed back. */
function cloneExcluded(
  excluded: readonly ExcludedTaskFolder[],
): ExcludedTaskFolder[] {
  return excluded.map((row) => ({ ...row }));
}

/** Deep-ish clone so in-memory callers never mutate stored rows. */
function cloneSummary(task: TaskSpecSummary): TaskSpecSummary {
  return {
    ...task,
    dependsOn: [...task.dependsOn],
    validationIssues: task.validationIssues.map((i) => ({ ...i })),
  };
}

// ── SQLite implementation ────────────────────────────────────────────────────

interface RawTaskRow {
  workspace_root: string;
  folder_name: string;
  task_id: string;
  status: string;
  type: string | null;
  title: string;
  description: string | null;
  assignee: string | null;
  depends_on: string;
  executor: string | null;
  claim: string | null;
  created_at: string | null;
  updated_at: string | null;
  frontmatter_valid: number;
  validation_issues: string;
  last_indexed_at: number;
}

interface RawMetaRow {
  workspace_root: string;
  excluded_count: number;
  last_full_scan_at: number | null;
}

/**
 * SQLite-backed store over the shared connection. All SQL is static with bound
 * parameters (no interpolation). Filtering is applied in JS over the
 * workspace-scoped (indexed) row set — trivially fast for the phase-1 scale.
 *
 * ## Why the excluded ROWS are held in process, not in a table
 *
 * `task_specs_scan_meta` persists `excluded_count` only, and the design for
 * TASK_2026_179 explicitly rejects a schema migration for this work. That
 * rejection costs nothing here: the excluded set is pure scan output, and NO
 * read path can observe it before a scan has produced it. `TaskIndexService`
 * calls `ensureStarted` before every list/board read, and `ensureStarted`
 * always performs a full `rebuild` → `replaceWorkspace`. A persisted copy would
 * therefore be overwritten before it could ever be read — exactly as true of
 * the `excluded_count` column that already exists. Keeping the rows beside the
 * connection gives both impls identical semantics with no DDL.
 */
@injectable()
export class SqliteTaskIndexStore implements ITaskIndexStore {
  /** Excluded rows per workspace root — see the class note above. */
  private readonly excludedRows = new Map<string, ExcludedTaskFolder[]>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  replaceWorkspace(
    workspaceRoot: string,
    tasks: readonly TaskSpecSummary[],
    excluded: readonly ExcludedTaskFolder[],
  ): void {
    const now = Date.now();
    const del = this.db.prepare(
      'DELETE FROM task_specs WHERE workspace_root = ?',
    );
    const ins = this.db.prepare(this.insertSql());
    const meta = this.db.prepare(this.metaUpsertSql());
    const txn = this.db.transaction(() => {
      del.run(workspaceRoot);
      for (const task of tasks) {
        ins.run(...this.insertParams(workspaceRoot, task, now));
      }
      meta.run(workspaceRoot, excluded.length, now);
    });
    txn();
    // Only after the transaction commits, so a failed write leaves the rows
    // and the count describing the same (previous) scan.
    this.excludedRows.set(workspaceRoot, cloneExcluded(excluded));
  }

  upsertMany(workspaceRoot: string, tasks: readonly TaskSpecSummary[]): void {
    const now = Date.now();
    const ins = this.db.prepare(this.insertSql());
    const txn = this.db.transaction(() => {
      for (const task of tasks) {
        ins.run(...this.insertParams(workspaceRoot, task, now));
      }
    });
    txn();
  }

  deleteByFolder(workspaceRoot: string, folderName: string): void {
    this.db
      .prepare(
        'DELETE FROM task_specs WHERE workspace_root = ? AND folder_name = ?',
      )
      .run(workspaceRoot, folderName);
  }

  listByWorkspace(
    workspaceRoot: string,
    filters?: TaskIndexFilters,
  ): TaskSpecSummary[] {
    const rows = this.db
      .prepare('SELECT * FROM task_specs WHERE workspace_root = ?')
      .all(workspaceRoot) as RawTaskRow[];
    const summaries = rows.map((r) => this.rowToSummary(r));
    return applyFilters(orderSummaries(summaries), filters);
  }

  getMeta(workspaceRoot: string): TaskIndexMeta | null {
    const row = this.db
      .prepare('SELECT * FROM task_specs_scan_meta WHERE workspace_root = ?')
      .get(workspaceRoot) as RawMetaRow | undefined;
    if (!row) return null;
    return {
      excluded: cloneExcluded(this.excludedRows.get(workspaceRoot) ?? []),
      excludedCount: row.excluded_count,
      lastFullScanAt: row.last_full_scan_at,
    };
  }

  setMeta(workspaceRoot: string, meta: TaskIndexMeta): void {
    this.db
      .prepare(this.metaUpsertSql())
      .run(workspaceRoot, meta.excluded.length, meta.lastFullScanAt);
    this.excludedRows.set(workspaceRoot, cloneExcluded(meta.excluded));
  }

  private insertSql(): string {
    return `
      INSERT INTO task_specs (
        workspace_root, folder_name, task_id, status, type, title,
        description, assignee, depends_on, executor, claim,
        created_at, updated_at, frontmatter_valid, validation_issues,
        last_indexed_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(workspace_root, folder_name) DO UPDATE SET
        task_id = excluded.task_id,
        status = excluded.status,
        type = excluded.type,
        title = excluded.title,
        description = excluded.description,
        assignee = excluded.assignee,
        depends_on = excluded.depends_on,
        executor = excluded.executor,
        claim = excluded.claim,
        created_at = excluded.created_at,
        updated_at = excluded.updated_at,
        frontmatter_valid = excluded.frontmatter_valid,
        validation_issues = excluded.validation_issues,
        last_indexed_at = excluded.last_indexed_at
    `;
  }

  private metaUpsertSql(): string {
    return `
      INSERT INTO task_specs_scan_meta (
        workspace_root, excluded_count, last_full_scan_at
      ) VALUES (?,?,?)
      ON CONFLICT(workspace_root) DO UPDATE SET
        excluded_count = excluded.excluded_count,
        last_full_scan_at = excluded.last_full_scan_at
    `;
  }

  private insertParams(
    workspaceRoot: string,
    task: TaskSpecSummary,
    now: number,
  ): unknown[] {
    return [
      workspaceRoot,
      task.folderName,
      task.id,
      task.status,
      task.type ?? null,
      task.title,
      task.description ?? null,
      task.assignee ?? null,
      JSON.stringify(task.dependsOn ?? []),
      task.executor ?? null,
      null, // claim — reserved, phase 2
      task.created,
      task.updated,
      task.frontmatterValid ? 1 : 0,
      JSON.stringify(task.validationIssues ?? []),
      now,
    ];
  }

  private rowToSummary(row: RawTaskRow): TaskSpecSummary {
    const summary: TaskSpecSummary = {
      // C1: folder name is the canonical id.
      id: row.folder_name,
      folderName: row.folder_name,
      status: row.status as TaskStatus,
      type: (row.type as TaskType | null) ?? null,
      title: row.title,
      dependsOn: this.parseJsonArray(row.depends_on),
      created: row.created_at,
      updated: row.updated_at,
      frontmatterValid: row.frontmatter_valid === 1,
      validationIssues: this.parseIssues(row.validation_issues),
    };
    if (row.description !== null) summary.description = row.description;
    if (row.assignee !== null) summary.assignee = row.assignee;
    if (row.executor !== null) summary.executor = row.executor;
    return summary;
  }

  private parseJsonArray(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
    } catch {
      return [];
    }
  }

  private parseIssues(raw: string): TaskValidationIssue[] {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TaskValidationIssue[]) : [];
    } catch {
      return [];
    }
  }
}

// ── In-memory implementation (no-SQLite fallback) ────────────────────────────

/**
 * Map-backed parity impl for the native-module failure case. Same semantics as
 * `SqliteTaskIndexStore`; files remain the source of truth so a rebuild is a
 * no-cost `replaceWorkspace`.
 */
@injectable()
export class InMemoryTaskIndexStore implements ITaskIndexStore {
  private readonly rows = new Map<string, Map<string, TaskSpecSummary>>();
  private readonly meta = new Map<string, TaskIndexMeta>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  replaceWorkspace(
    workspaceRoot: string,
    tasks: readonly TaskSpecSummary[],
    excluded: readonly ExcludedTaskFolder[],
  ): void {
    const folder = new Map<string, TaskSpecSummary>();
    for (const task of tasks) {
      folder.set(task.folderName, cloneSummary(task));
    }
    this.rows.set(workspaceRoot, folder);
    this.meta.set(workspaceRoot, {
      excluded: cloneExcluded(excluded),
      excludedCount: excluded.length,
      lastFullScanAt: Date.now(),
    });
  }

  upsertMany(workspaceRoot: string, tasks: readonly TaskSpecSummary[]): void {
    const folder =
      this.rows.get(workspaceRoot) ?? new Map<string, TaskSpecSummary>();
    for (const task of tasks) {
      folder.set(task.folderName, cloneSummary(task));
    }
    this.rows.set(workspaceRoot, folder);
  }

  deleteByFolder(workspaceRoot: string, folderName: string): void {
    this.rows.get(workspaceRoot)?.delete(folderName);
  }

  listByWorkspace(
    workspaceRoot: string,
    filters?: TaskIndexFilters,
  ): TaskSpecSummary[] {
    const folder = this.rows.get(workspaceRoot);
    if (!folder) return [];
    const summaries = [...folder.values()].map((t) => cloneSummary(t));
    return applyFilters(orderSummaries(summaries), filters);
  }

  getMeta(workspaceRoot: string): TaskIndexMeta | null {
    const meta = this.meta.get(workspaceRoot);
    return meta ? { ...meta, excluded: cloneExcluded(meta.excluded) } : null;
  }

  setMeta(workspaceRoot: string, meta: TaskIndexMeta): void {
    this.meta.set(workspaceRoot, {
      ...meta,
      excluded: cloneExcluded(meta.excluded),
      excludedCount: meta.excluded.length,
    });
  }
}
