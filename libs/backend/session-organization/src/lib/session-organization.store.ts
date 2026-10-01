/**
 * Session organization store — pure I/O over the three tables created by
 * migration 0050 (`session_organization`, `session_task_links`,
 * `session_pr_links`) on the shared `PERSISTENCE_TOKENS.SQLITE_CONNECTION`.
 *
 * Rules this file owns:
 *  - Every SQL string is static with `?` parameters. No value is ever
 *    interpolated into SQL.
 *  - Every write that touches more than one statement runs in ONE
 *    `db.transaction`, so a failure leaves the previous state intact.
 *  - Rows are created lazily on the first write (lane L12); a session without
 *    a row reads as the shared defaults.
 *  - At most one `primary` task link per session (lane L2). A new primary
 *    demotes the existing different primary to `related` BEFORE the new one is
 *    written, in the same transaction — the partial unique index
 *    `ux_session_task_links_primary` would reject the write otherwise.
 *  - Reads are tolerant (lane L1): the tables have no CHECK constraints, so an
 *    enum column may hold a value this build does not know. It reads as the
 *    default, and one `[SessionOrganization]` line is logged per list call.
 *
 * Callers pass an already-normalized `workspaceRoot` and the exact values to
 * store: PR URLs are keyed byte-for-byte (binary collation in the PK), so the
 * service canonicalizes them before they get here. Vocabulary validation also
 * belongs to the service; this store trusts its typed inputs.
 *
 * Methods are synchronous (better-sqlite3 is synchronous). The `db` getter
 * throws while the connection is closed; the service catches that.
 */
import { inject, injectable } from 'tsyringe';
import {
  PERSISTENCE_TOKENS,
  type SqliteConnectionService,
  type SqliteDatabase,
} from '@ptah-extension/persistence-sqlite';
import {
  PLATFORM_TOKENS,
  type IOutputChannel,
} from '@ptah-extension/platform-core';
import {
  SESSION_ORGANIZATION_DEFAULTS,
  SESSION_PRIORITIES,
  SESSION_PR_LINK_SOURCES,
  SESSION_PR_STATES,
  SESSION_STARTED_BY,
  SESSION_TASK_LINK_ROLES,
  SESSION_TASK_LINK_SOURCES,
  SESSION_WORKFLOW_STATUSES,
} from '@ptah-extension/shared';
import type {
  SessionPrLinkSource,
  SessionPrState,
  SessionPriority,
  SessionStartedBy,
  SessionTaskLinkRole,
  SessionTaskLinkSource,
  SessionWorkflowStatus,
} from '@ptah-extension/shared';

const LOG_PREFIX = '[SessionOrganization]';

/** Read as `related` so an unknown role can never claim the primary slot. */
const DEFAULT_TASK_LINK_ROLE: SessionTaskLinkRole = 'related';
const DEFAULT_TASK_LINK_SOURCE: SessionTaskLinkSource = 'user';
const DEFAULT_PR_LINK_SOURCE: SessionPrLinkSource = 'user';

// ── Public shapes ────────────────────────────────────────────────────────────

/** One stored task link of a session. */
export interface StoredTaskLink {
  taskId: string;
  role: SessionTaskLinkRole;
  source: SessionTaskLinkSource;
  /** Epoch ms the link was first created. */
  createdAt: number;
}

/** A task link with the session it belongs to (`listTaskLinks`). */
export interface StoredSessionTaskLink extends StoredTaskLink {
  sessionId: string;
}

/** One stored PR link of a session. */
export interface StoredPrLink {
  url: string;
  number: number | null;
  repo: string | null;
  state: SessionPrState | null;
  source: SessionPrLinkSource;
  /** Epoch ms the link was first recorded. */
  createdAt: number;
}

/**
 * Everything stored for one session in one workspace. Child counts and the
 * task index `missing` flag are not stored; the service adds them.
 */
export interface StoredOrganization {
  sessionId: string;
  priority: SessionPriority;
  status: SessionWorkflowStatus;
  pinned: boolean;
  worktreePath: string | null;
  branch: string | null;
  parentSessionId: string | null;
  forkOfSessionId: string | null;
  startedBy: SessionStartedBy;
  /** Epoch ms of the last write; null when only link rows exist. */
  updatedAt: number | null;
  tasks: StoredTaskLink[];
  prLinks: StoredPrLink[];
}

/**
 * Columns `upsertOrganization` may change. An absent key leaves the column as
 * it is; `null` clears a nullable column.
 */
export interface SessionOrganizationPatch {
  priority?: SessionPriority;
  status?: SessionWorkflowStatus;
  pinned?: boolean;
  worktreePath?: string | null;
  branch?: string | null;
  parentSessionId?: string | null;
  forkOfSessionId?: string | null;
  startedBy?: SessionStartedBy;
}

/** Input of `linkTask`. */
export interface StoredTaskLinkInput {
  taskId: string;
  role: SessionTaskLinkRole;
  source: SessionTaskLinkSource;
}

/** Input of `addPrLink`. `url` is stored exactly as received. */
export interface StoredPrLinkInput {
  url: string;
  number: number | null;
  repo: string | null;
  state: SessionPrState | null;
  source: SessionPrLinkSource;
}

/** Input of `recordAgentStartedSession` (the 584 child-session contract). */
export interface AgentStartedSessionInput {
  sessionId: string;
  workspaceRoot: string;
  parentSessionId?: string;
  worktreePath: string;
  branch: string;
  taskId?: string;
}

// ── Raw rows ─────────────────────────────────────────────────────────────────

interface RawOrganizationRow {
  session_id: string;
  priority: string;
  status: string;
  pinned: number | bigint;
  worktree_path: string | null;
  branch: string | null;
  parent_session_id: string | null;
  fork_of_session_id: string | null;
  started_by: string;
  updated_at: number | bigint;
}

interface RawTaskLinkRow {
  session_id: string;
  task_id: string;
  role: string;
  source: string;
  created_at: number | bigint;
}

interface RawPrLinkRow {
  session_id: string;
  url: string;
  number: number | bigint | null;
  repo: string | null;
  state: string | null;
  source: string;
  created_at: number | bigint;
}

interface RawChildCountRow {
  parent_session_id: string;
  n: number | bigint;
}

interface RawRootRow {
  workspace_root: string;
}

// ── Static SQL ───────────────────────────────────────────────────────────────

const SQL = {
  selectOrganizations: `
    SELECT session_id, priority, status, pinned, worktree_path, branch,
           parent_session_id, fork_of_session_id, started_by, updated_at
      FROM session_organization
     WHERE workspace_root = ?
     ORDER BY session_id`,
  selectTaskLinks: `
    SELECT session_id, task_id, role, source, created_at
      FROM session_task_links
     WHERE workspace_root = ?
     ORDER BY session_id, created_at, task_id`,
  selectTaskLinksForTasks: `
    SELECT session_id, task_id, role, source, created_at
      FROM session_task_links
     WHERE workspace_root = ?
       AND task_id IN (SELECT value FROM json_each(?))
     ORDER BY task_id, created_at, session_id`,
  selectPrLinks: `
    SELECT session_id, url, number, repo, state, source, created_at
      FROM session_pr_links
     WHERE workspace_root = ?
     ORDER BY session_id, created_at, url`,
  /** Lazy row creation (L12): defaults come from the column DEFAULTs. */
  ensureOrganization: `
    INSERT INTO session_organization (workspace_root, session_id, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_root, session_id) DO UPDATE SET
      updated_at = excluded.updated_at`,
  setPriority: `UPDATE session_organization SET priority = ?
     WHERE workspace_root = ? AND session_id = ?`,
  setStatus: `UPDATE session_organization SET status = ?
     WHERE workspace_root = ? AND session_id = ?`,
  setPinned: `UPDATE session_organization SET pinned = ?
     WHERE workspace_root = ? AND session_id = ?`,
  setWorktreePath: `UPDATE session_organization SET worktree_path = ?
     WHERE workspace_root = ? AND session_id = ?`,
  setBranch: `UPDATE session_organization SET branch = ?
     WHERE workspace_root = ? AND session_id = ?`,
  setParentSessionId: `UPDATE session_organization SET parent_session_id = ?
     WHERE workspace_root = ? AND session_id = ?`,
  setForkOfSessionId: `UPDATE session_organization SET fork_of_session_id = ?
     WHERE workspace_root = ? AND session_id = ?`,
  setStartedBy: `UPDATE session_organization SET started_by = ?
     WHERE workspace_root = ? AND session_id = ?`,
  demoteOtherPrimary: `
    UPDATE session_task_links SET role = 'related'
     WHERE workspace_root = ? AND session_id = ? AND role = 'primary'
       AND task_id <> ?`,
  upsertTaskLink: `
    INSERT INTO session_task_links
      (workspace_root, session_id, task_id, role, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_root, session_id, task_id) DO UPDATE SET
      role = excluded.role,
      source = excluded.source`,
  deleteTaskLink: `
    DELETE FROM session_task_links
     WHERE workspace_root = ? AND session_id = ? AND task_id = ?`,
  upsertPrLink: `
    INSERT INTO session_pr_links
      (workspace_root, session_id, url, number, repo, state, source, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_root, session_id, url) DO UPDATE SET
      number = COALESCE(excluded.number, session_pr_links.number),
      repo = COALESCE(excluded.repo, session_pr_links.repo),
      state = COALESCE(excluded.state, session_pr_links.state)`,
  deletePrLink: `
    DELETE FROM session_pr_links
     WHERE workspace_root = ? AND session_id = ? AND url = ?`,
  touchOrganization: `
    UPDATE session_organization SET updated_at = ?
     WHERE workspace_root = ? AND session_id = ?`,
  deleteOrganization: `
    DELETE FROM session_organization WHERE workspace_root = ? AND session_id = ?`,
  deleteAllTaskLinks: `
    DELETE FROM session_task_links WHERE workspace_root = ? AND session_id = ?`,
  deleteAllPrLinks: `
    DELETE FROM session_pr_links WHERE workspace_root = ? AND session_id = ?`,
  countChildren: `
    SELECT parent_session_id, COUNT(*) AS n
      FROM session_organization
     WHERE workspace_root = ? AND parent_session_id IS NOT NULL
     GROUP BY parent_session_id`,
  // ── rekeySession ──
  rekeyRoots: `
    SELECT workspace_root FROM session_organization
     WHERE session_id = ? OR parent_session_id = ? OR fork_of_session_id = ?
    UNION
    SELECT workspace_root FROM session_task_links WHERE session_id = ?
    UNION
    SELECT workspace_root FROM session_pr_links WHERE session_id = ?
    ORDER BY workspace_root`,
  hasOrganization: `
    SELECT 1 AS present FROM session_organization
     WHERE workspace_root = ? AND session_id = ?`,
  moveOrganization: `
    UPDATE session_organization SET session_id = ?
     WHERE workspace_root = ? AND session_id = ?`,
  /**
   * The old primary's task is already linked under the new id (so its link
   * will not move): the new id's link takes the primary role, keeping its own
   * created_at — but only when the new id holds no primary yet (L2).
   */
  promoteSharedPrimary: `
    UPDATE session_task_links SET role = 'primary'
     WHERE workspace_root = ? AND session_id = ? AND role <> 'primary'
       AND task_id IN (
         SELECT old.task_id FROM session_task_links AS old
          WHERE old.workspace_root = ? AND old.session_id = ?
            AND old.role = 'primary')
       AND NOT EXISTS (
         SELECT 1 FROM session_task_links AS kept
          WHERE kept.workspace_root = ? AND kept.session_id = ?
            AND kept.role = 'primary')`,
  /** Old primaries lose the slot when the new id already holds one. */
  demoteMovingPrimary: `
    UPDATE session_task_links SET role = 'related'
     WHERE workspace_root = ? AND session_id = ? AND role = 'primary'
       AND EXISTS (
         SELECT 1 FROM session_task_links AS kept
          WHERE kept.workspace_root = ? AND kept.session_id = ?
            AND kept.role = 'primary')`,
  moveTaskLinks: `
    UPDATE session_task_links SET session_id = ?
     WHERE workspace_root = ? AND session_id = ?
       AND task_id NOT IN (
         SELECT task_id FROM session_task_links
          WHERE workspace_root = ? AND session_id = ?)`,
  movePrLinks: `
    UPDATE session_pr_links SET session_id = ?
     WHERE workspace_root = ? AND session_id = ?
       AND url NOT IN (
         SELECT url FROM session_pr_links
          WHERE workspace_root = ? AND session_id = ?)`,
  /** A row that would point at itself after the rekey points at nothing. */
  rewriteParent: `
    UPDATE session_organization
       SET parent_session_id = CASE WHEN session_id = ? THEN NULL ELSE ? END
     WHERE workspace_root = ? AND parent_session_id = ?`,
  rewriteForkOf: `
    UPDATE session_organization
       SET fork_of_session_id = CASE WHEN session_id = ? THEN NULL ELSE ? END
     WHERE workspace_root = ? AND fork_of_session_id = ?`,
} as const;

/** Patch key → its static single-column UPDATE and the bound value. */
const PATCH_COLUMNS: ReadonlyArray<{
  key: keyof SessionOrganizationPatch;
  sql: string;
  bind: (patch: SessionOrganizationPatch) => string | number | null;
}> = [
  { key: 'priority', sql: SQL.setPriority, bind: (p) => p.priority ?? null },
  { key: 'status', sql: SQL.setStatus, bind: (p) => p.status ?? null },
  { key: 'pinned', sql: SQL.setPinned, bind: (p) => (p.pinned ? 1 : 0) },
  {
    key: 'worktreePath',
    sql: SQL.setWorktreePath,
    bind: (p) => p.worktreePath ?? null,
  },
  { key: 'branch', sql: SQL.setBranch, bind: (p) => p.branch ?? null },
  {
    key: 'parentSessionId',
    sql: SQL.setParentSessionId,
    bind: (p) => p.parentSessionId ?? null,
  },
  {
    key: 'forkOfSessionId',
    sql: SQL.setForkOfSessionId,
    bind: (p) => p.forkOfSessionId ?? null,
  },
  { key: 'startedBy', sql: SQL.setStartedBy, bind: (p) => p.startedBy ?? null },
];

// ── Tolerant read helpers ────────────────────────────────────────────────────

/** Counts the enum values a single list call had to replace with defaults. */
class UnknownValueTally {
  count = 0;

  pick<T extends string>(
    vocabulary: readonly T[],
    raw: string | null,
    fallback: T,
  ): T {
    if (raw !== null && (vocabulary as readonly string[]).includes(raw)) {
      return raw as T;
    }
    this.count++;
    return fallback;
  }

  /** Nullable enum: null stays null, an unknown value reads as null. */
  pickNullable<T extends string>(
    vocabulary: readonly T[],
    raw: string | null,
  ): T | null {
    if (raw === null) return null;
    if ((vocabulary as readonly string[]).includes(raw)) return raw as T;
    this.count++;
    return null;
  }
}

function toNumber(value: number | bigint): number {
  return typeof value === 'bigint' ? Number(value) : value;
}

function emptyOrganization(sessionId: string): StoredOrganization {
  return {
    sessionId,
    priority: SESSION_ORGANIZATION_DEFAULTS.priority,
    status: SESSION_ORGANIZATION_DEFAULTS.status,
    pinned: SESSION_ORGANIZATION_DEFAULTS.pinned,
    worktreePath: null,
    branch: null,
    parentSessionId: null,
    forkOfSessionId: null,
    startedBy: SESSION_ORGANIZATION_DEFAULTS.startedBy,
    updatedAt: null,
    tasks: [],
    prLinks: [],
  };
}

// ── Store ────────────────────────────────────────────────────────────────────

@injectable()
export class SessionOrganizationStore {
  constructor(
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: SqliteConnectionService,
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
  ) {}

  private get db(): SqliteDatabase {
    return this.connection.db;
  }

  /**
   * Open connection = usable store. Forwarded live on every call, never
   * cached: the connection opens after registration and may close later.
   */
  isReady(): boolean {
    return this.connection.isOpen;
  }

  /**
   * Every stored session of a workspace, keyed by session id. A session that
   * only has link rows reads as defaults with `updatedAt: null`.
   */
  listWorkspace(workspaceRoot: string): Map<string, StoredOrganization> {
    const tally = new UnknownValueTally();
    const result = new Map<string, StoredOrganization>();
    const entryFor = (sessionId: string): StoredOrganization => {
      let entry = result.get(sessionId);
      if (!entry) {
        entry = emptyOrganization(sessionId);
        result.set(sessionId, entry);
      }
      return entry;
    };

    const orgRows = this.db
      .prepare(SQL.selectOrganizations)
      .all(workspaceRoot) as RawOrganizationRow[];
    for (const row of orgRows) {
      result.set(row.session_id, this.toOrganization(row, tally));
    }

    const taskRows = this.db
      .prepare(SQL.selectTaskLinks)
      .all(workspaceRoot) as RawTaskLinkRow[];
    for (const row of taskRows) {
      entryFor(row.session_id).tasks.push(this.toTaskLink(row, tally));
    }

    const prRows = this.db
      .prepare(SQL.selectPrLinks)
      .all(workspaceRoot) as RawPrLinkRow[];
    for (const row of prRows) {
      entryFor(row.session_id).prLinks.push(this.toPrLink(row, tally));
    }

    this.reportUnknownValues('listWorkspace', tally);
    return result;
  }

  /**
   * Task links of a workspace, optionally only those for `taskIds`. An empty
   * `taskIds` array matches nothing.
   */
  listTaskLinks(
    workspaceRoot: string,
    taskIds?: readonly string[],
  ): StoredSessionTaskLink[] {
    if (taskIds?.length === 0) return [];
    const rows = (
      taskIds
        ? this.db
            .prepare(SQL.selectTaskLinksForTasks)
            .all(workspaceRoot, JSON.stringify(taskIds))
        : this.db.prepare(SQL.selectTaskLinks).all(workspaceRoot)
    ) as RawTaskLinkRow[];
    const tally = new UnknownValueTally();
    const links = rows.map((row) => ({
      sessionId: row.session_id,
      ...this.toTaskLink(row, tally),
    }));
    this.reportUnknownValues('listTaskLinks', tally);
    return links;
  }

  /**
   * Change only the patched columns. The row is created with the column
   * defaults on the first write (L12); `updated_at` is set to `now` either way.
   */
  upsertOrganization(
    workspaceRoot: string,
    sessionId: string,
    patch: SessionOrganizationPatch,
    now: number,
  ): void {
    this.db.transaction(() => {
      this.applyPatch(workspaceRoot, sessionId, patch, now);
    })();
  }

  /**
   * Link a task (or change an existing link's role and source). A `primary`
   * link first demotes any different primary of the session to `related`, in
   * the same transaction (L2). The original `created_at` is kept.
   */
  linkTask(
    workspaceRoot: string,
    sessionId: string,
    link: StoredTaskLinkInput,
    now: number,
  ): void {
    this.db.transaction(() => {
      this.writeTaskLink(workspaceRoot, sessionId, link, now);
    })();
  }

  /** Remove one task link. Returns whether a link was removed. */
  unlinkTask(
    workspaceRoot: string,
    sessionId: string,
    taskId: string,
    now: number,
  ): boolean {
    let removed = false;
    this.db.transaction(() => {
      removed =
        this.db
          .prepare(SQL.deleteTaskLink)
          .run(workspaceRoot, sessionId, taskId).changes > 0;
      if (removed) {
        this.db
          .prepare(SQL.touchOrganization)
          .run(now, workspaceRoot, sessionId);
      }
    })();
    return removed;
  }

  /**
   * Record a PR link, keyed on the exact `url`. A repeat of the same URL keeps
   * the first `source` and `created_at` and refreshes `number`, `repo` and
   * `state` when the new values are known.
   */
  addPrLink(
    workspaceRoot: string,
    sessionId: string,
    pr: StoredPrLinkInput,
    now: number,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(SQL.ensureOrganization)
        .run(workspaceRoot, sessionId, now);
      this.db
        .prepare(SQL.upsertPrLink)
        .run(
          workspaceRoot,
          sessionId,
          pr.url,
          pr.number,
          pr.repo,
          pr.state,
          pr.source,
          now,
        );
    })();
  }

  /** Remove one PR link by its exact URL. Returns whether a link was removed. */
  removePrLink(
    workspaceRoot: string,
    sessionId: string,
    url: string,
    now: number,
  ): boolean {
    let removed = false;
    this.db.transaction(() => {
      removed =
        this.db.prepare(SQL.deletePrLink).run(workspaceRoot, sessionId, url)
          .changes > 0;
      if (removed) {
        this.db
          .prepare(SQL.touchOrganization)
          .run(now, workspaceRoot, sessionId);
      }
    })();
    return removed;
  }

  /**
   * One agent-started child session (the 584 contract): `started_by = agent`,
   * worktree, branch, the parent when known, and the task as the `primary`
   * link with `source = agent` — all in one transaction.
   */
  recordAgentStartedSession(
    input: AgentStartedSessionInput,
    now: number,
  ): void {
    const patch: SessionOrganizationPatch = {
      startedBy: 'agent',
      worktreePath: input.worktreePath,
      branch: input.branch,
      ...(input.parentSessionId !== undefined
        ? { parentSessionId: input.parentSessionId }
        : {}),
    };
    this.db.transaction(() => {
      this.applyPatch(input.workspaceRoot, input.sessionId, patch, now);
      if (input.taskId !== undefined) {
        this.writeTaskLink(
          input.workspaceRoot,
          input.sessionId,
          { taskId: input.taskId, role: 'primary', source: 'agent' },
          now,
        );
      }
    })();
  }

  /**
   * Remove every row of a session in a workspace, over the three tables, in
   * one transaction. Children keep their `parent_session_id` (lineage is not a
   * foreign key). Returns whether any row was removed.
   */
  deleteSession(workspaceRoot: string, sessionId: string): boolean {
    let changes = 0;
    this.db.transaction(() => {
      changes += this.db
        .prepare(SQL.deleteAllTaskLinks)
        .run(workspaceRoot, sessionId).changes;
      changes += this.db
        .prepare(SQL.deleteAllPrLinks)
        .run(workspaceRoot, sessionId).changes;
      changes += this.db
        .prepare(SQL.deleteOrganization)
        .run(workspaceRoot, sessionId).changes;
    })();
    return changes > 0;
  }

  /** Child count per parent session id in a workspace. */
  countChildren(workspaceRoot: string): Map<string, number> {
    const rows = this.db
      .prepare(SQL.countChildren)
      .all(workspaceRoot) as RawChildCountRow[];
    return new Map(rows.map((r) => [r.parent_session_id, toNumber(r.n)]));
  }

  /**
   * Move a session's rows from `oldId` to `newId` in every workspace, in one
   * transaction (the SDK rebound an id; SDK ids are globally unique).
   *
   *  - Organization, task-link and PR-link rows move to `newId`, and every
   *    `parent_session_id` / `fork_of_session_id` equal to `oldId` becomes
   *    `newId` (a row that would then point at itself points at nothing).
   *  - Conflict: when `newId` already has an organization row in a workspace,
   *    that row is kept; links whose task id / URL are not yet under `newId`
   *    still move (an old primary is demoted to `related` when `newId` already
   *    has a primary), the remaining `oldId` rows are deleted, and one line is
   *    logged. When the old primary's task is already linked under `newId`
   *    and `newId` has no primary, that link of `newId` becomes the primary.
   *  - No-op when `oldId === newId` or nothing owns or references `oldId`.
   *
   * Returns the affected workspace roots, sorted.
   */
  rekeySession(oldId: string, newId: string): string[] {
    if (oldId === newId) return [];
    let roots: string[] = [];
    const conflictRoots: string[] = [];
    this.db.transaction(() => {
      roots = (
        this.db
          .prepare(SQL.rekeyRoots)
          .all(oldId, oldId, oldId, oldId, oldId) as RawRootRow[]
      ).map((r) => r.workspace_root);
      for (const root of roots) {
        if (this.rekeyInWorkspace(root, oldId, newId)) {
          conflictRoots.push(root);
        }
      }
    })();
    if (conflictRoots.length > 0) {
      this.output.appendLine(
        `${LOG_PREFIX} rekeySession: ${newId} already had an organization row in ` +
          `${conflictRoots.length} workspace(s); kept it, moved the links it ` +
          `lacked and dropped the rest of ${oldId}`,
      );
    }
    return roots;
  }

  // ── private ────────────────────────────────────────────────────────────────

  /** Rekey one workspace. Returns true when `newId` already had a row. */
  private rekeyInWorkspace(
    root: string,
    oldId: string,
    newId: string,
  ): boolean {
    const conflict =
      this.db.prepare(SQL.hasOrganization).get(root, newId) !== undefined;
    if (conflict) {
      this.db.prepare(SQL.deleteOrganization).run(root, oldId);
    } else {
      this.db.prepare(SQL.moveOrganization).run(newId, root, oldId);
    }

    // Before the old links move or are deleted: keep a primary when the old
    // primary's task is already linked (as related) under the new id.
    this.db
      .prepare(SQL.promoteSharedPrimary)
      .run(root, newId, root, oldId, root, newId);
    this.db.prepare(SQL.demoteMovingPrimary).run(root, oldId, root, newId);
    this.db.prepare(SQL.moveTaskLinks).run(newId, root, oldId, root, newId);
    this.db.prepare(SQL.deleteAllTaskLinks).run(root, oldId);

    this.db.prepare(SQL.movePrLinks).run(newId, root, oldId, root, newId);
    this.db.prepare(SQL.deleteAllPrLinks).run(root, oldId);

    this.db.prepare(SQL.rewriteParent).run(newId, newId, root, oldId);
    this.db.prepare(SQL.rewriteForkOf).run(newId, newId, root, oldId);
    return conflict;
  }

  /** Lazy insert + the patched columns. Caller owns the transaction. */
  private applyPatch(
    workspaceRoot: string,
    sessionId: string,
    patch: SessionOrganizationPatch,
    now: number,
  ): void {
    this.db.prepare(SQL.ensureOrganization).run(workspaceRoot, sessionId, now);
    for (const column of PATCH_COLUMNS) {
      if (patch[column.key] === undefined) continue;
      this.db
        .prepare(column.sql)
        .run(column.bind(patch), workspaceRoot, sessionId);
    }
  }

  /** Demote-then-write for one task link. Caller owns the transaction. */
  private writeTaskLink(
    workspaceRoot: string,
    sessionId: string,
    link: StoredTaskLinkInput,
    now: number,
  ): void {
    this.db.prepare(SQL.ensureOrganization).run(workspaceRoot, sessionId, now);
    if (link.role === 'primary') {
      this.db
        .prepare(SQL.demoteOtherPrimary)
        .run(workspaceRoot, sessionId, link.taskId);
    }
    this.db
      .prepare(SQL.upsertTaskLink)
      .run(workspaceRoot, sessionId, link.taskId, link.role, link.source, now);
  }

  private toOrganization(
    row: RawOrganizationRow,
    tally: UnknownValueTally,
  ): StoredOrganization {
    return {
      sessionId: row.session_id,
      priority: tally.pick(
        SESSION_PRIORITIES,
        row.priority,
        SESSION_ORGANIZATION_DEFAULTS.priority,
      ),
      status: tally.pick(
        SESSION_WORKFLOW_STATUSES,
        row.status,
        SESSION_ORGANIZATION_DEFAULTS.status,
      ),
      pinned: toNumber(row.pinned) === 1,
      worktreePath: row.worktree_path,
      branch: row.branch,
      parentSessionId: row.parent_session_id,
      forkOfSessionId: row.fork_of_session_id,
      startedBy: tally.pick(
        SESSION_STARTED_BY,
        row.started_by,
        SESSION_ORGANIZATION_DEFAULTS.startedBy,
      ),
      updatedAt: toNumber(row.updated_at),
      tasks: [],
      prLinks: [],
    };
  }

  private toTaskLink(
    row: RawTaskLinkRow,
    tally: UnknownValueTally,
  ): StoredTaskLink {
    return {
      taskId: row.task_id,
      role: tally.pick(
        SESSION_TASK_LINK_ROLES,
        row.role,
        DEFAULT_TASK_LINK_ROLE,
      ),
      source: tally.pick(
        SESSION_TASK_LINK_SOURCES,
        row.source,
        DEFAULT_TASK_LINK_SOURCE,
      ),
      createdAt: toNumber(row.created_at),
    };
  }

  private toPrLink(row: RawPrLinkRow, tally: UnknownValueTally): StoredPrLink {
    return {
      url: row.url,
      number: row.number === null ? null : toNumber(row.number),
      repo: row.repo,
      state: tally.pickNullable(SESSION_PR_STATES, row.state),
      source: tally.pick(
        SESSION_PR_LINK_SOURCES,
        row.source,
        DEFAULT_PR_LINK_SOURCE,
      ),
      createdAt: toNumber(row.created_at),
    };
  }

  private reportUnknownValues(call: string, tally: UnknownValueTally): void {
    if (tally.count === 0) return;
    this.output.appendLine(
      `${LOG_PREFIX} ${call}: ${tally.count} unknown enum value(s) read as defaults`,
    );
  }
}
