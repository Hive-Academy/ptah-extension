import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  VSCodeService,
  rpcCall,
  type MessageHandler,
} from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  MESSAGE_TYPES,
  type GitInfoResult,
  type GitStatusUpdatePayload,
  type GitTurnChangeSetsResult,
  type TurnChangeSet,
  type TurnChangeSetFileStatus,
} from '@ptah-extension/shared';

const LOG_PREFIX = '[ChangeSetStore]';

/** A status read younger than this is reused for a non-forced reconcile. */
export const RECONCILE_FRESHNESS_MS = 5_000;
/** Reconcile triggers for one session coalesce into one run after this delay. */
export const RECONCILE_DEBOUNCE_MS = 1_000;
/**
 * How long after `session:turnEnded` a turn's change set may still arrive. The
 * recorder snapshots git status and reads numstat before it pushes
 * (`turn-change-set-recorder.service.ts` `recordTurn`), and a turn that changed
 * no files pushes nothing at all, so silence past this window means "none".
 */
export const TURN_CHANGE_SET_GRACE_MS = 5_000;
/** Matches the backend's per-session bound. */
const MAX_CHANGE_SETS_PER_SESSION = 100;
/** Sessions whose change sets stay in memory; the oldest non-active is dropped. */
const MAX_CACHED_SESSIONS = 8;
const RPC_TIMEOUT_MS = 30_000;

const FILE_STATUSES: ReadonlySet<TurnChangeSetFileStatus> = new Set([
  'A',
  'M',
  'D',
  'R',
  'U',
]);

/** What the current git status says about one change set's files. */
export interface ChangeSetMarks {
  /** Files absent from the current status: no longer changed against HEAD. */
  readonly reconciled: ReadonlySet<string>;
  /** Files the current status reports as unmerged (`U`). */
  readonly conflicted: ReadonlySet<string>;
}

const NO_MARKS: ChangeSetMarks = Object.freeze({
  reconciled: new Set<string>(),
  conflicted: new Set<string>(),
});
const NO_CHANGE_SETS: readonly TurnChangeSet[] = Object.freeze([]);

/** One successful status read for a session, reduced to what marks need. */
interface StatusSnapshot {
  readonly workspaceRoot: string;
  readonly readAt: number;
  readonly present: ReadonlySet<string>;
  /** Untracked directories git reports collapsed, without a trailing slash. */
  readonly untrackedDirs: readonly string[];
  readonly conflicted: ReadonlySet<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isChangeSetFile(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value['path'] === 'string' &&
    value['path'] !== '' &&
    FILE_STATUSES.has(value['status'] as TurnChangeSetFileStatus) &&
    (value['binary'] === undefined || typeof value['binary'] === 'boolean')
  );
}

/**
 * Pushes and RPC results cross the webview boundary, so each record is
 * checked for the fields this store and the card read before it reaches view
 * state. A record without files is dropped: there is no card for zero files.
 */
function isTurnChangeSet(value: unknown): value is TurnChangeSet {
  if (!isRecord(value)) return false;
  const files = value['files'];
  return (
    typeof value['sessionId'] === 'string' &&
    value['sessionId'] !== '' &&
    typeof value['workspaceRoot'] === 'string' &&
    typeof value['turnStartedAt'] === 'number' &&
    typeof value['turnEndedAt'] === 'number' &&
    typeof value['truncatedCount'] === 'number' &&
    typeof value['countsUnavailable'] === 'boolean' &&
    isRecord(value['totals']) &&
    Array.isArray(files) &&
    files.length > 0 &&
    files.every(isChangeSetFile)
  );
}

function changeSetKey(changeSet: TurnChangeSet): string {
  return `${changeSet.turnStartedAt}:${changeSet.turnEndedAt}`;
}

function trimTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') end--;
  return path.slice(0, end);
}

/** Forward slashes, no trailing slash, drive paths case-folded. */
function normalizeRoot(root: string): string {
  const slashed = trimTrailingSlashes(root.replaceAll('\\', '/'));
  return /^[a-z]:\//i.test(slashed) ? slashed.toLowerCase() : slashed;
}

function sameRoot(a: string, b: string): boolean {
  return normalizeRoot(a) === normalizeRoot(b);
}

/** Merge by turn, oldest first, newest {@link MAX_CHANGE_SETS_PER_SESSION} kept. */
function mergeChangeSets(
  current: readonly TurnChangeSet[],
  incoming: readonly TurnChangeSet[],
): readonly TurnChangeSet[] {
  const byKey = new Map<string, TurnChangeSet>();
  for (const changeSet of current)
    byKey.set(changeSetKey(changeSet), changeSet);
  for (const changeSet of incoming) {
    const key = changeSetKey(changeSet);
    if (!byKey.has(key)) byKey.set(key, changeSet);
  }
  return [...byKey.values()]
    .sort((a, b) => a.turnEndedAt - b.turnEndedAt)
    .slice(-MAX_CHANGE_SETS_PER_SESSION);
}

/**
 * The snapshot a status read gives, or `null` when it cannot be trusted: no
 * repository, or a status the backend could not read (an empty list then is
 * NOT a clean tree, and treating it as one would mark every file reconciled).
 */
function toSnapshot(
  workspaceRoot: string,
  info: GitInfoResult,
): StatusSnapshot | null {
  if (!info.isGitRepo || info.statusUnavailable) return null;
  if (!Array.isArray(info.files)) return null;
  const present = new Set<string>();
  const untrackedDirs: string[] = [];
  const conflicted = new Set<string>();
  for (const file of info.files) {
    if (!isRecord(file) || typeof file.path !== 'string') continue;
    const path = file.path.replaceAll('\\', '/');
    if (file.isDirectory) {
      untrackedDirs.push(trimTrailingSlashes(path));
      continue;
    }
    present.add(path);
    if (file.status === 'U') conflicted.add(path);
  }
  return {
    workspaceRoot,
    readAt: Date.now(),
    present,
    untrackedDirs,
    conflicted,
  };
}

function marksOf(
  changeSet: TurnChangeSet,
  snapshot: StatusSnapshot,
): ChangeSetMarks {
  const reconciled = new Set<string>();
  const conflicted = new Set<string>();
  for (const file of changeSet.files) {
    if (snapshot.conflicted.has(file.path)) {
      conflicted.add(file.path);
      continue;
    }
    const stillChanged =
      snapshot.present.has(file.path) ||
      snapshot.untrackedDirs.some((dir) => file.path.startsWith(`${dir}/`));
    if (!stillChanged) reconciled.add(file.path);
  }
  return reconciled.size === 0 && conflicted.size === 0
    ? NO_MARKS
    : { reconciled, conflicted };
}

/**
 * Marks when no trustworthy status read exists: the files recorded as
 * unmerged at turn end stay conflicted, nothing is reconciled. A status read
 * replaces this entirely, so a conflict resolved since the turn reconciles.
 */
function recordedMarks(changeSet: TurnChangeSet): ChangeSetMarks {
  const conflicted = new Set<string>();
  for (const file of changeSet.files) {
    if (file.status === 'U') conflicted.add(file.path);
  }
  return conflicted.size === 0
    ? NO_MARKS
    : { reconciled: new Set<string>(), conflicted };
}

/**
 * Turn change sets per session, and what the current git status says about
 * them (TASK_2026_576, Component 20).
 *
 * ## Loading
 *
 * Each switch to a session reads its persisted sets once with
 * `git:turnChangeSets`; live `git:turnChangeSet` pushes merge in by turn. A
 * failed read leaves only the live sets and is logged. Sets of at most
 * {@link MAX_CACHED_SESSIONS} sessions stay in memory.
 *
 * ## Reconciliation
 *
 * One status read per session view decides which recorded files no longer
 * change HEAD and which are conflicted. Session open, `session:turnEnded` and
 * a `git:status-update` for a loaded session's tree all request it; the
 * requests for one session coalesce into one run {@link RECONCILE_DEBOUNCE_MS}
 * later, a run reuses a read younger than {@link RECONCILE_FRESHNESS_MS} unless
 * the trigger says the tree moved, and a run never overlaps another for the
 * same session. A `git:status-update` carries the status itself, so it costs
 * no RPC, and a read already in flight when it arrives is discarded so an
 * older read never replaces it. There is one pending timer per session with
 * cards — none per card.
 *
 * A failed or untrustworthy read drops the marks: cards then show their
 * recorded counts with no reconciled rows. Counts are never rewritten, so a
 * failure can never show zeros.
 *
 * ## Settled through
 *
 * The backend pushes nothing for a turn that changed no files, so "no set yet"
 * and "no set ever" look the same. {@link settledThrough} tells them apart: a
 * backend timestamp at or before which every ended turn's set is already in
 * {@link changeSetsFor} or will never come. The first read of a session
 * settles through the moment it started; `session:turnEnded` and
 * `session:turnFailed` settle through the payload's `timestamp` (the value the
 * recorder stamps as `turnEndedAt`) once a pushed set reaches it or
 * {@link TURN_CHANGE_SET_GRACE_MS} passes. One grace timer per session.
 */
@Injectable({ providedIn: 'root' })
export class ChangeSetStore implements MessageHandler {
  private readonly vscode = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.GIT_TURN_CHANGE_SET,
    MESSAGE_TYPES.SESSION_TURN_ENDED,
    MESSAGE_TYPES.SESSION_TURN_FAILED,
    MESSAGE_TYPES.GIT_STATUS_UPDATE,
  ] as const;

  private readonly _changeSets = signal<
    ReadonlyMap<string, readonly TurnChangeSet[]>
  >(new Map());
  private readonly _snapshots = signal<ReadonlyMap<string, StatusSnapshot>>(
    new Map(),
  );
  private readonly _settledThrough = signal<ReadonlyMap<string, number>>(
    new Map(),
  );

  /** Marks per change set, rebuilt only when sets or snapshots change. */
  private readonly marks = computed(() => {
    const result = new Map<TurnChangeSet, ChangeSetMarks>();
    const changeSets = this._changeSets();
    for (const [sessionId, snapshot] of this._snapshots()) {
      for (const changeSet of changeSets.get(sessionId) ?? NO_CHANGE_SETS) {
        if (!sameRoot(changeSet.workspaceRoot, snapshot.workspaceRoot)) {
          continue;
        }
        result.set(changeSet, marksOf(changeSet, snapshot));
      }
    }
    return result;
  });

  /** Fallback marks per set, kept so a card input keeps its identity. */
  private readonly recorded = new WeakMap<TurnChangeSet, ChangeSetMarks>();
  private readonly loads = new Map<string, Promise<void>>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly forced = new Set<string>();
  private readonly pushedStatus = new Map<string, GitInfoResult>();
  private readonly inFlight = new Set<string>();
  private readonly rerun = new Set<string>();
  /**
   * Bumped by every applied or dropped snapshot and by every accepted status
   * push; a read whose start generation is no longer current is discarded.
   */
  private readonly generations = new Map<string, number>();
  /** Per session: the ended turn awaiting its set, and its grace timer. */
  private readonly graces = new Map<
    string,
    { readonly endedAt: number; readonly timer: ReturnType<typeof setTimeout> }
  >();

  constructor() {
    effect(() => {
      const sessionId = this.tabManager.activeTabSessionId();
      if (sessionId) untracked(() => void this.ensureLoaded(sessionId));
    });
    inject(DestroyRef).onDestroy(() => {
      for (const timer of this.timers.values()) clearTimeout(timer);
      this.timers.clear();
      for (const grace of this.graces.values()) clearTimeout(grace.timer);
      this.graces.clear();
    });
  }

  /** The session's change sets, oldest first. Reactive when read in a template. */
  changeSetsFor(
    sessionId: string | null | undefined,
  ): readonly TurnChangeSet[] {
    if (!sessionId) return NO_CHANGE_SETS;
    return this._changeSets().get(sessionId) ?? NO_CHANGE_SETS;
  }

  /**
   * Backend time (ms) through which the session's change sets are final: a
   * turn that ended at or before it and has no set in {@link changeSetsFor}
   * never will. `-Infinity` until the first read or turn end settles it.
   * Reactive when read in a computed.
   */
  settledThrough(sessionId: string | null | undefined): number {
    if (!sessionId) return -Infinity;
    return this._settledThrough().get(sessionId) ?? -Infinity;
  }

  /**
   * Reconcile marks for one card, and the single source of "conflicted" for
   * the card and for click routing. With a trustworthy status read the marks
   * follow the current status only; without one, the recorded `U` files are
   * the conflicted set and nothing is reconciled.
   */
  marksFor(changeSet: TurnChangeSet): ChangeSetMarks {
    const current = this.marks().get(changeSet);
    if (current) return current;
    let recorded = this.recorded.get(changeSet);
    if (!recorded) {
      recorded = recordedMarks(changeSet);
      this.recorded.set(changeSet, recorded);
    }
    return recorded;
  }

  /**
   * Read the session's persisted change sets and request a reconcile. A call
   * while a read for the same session is in flight joins it.
   */
  ensureLoaded(sessionId: string): Promise<void> {
    const pending = this.loads.get(sessionId);
    if (pending) return pending;
    const load = this.load(sessionId).finally(() =>
      this.loads.delete(sessionId),
    );
    this.loads.set(sessionId, load);
    return load;
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    switch (message.type) {
      case MESSAGE_TYPES.GIT_TURN_CHANGE_SET:
        this.onChangeSetPushed(message.payload);
        return;
      case MESSAGE_TYPES.SESSION_TURN_ENDED:
        this.onTurnEnded(message.payload);
        return;
      case MESSAGE_TYPES.SESSION_TURN_FAILED:
        // The recorder records a failed turn too; only the settle applies.
        this.startGrace(message.payload);
        return;
      case MESSAGE_TYPES.GIT_STATUS_UPDATE:
        this.onStatusUpdate(message.payload);
        return;
    }
  }

  private async load(sessionId: string): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.read(sessionId);
    } finally {
      // Only the first read settles: a later one (a re-shown tab) may start
      // while a turn streams, and must not mark that turn's set as final.
      if (!this._settledThrough().has(sessionId)) {
        this.settle(sessionId, startedAt);
      }
    }
  }

  private async read(sessionId: string): Promise<void> {
    try {
      const result = await rpcCall<GitTurnChangeSetsResult>(
        this.vscode,
        'git:turnChangeSets',
        { sessionId },
        RPC_TIMEOUT_MS,
      );
      const changeSets: unknown = result.data?.changeSets;
      if (!result.success || !Array.isArray(changeSets)) {
        console.warn(
          `${LOG_PREFIX} Could not read change sets; showing live ones only.`,
          result.error,
        );
        return;
      }
      const valid = changeSets.filter(
        (changeSet: unknown): changeSet is TurnChangeSet =>
          isTurnChangeSet(changeSet) && changeSet.sessionId === sessionId,
      );
      this.merge(sessionId, valid);
      this.requestReconcile(sessionId, false);
    } catch (error: unknown) {
      console.warn(
        `${LOG_PREFIX} Could not read change sets; showing live ones only.`,
        error,
      );
    }
  }

  private onChangeSetPushed(payload: unknown): void {
    const changeSet = isRecord(payload) ? payload['changeSet'] : undefined;
    if (!isTurnChangeSet(changeSet)) return;
    const { sessionId } = changeSet;
    // A session nobody has opened reads the set from storage when it opens.
    if (
      !this._changeSets().has(sessionId) &&
      this.tabManager.activeTabSessionId() !== sessionId
    ) {
      return;
    }
    this.merge(sessionId, [changeSet]);
    this.requestReconcile(sessionId, false);
    const grace = this.graces.get(sessionId);
    if (grace && changeSet.turnEndedAt >= grace.endedAt) {
      clearTimeout(grace.timer);
      this.graces.delete(sessionId);
    }
    this.settle(sessionId, changeSet.turnEndedAt);
  }

  private onTurnEnded(payload: unknown): void {
    const sessionId = isRecord(payload) ? payload['sessionId'] : undefined;
    if (typeof sessionId !== 'string') return;
    // The turn may have committed or reverted files an older card lists.
    this.requestReconcile(sessionId, true);
    this.startGrace(payload);
  }

  /**
   * Wait {@link TURN_CHANGE_SET_GRACE_MS} for the ended turn's set, then
   * settle through its end. Only for a session already read or active, the
   * same rule as a push; a newer turn end restarts the one timer.
   */
  private startGrace(payload: unknown): void {
    if (!isRecord(payload)) return;
    const sessionId = payload['sessionId'];
    const endedAt = payload['timestamp'];
    if (
      typeof sessionId !== 'string' ||
      sessionId === '' ||
      typeof endedAt !== 'number' ||
      !Number.isFinite(endedAt)
    ) {
      return;
    }
    if (
      !this._changeSets().has(sessionId) &&
      this.tabManager.activeTabSessionId() !== sessionId
    ) {
      return;
    }
    if (endedAt <= this.settledThrough(sessionId)) return;
    const previous = this.graces.get(sessionId);
    if (previous) clearTimeout(previous.timer);
    const through = Math.max(endedAt, previous?.endedAt ?? endedAt);
    const timer = setTimeout(() => {
      this.graces.delete(sessionId);
      this.settle(sessionId, through);
    }, TURN_CHANGE_SET_GRACE_MS);
    this.graces.set(sessionId, { endedAt: through, timer });
  }

  /** Advance the session's settled-through mark; it never moves back. */
  private settle(sessionId: string, through: number): void {
    this._settledThrough.update((current) => {
      if ((current.get(sessionId) ?? -Infinity) >= through) return current;
      const next = new Map(current);
      next.set(sessionId, through);
      return next;
    });
  }

  /**
   * A watcher push carries the status of one tree, so it replaces the RPC for
   * every loaded session in that tree — the active one and any other visible
   * canvas tile. A push for any other tree says nothing about them.
   *
   * The push is newer than any read still in flight for those sessions, so
   * their generation advances now: that read is discarded when it lands and
   * can never replace the pushed status, even inside the debounce window.
   */
  private onStatusUpdate(payload: unknown): void {
    if (!isRecord(payload)) return;
    const status = payload as unknown as GitStatusUpdatePayload;
    const pushRoot =
      status.workspaceRoot ?? this.vscode.config().workspaceRoot ?? '';
    if (!pushRoot) return;
    for (const sessionId of this._changeSets().keys()) {
      const root = this.rootFor(sessionId);
      if (!root || !sameRoot(pushRoot, root)) continue;
      this.pushedStatus.set(sessionId, status);
      this.bumpGeneration(sessionId);
      this.requestReconcile(sessionId, true);
    }
  }

  private merge(sessionId: string, incoming: readonly TurnChangeSet[]): void {
    const current = this._changeSets();
    const next = new Map(current);
    // Re-inserted so Map order is recency order for eviction.
    next.delete(sessionId);
    next.set(
      sessionId,
      mergeChangeSets(current.get(sessionId) ?? NO_CHANGE_SETS, incoming),
    );
    const evicted = this.evict(next, sessionId);
    this._changeSets.set(next);
    for (const evictedId of evicted) this.forget(evictedId);
  }

  /** Drop the least recently touched sessions past the cap, never the active one. */
  private evict(
    changeSets: Map<string, readonly TurnChangeSet[]>,
    touched: string,
  ): string[] {
    const active = this.tabManager.activeTabSessionId();
    const evicted: string[] = [];
    for (const sessionId of [...changeSets.keys()]) {
      if (changeSets.size <= MAX_CACHED_SESSIONS) break;
      if (sessionId === active || sessionId === touched) continue;
      changeSets.delete(sessionId);
      evicted.push(sessionId);
    }
    return evicted;
  }

  private forget(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (timer !== undefined) clearTimeout(timer);
    this.timers.delete(sessionId);
    this.forced.delete(sessionId);
    this.pushedStatus.delete(sessionId);
    this.rerun.delete(sessionId);
    this.setSnapshot(sessionId, null);
    this.generations.delete(sessionId);
    const grace = this.graces.get(sessionId);
    if (grace) clearTimeout(grace.timer);
    this.graces.delete(sessionId);
    this._settledThrough.update((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Map(current);
      next.delete(sessionId);
      return next;
    });
  }

  /** The tree the newest change set ran in; marks apply to sets in that tree. */
  private rootFor(sessionId: string): string | null {
    const changeSets = this._changeSets().get(sessionId);
    return changeSets && changeSets.length > 0
      ? changeSets[changeSets.length - 1].workspaceRoot
      : null;
  }

  private requestReconcile(sessionId: string, force: boolean): void {
    if (!this.rootFor(sessionId)) return;
    if (force) this.forced.add(sessionId);
    if (this.timers.has(sessionId)) return;
    this.timers.set(
      sessionId,
      setTimeout(() => {
        this.timers.delete(sessionId);
        void this.reconcile(sessionId);
      }, RECONCILE_DEBOUNCE_MS),
    );
  }

  private async reconcile(sessionId: string): Promise<void> {
    const root = this.rootFor(sessionId);
    if (!root) return;
    // A pushed status costs no RPC and is newer than a read in flight, so it
    // applies even while one runs; that read is then discarded by generation.
    const pushed = this.pushedStatus.get(sessionId);
    if (pushed) {
      this.pushedStatus.delete(sessionId);
      this.forced.delete(sessionId);
      this.setSnapshot(sessionId, toSnapshot(root, pushed));
      return;
    }
    if (this.inFlight.has(sessionId)) {
      this.rerun.add(sessionId);
      return;
    }
    const force = this.forced.delete(sessionId);
    const current = this._snapshots().get(sessionId);
    if (
      !force &&
      current &&
      sameRoot(current.workspaceRoot, root) &&
      Date.now() - current.readAt < RECONCILE_FRESHNESS_MS
    ) {
      return;
    }

    const generation = this.generations.get(sessionId) ?? 0;
    this.inFlight.add(sessionId);
    let snapshot: StatusSnapshot | null = null;
    try {
      const result = await rpcCall<GitInfoResult>(
        this.vscode,
        'git:info',
        { workspaceRoot: root },
        RPC_TIMEOUT_MS,
      );
      if (result.success && result.data) {
        snapshot = toSnapshot(root, result.data);
      } else {
        console.warn(`${LOG_PREFIX} Reconcile read failed.`, result.error);
      }
    } catch (error: unknown) {
      console.warn(`${LOG_PREFIX} Reconcile read failed.`, error);
    } finally {
      this.inFlight.delete(sessionId);
    }

    // A pushed status or an eviction since the read started is newer.
    if ((this.generations.get(sessionId) ?? 0) === generation) {
      if (this._changeSets().has(sessionId)) {
        this.setSnapshot(sessionId, snapshot);
      }
    }
    if (this.rerun.delete(sessionId)) this.requestReconcile(sessionId, true);
  }

  /** Any read started before this call is now older than what the store holds. */
  private bumpGeneration(sessionId: string): void {
    this.generations.set(sessionId, (this.generations.get(sessionId) ?? 0) + 1);
  }

  private setSnapshot(
    sessionId: string,
    snapshot: StatusSnapshot | null,
  ): void {
    this.bumpGeneration(sessionId);
    this._snapshots.update((current) => {
      if (!snapshot && !current.has(sessionId)) return current;
      const next = new Map(current);
      if (snapshot) next.set(sessionId, snapshot);
      else next.delete(sessionId);
      return next;
    });
  }
}
