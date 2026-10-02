/**
 * Session organization service — the rules around the store.
 *
 * Owns:
 *  - availability: usable exactly when the SQLite connection is open and
 *    migrated (`store.isReady()`, read live). Captures while it is not are
 *    dropped and logged, never buffered (lane L8). The one exception is the
 *    delete cascade (AC6): a delete only removes rows, nothing else would ever
 *    remove them, and the Electron boot serves RPCs seconds before SQLite
 *    opens. So a delete received while closed is held in memory (bounded,
 *    ids only — no second store) and applied when the store opens;
 *  - the workspace key (D3, lane L9): `normalizeWorkspaceRoot(metadata.workspaceId)`,
 *    falling back to the caller's hint only when the session's metadata exists
 *    but carries no workspace. A session id with NO metadata — a webview tab id,
 *    or an SDK session not bound yet — is dropped and logged before any store
 *    call. It is never written under that id and never "repaired" from the hint
 *    alone (plan :743-750). Every root that reaches the store is normalized;
 *  - validation of every value against the shared vocabulary tuples, and PR
 *    URL canonicalization (`parsePrUrl`) before a URL reaches the store;
 *  - `onDidChange` after every committed write.
 *
 * Two faces:
 *  - `ISessionOrganizationRecorder` (capture producers in other libs): the five
 *    methods return nothing and never throw; a write that cannot be applied is
 *    logged and dropped;
 *  - the query/mutation API for the RPC handlers: mutations return the
 *    discriminated `SessionOrganizationMutationResult`, throw
 *    `SessionOrganizationInputError` for input the handler should have
 *    rejected, and let any other storage error through for the handler to
 *    sanitize.
 *
 * Logs through `IOutputChannel` with the `[SessionOrganization]` prefix (D15).
 */
import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  normalizeWorkspaceRoot,
  type IDisposable,
  type IEvent,
  type IOutputChannel,
  type ISessionOrganizationRecorder,
} from '@ptah-extension/platform-core';
import {
  SDK_TOKENS,
  type SessionMetadataStore,
} from '@ptah-extension/agent-sdk';
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
  SessionLinkTaskParams,
  SessionOrganizationChangedPayload,
  SessionOrganizationMutationResult,
  SessionOrganizationSummary,
  SessionPrLinkSource,
  SessionPrState,
  SessionRemovePrLinkParams,
  SessionSetOrganizationParams,
  SessionTaskLinkSource,
  SessionUnlinkTaskParams,
} from '@ptah-extension/shared';
import { SESSION_ORGANIZATION_TOKENS } from './di/tokens';
import type {
  SessionOrganizationPatch,
  SessionOrganizationStore,
  StoredOrganization,
  StoredSessionTaskLink,
} from './session-organization.store';
import { parsePrUrl } from './utils/pr-url';

const LOG_PREFIX = '[SessionOrganization]';

const UNAVAILABLE_MESSAGE = 'Session organization storage is not available';

/**
 * Upper bound on deletes held while the store is closed. One boot window sees
 * a handful (a user delete, an importer prune); the cap only stops a store
 * that never opens from growing the set without limit.
 */
const MAX_DEFERRED_DELETES = 1000;

interface DeferredDelete {
  root: string;
  sessionId: string;
}

type RecorderInput<K extends keyof ISessionOrganizationRecorder> = Parameters<
  ISessionOrganizationRecorder[K]
>[0];

/** The part of the metadata store this service reads. */
export type SessionOrganizationMetadataReader = Pick<
  SessionMetadataStore,
  'get'
>;

/** Change event: the affected sessions of one workspace, and why. */
export type SessionOrganizationChange = SessionOrganizationChangedPayload;

/** Input of `linkSessionTask`. Unlike the RPC params, `source` is required. */
export interface SessionTaskLinkMutation extends Omit<
  SessionLinkTaskParams,
  'source'
> {
  source: SessionTaskLinkSource;
}

/** Input of `addSessionPrLink`. */
export interface SessionPrLinkMutation {
  sessionId: string;
  url: string;
  state?: SessionPrState;
  source: SessionPrLinkSource;
}

/**
 * A mutation input outside the shared vocabulary (or an unusable URL). The
 * RPC schemas reject these first, so reaching it means a caller skipped them;
 * the handler maps it to `INVALID_PARAMS`.
 */
export class SessionOrganizationInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionOrganizationInputError';
  }
}

type RootResolution =
  { ok: true; root: string } | { ok: false; reason: 'no-metadata' | 'no-root' };

const DROP_REASONS: Record<'no-metadata' | 'no-root', string> = {
  'no-metadata':
    'session id has no metadata (likely a tab id or a session not bound yet)',
  'no-root': 'neither the session metadata nor the hint names a workspace',
};

/**
 * Map a stored record (or none: defaults, lane L12) to the wire summary.
 * `missingTaskIds` marks linked tasks whose folder is gone from the task
 * index; the service has no task index and passes an empty set.
 */
export function toSessionOrganizationSummary(
  stored: StoredOrganization | undefined,
  childCount: number,
  missingTaskIds: ReadonlySet<string>,
): SessionOrganizationSummary {
  return {
    priority: stored?.priority ?? SESSION_ORGANIZATION_DEFAULTS.priority,
    status: stored?.status ?? SESSION_ORGANIZATION_DEFAULTS.status,
    pinned: stored?.pinned ?? SESSION_ORGANIZATION_DEFAULTS.pinned,
    worktreePath: stored?.worktreePath ?? null,
    branch: stored?.branch ?? null,
    parentSessionId: stored?.parentSessionId ?? null,
    forkOfSessionId: stored?.forkOfSessionId ?? null,
    startedBy: stored?.startedBy ?? SESSION_ORGANIZATION_DEFAULTS.startedBy,
    tasks: (stored?.tasks ?? []).map((task) => ({
      ...task,
      missing: missingTaskIds.has(task.taskId),
    })),
    prLinks: (stored?.prLinks ?? []).map((pr) => ({ ...pr })),
    childCount,
    updatedAt: stored?.updatedAt ?? null,
  };
}

@injectable()
export class SessionOrganizationService
  implements ISessionOrganizationRecorder, IDisposable
{
  private readonly listeners = new Set<
    (e: SessionOrganizationChange) => void
  >();

  /** Deletes received while the store was closed, keyed by root + id. */
  private readonly deferredDeletes = new Map<string, DeferredDelete>();

  /** Store-open subscription; held only while deletes are deferred. */
  private openSubscription: IDisposable | null = null;

  constructor(
    @inject(SESSION_ORGANIZATION_TOKENS.STORE)
    private readonly store: SessionOrganizationStore,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly metadata: SessionOrganizationMetadataReader,
    @inject(PLATFORM_TOKENS.OUTPUT_CHANNEL)
    private readonly output: IOutputChannel,
  ) {}

  /** Fires after every committed write. Released by `dispose()`. */
  readonly onDidChange: IEvent<SessionOrganizationChange> = (listener) => {
    this.listeners.add(listener);
    return { dispose: () => this.listeners.delete(listener) };
  };

  /** Usable exactly while the SQLite connection is open and migrated (read live). */
  isAvailable(): boolean {
    try {
      return this.store.isReady();
    } catch (error: unknown) {
      // degradation-audit: optional-capability - a readiness check that throws
      // means the store is unusable; every caller treats false as "organization
      // unavailable", and the error is logged to the output channel below.
      this.log(`isAvailable: readiness check failed: ${describe(error)}`);
      return false;
    }
  }

  /** Drop every change listener and any deferred delete. Idempotent. */
  dispose(): void {
    this.listeners.clear();
    this.deferredDeletes.clear();
    this.releaseOpenSubscription();
  }

  // ── Recorder port (never throws, returns nothing) ─────────────────────────

  recordWorktree(input: RecorderInput<'recordWorktree'>): void {
    this.guarded('recordWorktree', input, () =>
      this.recordWorktreeInput(input),
    );
  }

  private recordWorktreeInput(input: RecorderInput<'recordWorktree'>): void {
    const invalid =
      invalidId(input.sessionId, 'sessionId') ??
      invalidText(input.worktreePath, 'worktreePath') ??
      invalidOptionalText(input.branch, 'branch');
    const patch: SessionOrganizationPatch = {
      worktreePath: input.worktreePath,
      ...(input.branch !== undefined ? { branch: input.branch } : {}),
    };
    this.capture(
      'recordWorktree',
      input.sessionId,
      input.workspaceRootHint,
      invalid,
      (root, now) => {
        this.store.upsertOrganization(root, input.sessionId, patch, now);
        return [input.sessionId];
      },
    );
  }

  recordLineage(input: RecorderInput<'recordLineage'>): void {
    this.guarded('recordLineage', input, () => this.recordLineageInput(input));
  }

  private recordLineageInput(input: RecorderInput<'recordLineage'>): void {
    const invalid =
      invalidId(input.sessionId, 'sessionId') ??
      invalidOptionalId(input.parentSessionId, 'parentSessionId') ??
      invalidOptionalId(input.forkOfSessionId, 'forkOfSessionId') ??
      invalidOptionalMember(SESSION_STARTED_BY, input.startedBy, 'startedBy') ??
      (input.parentSessionId === undefined &&
      input.forkOfSessionId === undefined &&
      input.startedBy === undefined
        ? 'nothing to record'
        : null) ??
      (input.parentSessionId === input.sessionId ||
      input.forkOfSessionId === input.sessionId
        ? 'a session cannot descend from itself'
        : null);
    const patch: SessionOrganizationPatch = {
      ...(input.parentSessionId !== undefined
        ? { parentSessionId: input.parentSessionId }
        : {}),
      ...(input.forkOfSessionId !== undefined
        ? { forkOfSessionId: input.forkOfSessionId }
        : {}),
      ...(input.startedBy !== undefined ? { startedBy: input.startedBy } : {}),
    };
    this.capture(
      'recordLineage',
      input.sessionId,
      input.workspaceRootHint,
      invalid,
      (root, now) => {
        this.store.upsertOrganization(root, input.sessionId, patch, now);
        return withParent(input.sessionId, input.parentSessionId);
      },
    );
  }

  linkTask(input: RecorderInput<'linkTask'>): void {
    this.guarded('linkTask', input, () => this.linkTaskInput(input));
  }

  private linkTaskInput(input: RecorderInput<'linkTask'>): void {
    const invalid =
      invalidId(input.sessionId, 'sessionId') ??
      invalidText(input.taskId, 'taskId') ??
      invalidMember(SESSION_TASK_LINK_ROLES, input.role, 'role') ??
      invalidMember(SESSION_TASK_LINK_SOURCES, input.source, 'source');
    this.capture(
      'linkTask',
      input.sessionId,
      input.workspaceRootHint,
      invalid,
      (root, now) => {
        this.store.linkTask(
          root,
          input.sessionId,
          { taskId: input.taskId, role: input.role, source: input.source },
          now,
        );
        return [input.sessionId];
      },
    );
  }

  /**
   * Record a PR link. The URL is canonicalized first (`parsePrUrl`), so the
   * same GitHub PR is stored once however it was written.
   *
   * A re-add of a known URL refreshes `number`, `repo` and `state` ONLY when
   * the new value is known (the store's COALESCE upsert). A known PR field
   * therefore can never be reset to null by a re-add: to clear one, remove
   * the link and add it again.
   */
  addPrLink(input: RecorderInput<'addPrLink'>): void {
    this.guarded('addPrLink', input, () => this.addPrLinkInput(input));
  }

  private addPrLinkInput(input: RecorderInput<'addPrLink'>): void {
    const parsed = parsePrUrl(input.url);
    const invalid =
      invalidId(input.sessionId, 'sessionId') ??
      (parsed === null
        ? 'url is not an https URL of at most 2048 chars'
        : null) ??
      invalidOptionalMember(SESSION_PR_STATES, input.state, 'state') ??
      invalidMember(SESSION_PR_LINK_SOURCES, input.source, 'source');
    this.capture(
      'addPrLink',
      input.sessionId,
      input.workspaceRootHint,
      invalid,
      (root, now) => {
        if (parsed === null) return [];
        this.store.addPrLink(
          root,
          input.sessionId,
          {
            url: parsed.url,
            number: parsed.number,
            repo: parsed.repo,
            state: input.state ?? null,
            source: input.source,
          },
          now,
        );
        return [input.sessionId];
      },
    );
  }

  /**
   * TASK_2026_584 child session, in one store transaction. `workspaceRoot` is
   * the hint: the child's own metadata still decides the key (D3), and the
   * child must have metadata (no tab ids).
   */
  recordAgentStartedSession(
    input: RecorderInput<'recordAgentStartedSession'>,
  ): void {
    this.guarded('recordAgentStartedSession', input, () =>
      this.recordAgentStartedSessionInput(input),
    );
  }

  private recordAgentStartedSessionInput(
    input: RecorderInput<'recordAgentStartedSession'>,
  ): void {
    const invalid =
      invalidId(input.sessionId, 'sessionId') ??
      invalidText(input.workspaceRoot, 'workspaceRoot') ??
      invalidText(input.worktreePath, 'worktreePath') ??
      invalidText(input.branch, 'branch') ??
      invalidOptionalId(input.parentSessionId, 'parentSessionId') ??
      invalidOptionalText(input.taskId, 'taskId') ??
      (input.parentSessionId === input.sessionId
        ? 'a session cannot descend from itself'
        : null);
    this.capture(
      'recordAgentStartedSession',
      input.sessionId,
      input.workspaceRoot,
      invalid,
      (root, now) => {
        this.store.recordAgentStartedSession(
          { ...input, workspaceRoot: root },
          now,
        );
        return withParent(input.sessionId, input.parentSessionId);
      },
    );
  }

  // ── Mutations (RPC handlers) ──────────────────────────────────────────────

  /** Set priority, workflow status and/or pin. At least one field. */
  async setOrganization(
    params: SessionSetOrganizationParams,
  ): Promise<SessionOrganizationMutationResult> {
    requireValid(
      invalidId(params.sessionId, 'sessionId') ??
        invalidOptionalMember(
          SESSION_PRIORITIES,
          params.priority,
          'priority',
        ) ??
        invalidOptionalMember(
          SESSION_WORKFLOW_STATUSES,
          params.status,
          'status',
        ) ??
        (params.pinned !== undefined && typeof params.pinned !== 'boolean'
          ? 'pinned must be a boolean'
          : null) ??
        (params.priority === undefined &&
        params.status === undefined &&
        params.pinned === undefined
          ? 'at least one of priority, status or pinned is required'
          : null),
    );
    const patch: SessionOrganizationPatch = {
      ...(params.priority !== undefined ? { priority: params.priority } : {}),
      ...(params.status !== undefined ? { status: params.status } : {}),
      ...(params.pinned !== undefined ? { pinned: params.pinned } : {}),
    };
    return this.mutate('setOrganization', params.sessionId, (root, now) => {
      this.store.upsertOrganization(root, params.sessionId, patch, now);
      return true;
    });
  }

  /** Link a task. A `primary` link demotes the session's other primary (L2). */
  async linkSessionTask(
    input: SessionTaskLinkMutation,
  ): Promise<SessionOrganizationMutationResult> {
    requireValid(
      invalidId(input.sessionId, 'sessionId') ??
        invalidText(input.taskId, 'taskId') ??
        invalidMember(SESSION_TASK_LINK_ROLES, input.role, 'role') ??
        invalidMember(SESSION_TASK_LINK_SOURCES, input.source, 'source'),
    );
    return this.mutate('linkSessionTask', input.sessionId, (root, now) => {
      this.store.linkTask(
        root,
        input.sessionId,
        { taskId: input.taskId, role: input.role, source: input.source },
        now,
      );
      return true;
    });
  }

  /** Remove a task link. Removing an absent link is ok and changes nothing. */
  async unlinkSessionTask(
    params: SessionUnlinkTaskParams,
  ): Promise<SessionOrganizationMutationResult> {
    requireValid(
      invalidId(params.sessionId, 'sessionId') ??
        invalidText(params.taskId, 'taskId'),
    );
    return this.mutate('unlinkSessionTask', params.sessionId, (root, now) =>
      this.store.unlinkTask(root, params.sessionId, params.taskId, now),
    );
  }

  /**
   * Add (or refresh) a PR link under its canonical URL.
   *
   * A re-add refreshes `number`, `repo` and `state` only when the new value
   * is known (the store's COALESCE upsert), so a known field — `state` in
   * particular — can never be reset to null by a re-add. Clearing means
   * `removeSessionPrLink` followed by `addSessionPrLink`.
   */
  async addSessionPrLink(
    input: SessionPrLinkMutation,
  ): Promise<SessionOrganizationMutationResult> {
    const parsed = parsePrUrl(input.url);
    requireValid(
      invalidId(input.sessionId, 'sessionId') ??
        (parsed === null
          ? 'url must be an https URL of at most 2048 characters'
          : null) ??
        invalidOptionalMember(SESSION_PR_STATES, input.state, 'state') ??
        invalidMember(SESSION_PR_LINK_SOURCES, input.source, 'source'),
    );
    return this.mutate('addSessionPrLink', input.sessionId, (root, now) => {
      if (parsed === null) return false;
      this.store.addPrLink(
        root,
        input.sessionId,
        {
          url: parsed.url,
          number: parsed.number,
          repo: parsed.repo,
          state: input.state ?? null,
          source: input.source,
        },
        now,
      );
      return true;
    });
  }

  /** Remove a PR link; the URL is canonicalized the same way as on add. */
  async removeSessionPrLink(
    params: SessionRemovePrLinkParams,
  ): Promise<SessionOrganizationMutationResult> {
    const parsed = parsePrUrl(params.url);
    requireValid(
      invalidId(params.sessionId, 'sessionId') ??
        (parsed === null
          ? 'url must be an https URL of at most 2048 characters'
          : null),
    );
    return this.mutate('removeSessionPrLink', params.sessionId, (root, now) =>
      parsed === null
        ? false
        : this.store.removePrLink(root, params.sessionId, parsed.url, now),
    );
  }

  // ── Queries (RPC handlers) ────────────────────────────────────────────────

  /**
   * The organization map of a workspace for `session:list`, keyed by session
   * id. Empty while the store is unavailable.
   */
  queryWorkspace(workspaceRoot: string): Map<string, StoredOrganization> {
    return this.read('queryWorkspace', new Map(), () =>
      this.store.listWorkspace(normalizeWorkspaceRoot(workspaceRoot)),
    );
  }

  /** Child count per parent session id. Empty while unavailable. */
  countChildren(workspaceRoot: string): Map<string, number> {
    return this.read('countChildren', new Map(), () =>
      this.store.countChildren(normalizeWorkspaceRoot(workspaceRoot)),
    );
  }

  /** Task links of a workspace (optionally for `taskIds`). Empty while unavailable. */
  listTaskLinks(
    workspaceRoot: string,
    taskIds?: readonly string[],
  ): StoredSessionTaskLink[] {
    return this.read('listTaskLinks', [], () =>
      this.store.listTaskLinks(normalizeWorkspaceRoot(workspaceRoot), taskIds),
    );
  }

  // ── Lifecycle captures (capture service) ──────────────────────────────────

  /**
   * Delete cascade (D7): remove a deleted session's rows in its workspace.
   * The metadata is already gone, so the caller passes the root it had.
   * While the store is closed the delete is deferred and applied when it
   * opens (see the class header). Never throws.
   */
  removeSession(workspaceRoot: string, sessionId: string): void {
    try {
      const root = normalizeWorkspaceRoot(workspaceRoot);
      if (!this.isAvailable()) {
        this.deferDelete(root, sessionId);
        return;
      }
      this.deleteRows(root, sessionId);
    } catch (error: unknown) {
      this.log(`removeSession failed for ${sessionId}: ${describe(error)}`);
    }
  }

  /**
   * The SDK rebound a conversation to a new id (G1): move its rows in every
   * workspace and emit one change per affected root. Never throws.
   */
  rekeySession(oldId: string, newId: string): void {
    if (oldId === newId) return;
    if (!this.isAvailable()) {
      this.log(`rekeySession dropped (${oldId} -> ${newId}): store not open`);
      return;
    }
    try {
      const roots = this.store.rekeySession(oldId, newId);
      if (roots.length > 0) {
        this.log(
          `rekeySession: moved ${oldId} -> ${newId} in ${roots.length} workspace(s)`,
        );
      }
      for (const root of roots) {
        this.emitChange({
          workspaceRoot: root,
          sessionIds: [oldId, newId],
          reason: 'capture',
        });
      }
    } catch (error: unknown) {
      this.log(
        `rekeySession failed (${oldId} -> ${newId}): ${describe(error)}`,
      );
    }
  }

  // ── private ────────────────────────────────────────────────────────────────

  /** Remove the rows; a change event only when a row was removed. Throws. */
  private deleteRows(root: string, sessionId: string): void {
    if (this.store.deleteSession(root, sessionId)) {
      this.emitChange({
        workspaceRoot: root,
        sessionIds: [sessionId],
        reason: 'delete',
      });
    }
  }

  /** Hold a delete until the store opens. Bounded; one log line each. */
  private deferDelete(root: string, sessionId: string): void {
    const key = `${root}\u0000${sessionId}`;
    if (
      !this.deferredDeletes.has(key) &&
      this.deferredDeletes.size >= MAX_DEFERRED_DELETES
    ) {
      this.log(
        `removeSession dropped for ${sessionId}: store not open and ` +
          `${MAX_DEFERRED_DELETES} deletes already deferred`,
      );
      return;
    }
    this.deferredDeletes.set(key, { root, sessionId });
    this.log(
      `removeSession deferred for ${sessionId}: store not open; applied when it opens`,
    );
    this.watchForOpen();
  }

  /** Subscribe once to the store opening, while deletes are deferred. */
  private watchForOpen(): void {
    if (this.openSubscription !== null) return;
    try {
      this.openSubscription = this.store.onDidOpen(() => {
        void this.applyDeferredDeletes();
      });
    } catch (error: unknown) {
      // degradation-audit: reported - without the open signal the deferred
      // deletes stay in memory (bounded) and are not applied this run; the
      // rows stay hidden from session:list, which joins from metadata.
      this.log(
        `deferred deletes cannot watch the store open: ${describe(error)}`,
      );
    }
  }

  /**
   * Apply the deletes deferred while the store was closed. Runs on every open
   * (a reopen too) and is idempotent: deleting absent rows changes nothing.
   *
   * Conservative: a session whose metadata exists again is skipped, so rows of
   * a live session are never removed. Rows of other sessions are never
   * touched — only the exact (root, id) pairs a `deleted` event named. Stops
   * when the store closes again and keeps the rest for the next open. Never
   * throws; one log line per failure and one summary line.
   */
  private async applyDeferredDeletes(): Promise<void> {
    let applied = 0;
    for (const [key, entry] of [...this.deferredDeletes]) {
      // Gone already: handled by a drain from an earlier open, or disposed.
      if (!this.deferredDeletes.has(key)) continue;
      if (!this.isAvailable()) return;
      try {
        if ((await this.metadata.get(entry.sessionId)) !== null) {
          this.log(
            `deferred removeSession skipped for ${entry.sessionId}: the session exists again`,
          );
        } else if (!this.isAvailable()) {
          return;
        } else {
          this.deleteRows(entry.root, entry.sessionId);
          applied++;
        }
      } catch (error: unknown) {
        // degradation-audit: reported - same outcome as a failed immediate
        // cascade (plan failure table): the rows stay, hidden from
        // session:list, and the next delete of the same id removes them.
        this.log(
          `deferred removeSession failed for ${entry.sessionId}: ${describe(error)}`,
        );
      }
      this.deferredDeletes.delete(key);
    }
    if (applied > 0) {
      this.log(`applied ${applied} deferred delete(s) after the store opened`);
    }
    if (this.deferredDeletes.size === 0) this.releaseOpenSubscription();
  }

  private releaseOpenSubscription(): void {
    const subscription = this.openSubscription;
    this.openSubscription = null;
    try {
      subscription?.dispose();
    } catch (error: unknown) {
      // degradation-audit: reported - a failed unsubscribe leaves one listener
      // on the connection; the next open finds no deferred delete and returns.
      this.log(
        `releasing the store-open subscription failed: ${describe(error)}`,
      );
    }
  }

  /**
   * Synchronous guard for a recorder method. Producers in other libs call
   * through an untyped boundary, so `undefined`, `null` or a non-object input
   * must end in one "dropped" line, never a throw into the producer.
   */
  private guarded(call: string, input: unknown, body: () => void): void {
    if (typeof input !== 'object' || input === null) {
      this.log(`${call} dropped: input is not an object`);
      return;
    }
    try {
      body();
    } catch (error: unknown) {
      this.log(`${call} dropped: ${describe(error)}`);
    }
  }

  /**
   * Recorder pipeline: validate → resolve the root from metadata (drops tab
   * ids before any store call) → availability → write → change event. Runs
   * detached; every failure ends in one log line.
   */
  private capture(
    call: string,
    sessionId: string,
    hint: string | undefined,
    invalid: string | null,
    write: (root: string, now: number) => string[],
  ): void {
    if (invalid !== null) {
      this.log(`${call} dropped: ${invalid}`);
      return;
    }
    void this.runCapture(call, sessionId, hint, write);
  }

  private async runCapture(
    call: string,
    sessionId: string,
    hint: string | undefined,
    write: (root: string, now: number) => string[],
  ): Promise<void> {
    try {
      const resolution = await this.resolveRoot(sessionId, hint);
      if (!resolution.ok) {
        this.log(
          `${call} dropped for ${sessionId}: ${DROP_REASONS[resolution.reason]}`,
        );
        return;
      }
      if (!this.isAvailable()) {
        this.log(`${call} dropped for ${sessionId}: store not open`);
        return;
      }
      const sessionIds = write(resolution.root, Date.now());
      if (sessionIds.length > 0) {
        this.emitChange({
          workspaceRoot: resolution.root,
          sessionIds,
          reason: 'capture',
        });
      }
    } catch (error: unknown) {
      this.log(`${call} failed for ${sessionId}: ${describe(error)}`);
    }
  }

  /**
   * Mutation pipeline. `write` returns whether anything changed; only a change
   * emits. A storage failure while the connection is closed (the `db` getter
   * throws) reads as unavailable; any other error is logged and rethrown.
   */
  private async mutate(
    call: string,
    sessionId: string,
    write: (root: string, now: number) => boolean,
  ): Promise<SessionOrganizationMutationResult> {
    if (!this.isAvailable()) return this.unavailable(call, sessionId);
    const resolution = await this.resolveRoot(sessionId, undefined);
    if (!resolution.ok) {
      return {
        ok: false,
        reason: 'session-not-found',
        message: 'Session not found',
      };
    }
    const root = resolution.root;
    try {
      if (write(root, Date.now())) {
        this.emitChange({
          workspaceRoot: root,
          sessionIds: [sessionId],
          reason: 'user',
        });
      }
      const stored = this.store.listWorkspace(root).get(sessionId);
      const childCount = this.store.countChildren(root).get(sessionId) ?? 0;
      return {
        ok: true,
        organization: toSessionOrganizationSummary(
          stored,
          childCount,
          new Set(),
        ),
      };
    } catch (error: unknown) {
      if (!this.isAvailable()) return this.unavailable(call, sessionId);
      this.log(`${call} failed for ${sessionId}: ${describe(error)}`);
      throw error;
    }
  }

  private unavailable(
    call: string,
    sessionId: string,
  ): SessionOrganizationMutationResult {
    this.log(`${call} for ${sessionId}: store not open`);
    return {
      ok: false,
      reason: 'organization-unavailable',
      message: UNAVAILABLE_MESSAGE,
    };
  }

  /** Guarded read: the fallback while unavailable; other errors propagate. */
  private read<T>(call: string, fallback: T, query: () => T): T {
    if (!this.isAvailable()) return fallback;
    try {
      return query();
    } catch (error: unknown) {
      if (!this.isAvailable()) {
        this.log(`${call}: store closed during the read`);
        return fallback;
      }
      throw error;
    }
  }

  /** D3: metadata `workspaceId` first; the hint only when metadata exists. */
  private async resolveRoot(
    sessionId: string,
    hint: string | undefined,
  ): Promise<RootResolution> {
    const metadata = await this.metadata.get(sessionId);
    if (!metadata) return { ok: false, reason: 'no-metadata' };
    const raw = nonBlank(metadata.workspaceId) ?? nonBlank(hint);
    if (raw === undefined) return { ok: false, reason: 'no-root' };
    return { ok: true, root: normalizeWorkspaceRoot(raw) };
  }

  /** A throwing listener is logged; it never undoes a committed write. */
  private emitChange(change: SessionOrganizationChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error: unknown) {
        this.log(`change listener failed: ${describe(error)}`);
      }
    }
  }

  private log(message: string): void {
    this.output.appendLine(`${LOG_PREFIX} ${message}`);
  }
}

// ── Validation helpers (null = valid, string = why not) ─────────────────────

function nonBlank(value: string | undefined): string | undefined {
  return typeof value === 'string' && value.trim().length > 0
    ? value
    : undefined;
}

function invalidText(value: unknown, field: string): string | null {
  return typeof value === 'string' && value.trim().length > 0
    ? null
    : `${field} must be a non-empty string`;
}

function invalidOptionalText(value: unknown, field: string): string | null {
  return value === undefined ? null : invalidText(value, field);
}

/** Session ids are logged on drop, so an id must also be a single short line. */
function invalidId(value: unknown, field: string): string | null {
  return (
    invalidText(value, field) ??
    ((value as string).length > 256 || /[\r\n]/.test(value as string)
      ? `${field} is not a session id`
      : null)
  );
}

function invalidOptionalId(value: unknown, field: string): string | null {
  return value === undefined ? null : invalidId(value, field);
}

function invalidMember(
  vocabulary: readonly string[],
  value: unknown,
  field: string,
): string | null {
  return typeof value === 'string' && vocabulary.includes(value)
    ? null
    : `${field} must be one of ${vocabulary.join(', ')}`;
}

function invalidOptionalMember(
  vocabulary: readonly string[],
  value: unknown,
  field: string,
): string | null {
  return value === undefined ? null : invalidMember(vocabulary, value, field);
}

function requireValid(invalid: string | null): void {
  if (invalid !== null) throw new SessionOrganizationInputError(invalid);
}

function withParent(sessionId: string, parentSessionId?: string): string[] {
  return parentSessionId !== undefined
    ? [sessionId, parentSessionId]
    : [sessionId];
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
