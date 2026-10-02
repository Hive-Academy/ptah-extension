/**
 * TurnChangeSetRecorder (TASK_2026_576 Component 19, Requirements 4.1, 4.2).
 *
 * Records the files one agent turn changed, with no dependence on a live
 * stream:
 *
 * - **Turn start** — a `UserPromptSubmit` fan-out. The hook handler hands the
 *   session's working directory over as `workspaceRoot` (the SDK query `cwd`,
 *   a worktree path when the session runs in one); when it is blank the
 *   session's stored `workingDirectory` stands in. A baseline is captured:
 *   `getGitInfo` entries plus `fs.stat` (mtime, size) of up to
 *   {@link MAX_STAT_PATHS} of them. One baseline per session, held until the
 *   turn ends.
 * - **Turn end** — `onTurnEnded` (Stop) or `onTurnFailed` (StopFailure): the
 *   baseline entry is removed at once, an after-snapshot is taken the same
 *   way, and a path counts as changed when its status, origPath or numstat
 *   differs, when it appears or disappears, or when its mtime or size differs.
 *   Line counts come from `GitInfoService.readChangeSetNumstat`.
 *
 * A non-empty set is persisted through {@link TurnChangeSetStore} and pushed
 * as `git:turnChangeSet`. An empty set records and pushes nothing; a non-git
 * directory records nothing; an unavailable after-status records nothing and
 * logs. No timers.
 */

import * as path from 'node:path';
import * as fs from 'node:fs/promises';
import { inject, injectable } from 'tsyringe';
import {
  Logger,
  TOKENS,
  type GitInfoService,
} from '@ptah-extension/vscode-core';
import {
  SDK_TOKENS,
  SdkAdapterEvents,
  UserPromptSubmitCallbackRegistry,
  type SessionMetadataStore,
  type UserPromptSubmitPayload,
} from '@ptah-extension/agent-sdk';
import {
  MESSAGE_TYPES,
  type GitFileStatus,
  type GitTurnChangeSetPayload,
  type TurnChangeSet,
  type TurnChangeSetFile,
  type TurnChangeSetFileStatus,
} from '@ptah-extension/shared';
import type { WebviewBroadcaster } from '../../handlers/session-lifecycle-notifier';
import { TurnChangeSetStore } from './turn-change-set.store';

/** Paths `fs.stat`-ed per snapshot; the rest compare by status and numstat. */
export const MAX_STAT_PATHS = 2_000;

/** Files stored per change set; the rest are counted in `truncatedCount`. */
export const MAX_FILES_PER_CHANGE_SET = 500;

/** `fs.stat` calls in flight at once while taking a snapshot. */
const STAT_CONCURRENCY = 32;

const LOG_SCOPE = '[TurnChangeSetRecorder]';

/** One path's state in a snapshot, merged across its staged/unstaged rows. */
interface PathState {
  readonly status: TurnChangeSetFileStatus;
  readonly origPath?: string;
  /** Status, origPath and numstat of every git row for the path. */
  readonly signature: string;
  /** False when the path was past {@link MAX_STAT_PATHS}. */
  readonly statted: boolean;
  /** Null when the path is absent on disk. */
  readonly mtimeMs: number | null;
  readonly size: number | null;
}

type Snapshot =
  | {
      readonly kind: 'ok';
      /**
       * The repository top level the paths are relative to (git status
       * reports root-relative paths, also from a subdirectory).
       */
      readonly repositoryRoot: string;
      readonly paths: ReadonlyMap<string, PathState>;
    }
  | { readonly kind: 'not-repo' }
  | { readonly kind: 'unavailable'; readonly reason: string };

interface BaselineSnapshot {
  /** Null when the session's working directory could not be resolved. */
  readonly workspaceRoot: string | null;
  readonly snapshot: Snapshot;
}

interface Baseline {
  readonly turnStartedAt: number;
  /** Never rejects. */
  readonly ready: Promise<BaselineSnapshot>;
}

const NOT_A_REPO: Snapshot = { kind: 'not-repo' };

interface TurnEnd {
  readonly sessionId: string;
  readonly cwd: string;
  readonly timestamp: number;
}

interface FileStat {
  readonly mtimeMs: number | null;
  readonly size: number | null;
}

const ABSENT_ON_DISK: FileStat = { mtimeMs: null, size: null };

@injectable()
export class TurnChangeSetRecorder {
  private readonly subscriptions: Array<() => void> = [];

  /** At most one entry per session; removed when the turn ends. */
  private readonly baselines = new Map<string, Baseline>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    sdkAdapterEvents: SdkAdapterEvents,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY)
    promptSubmitRegistry: UserPromptSubmitCallbackRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_METADATA_STORE)
    private readonly sessionMetadata: SessionMetadataStore,
    @inject(TOKENS.GIT_INFO_SERVICE)
    private readonly gitInfo: GitInfoService,
    @inject(TOKENS.WEBVIEW_MANAGER)
    private readonly webviewManager: WebviewBroadcaster,
    @inject(TurnChangeSetStore)
    private readonly store: TurnChangeSetStore,
  ) {
    this.subscriptions.push(
      promptSubmitRegistry.register((payload) =>
        this.handlePromptSubmit(payload),
      ),
    );
    this.subscriptions.push(
      sdkAdapterEvents.onTurnEnded((event) => this.handleTurnEnd(event)),
    );
    this.subscriptions.push(
      sdkAdapterEvents.onTurnFailed((event) => this.handleTurnEnd(event)),
    );
  }

  /** Detach every subscription and drop pending baselines. Idempotent. */
  dispose(): void {
    while (this.subscriptions.length > 0) {
      this.subscriptions.pop()?.();
    }
    this.baselines.clear();
  }

  private handlePromptSubmit(payload: UserPromptSubmitPayload): void {
    const sessionId = payload?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    // A prompt submitted while the turn is still running (steering) keeps
    // the turn's first baseline, so the card covers the whole turn.
    if (this.baselines.has(sessionId)) return;

    // Set synchronously, so a turn end that arrives while the snapshot is
    // still being taken awaits this baseline instead of missing it.
    this.baselines.set(sessionId, {
      turnStartedAt:
        typeof payload.timestamp === 'number' ? payload.timestamp : Date.now(),
      ready: this.captureBaseline(sessionId, payload.workspaceRoot),
    });
  }

  /** Never rejects. */
  private async captureBaseline(
    sessionId: string,
    fromHook: string | undefined,
  ): Promise<BaselineSnapshot> {
    const workspaceRoot = await this.resolveWorkingDirectory(
      sessionId,
      fromHook,
    );
    return {
      workspaceRoot,
      snapshot:
        workspaceRoot === null
          ? NOT_A_REPO
          : await this.takeSnapshot(workspaceRoot),
    };
  }

  private handleTurnEnd(event: TurnEnd): void {
    const sessionId = event?.sessionId;
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    const baseline = this.baselines.get(sessionId);
    // Removed before any await: an error later in recording cannot leave it.
    this.baselines.delete(sessionId);
    this.recordTurn(event, baseline).catch((err: unknown) => {
      this.logger.error(
        `${LOG_SCOPE} recording the turn change set failed (sessionId=${sessionId})`,
        err instanceof Error ? err : new Error(String(err)),
      );
    });
  }

  private async recordTurn(
    event: TurnEnd,
    baseline: Baseline | undefined,
  ): Promise<void> {
    const captured = baseline ? await baseline.ready : undefined;
    const baselineSnapshot = captured?.snapshot;
    const workspaceRoot =
      captured?.workspaceRoot ??
      (await this.resolveWorkingDirectory(event.sessionId, event.cwd));
    if (workspaceRoot === null) return;

    const after = await this.takeSnapshot(workspaceRoot);
    if (after.kind === 'not-repo') return;
    if (after.kind === 'unavailable') {
      this.logger.warn(
        `${LOG_SCOPE} git status unavailable at turn end (sessionId=${event.sessionId}, reason=${after.reason}); no change set recorded`,
      );
      return;
    }

    const baselineMissing = baselineSnapshot?.kind !== 'ok';
    const before: ReadonlyMap<string, PathState> =
      baselineSnapshot?.kind === 'ok' ? baselineSnapshot.paths : new Map();
    const gone = [...before.keys()].filter((p) => !after.paths.has(p));
    const goneStats = await statPaths(after.repositoryRoot, gone);
    const goneButOnDisk = new Set(
      gone.filter((_, index) => goneStats[index].mtimeMs !== null),
    );
    const changed = diffSnapshots(before, after.paths, goneButOnDisk);
    if (changed.length === 0) return;

    const changeSet = await this.buildChangeSet({
      sessionId: event.sessionId,
      workspaceRoot,
      turnStartedAt: baseline?.turnStartedAt ?? event.timestamp,
      turnEndedAt:
        typeof event.timestamp === 'number' ? event.timestamp : Date.now(),
      changed,
      baselineMissing,
    });

    try {
      await this.store.append(changeSet);
    } catch (err: unknown) {
      // The push below still runs, so the live card shows even though the
      // record did not persist.
      this.logger.warn(
        `${LOG_SCOPE} could not persist the change set (sessionId=${event.sessionId})`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }

    const payload: GitTurnChangeSetPayload = { changeSet };
    this.webviewManager
      .broadcastMessage(MESSAGE_TYPES.GIT_TURN_CHANGE_SET, payload)
      .catch((err: unknown) => {
        this.logger.warn(
          `${LOG_SCOPE} webview broadcast failed`,
          err instanceof Error ? err : new Error(String(err)),
        );
      });
  }

  private async buildChangeSet(input: {
    sessionId: string;
    workspaceRoot: string;
    turnStartedAt: number;
    turnEndedAt: number;
    changed: readonly ChangedPath[];
    baselineMissing: boolean;
  }): Promise<TurnChangeSet> {
    const stored = input.changed.slice(0, MAX_FILES_PER_CHANGE_SET);
    const numstatPaths = stored.flatMap((c) =>
      c.origPath ? [c.path, c.origPath] : [c.path],
    );
    const counts = await this.gitInfo.readChangeSetNumstat(
      input.workspaceRoot,
      numstatPaths,
    );

    let countsUnavailable = false;
    let additions = 0;
    let deletions = 0;
    const files: TurnChangeSetFile[] = stored.map((c) => {
      const count = counts.get(c.path);
      const fileAdditions = count?.additions ?? null;
      const fileDeletions = count?.deletions ?? null;
      if (
        (fileAdditions === null || fileDeletions === null) &&
        count?.binary !== true
      ) {
        countsUnavailable = true;
      }
      additions += fileAdditions ?? 0;
      deletions += fileDeletions ?? 0;
      return {
        path: c.path,
        ...(c.origPath !== undefined && { origPath: c.origPath }),
        status: c.status,
        additions: fileAdditions,
        deletions: fileDeletions,
        ...(count?.binary === true && { binary: true }),
      };
    });

    return {
      sessionId: input.sessionId,
      workspaceRoot: input.workspaceRoot,
      turnStartedAt: input.turnStartedAt,
      turnEndedAt: input.turnEndedAt,
      files,
      truncatedCount: input.changed.length - stored.length,
      totals: { files: input.changed.length, additions, deletions },
      countsUnavailable,
      ...(input.baselineMissing && { baselineMissing: true }),
    };
  }

  /**
   * The directory the session's turn runs in: the hook's `cwd` when given,
   * else the session's stored `workingDirectory`. Null when neither is known.
   */
  private async resolveWorkingDirectory(
    sessionId: string,
    fromEvent: string | undefined,
  ): Promise<string | null> {
    if (typeof fromEvent === 'string' && fromEvent.trim().length > 0) {
      return fromEvent;
    }
    try {
      const metadata = await this.sessionMetadata.get(sessionId);
      const dir = metadata?.workingDirectory;
      if (typeof dir === 'string' && dir.trim().length > 0) return dir;
      this.logger.warn(
        `${LOG_SCOPE} no working directory for session ${sessionId}; turn not recorded`,
      );
    } catch (err: unknown) {
      this.logger.warn(
        `${LOG_SCOPE} session metadata read failed (sessionId=${sessionId}); turn not recorded`,
        err instanceof Error ? err : new Error(String(err)),
      );
    }
    return null;
  }

  /** Never rejects: a git failure is an `unavailable` snapshot. */
  private async takeSnapshot(workspaceRoot: string): Promise<Snapshot> {
    let files: GitFileStatus[];
    try {
      const info = await this.gitInfo.getGitInfo(workspaceRoot);
      if (!info.isGitRepo) return NOT_A_REPO;
      if (info.statusUnavailable) {
        return { kind: 'unavailable', reason: info.statusUnavailable };
      }
      files = info.files;
    } catch (err: unknown) {
      this.logger.warn(
        `${LOG_SCOPE} git status read failed for ${workspaceRoot}`,
        err instanceof Error ? err : new Error(String(err)),
      );
      return {
        kind: 'unavailable',
        reason: err instanceof Error ? err.message : String(err),
      };
    }

    const rows = groupRows(files);
    const relPaths = [...rows.keys()];
    const repositoryRoot =
      (await this.gitInfo.resolveRepositoryRoot(workspaceRoot)) ??
      workspaceRoot;
    const stats = await statPaths(
      repositoryRoot,
      relPaths.slice(0, MAX_STAT_PATHS),
    );
    const paths = new Map<string, PathState>();
    relPaths.forEach((relPath, index) => {
      const entries = rows.get(relPath) ?? [];
      const stat = index < MAX_STAT_PATHS ? stats[index] : undefined;
      const status = statusOf(entries);
      const origPath =
        status === 'R'
          ? entries.find((e) => e.status === 'R' && e.origPath)?.origPath
          : undefined;
      paths.set(relPath, {
        status,
        ...(origPath !== undefined && { origPath }),
        signature: signatureOf(entries),
        statted: stat !== undefined,
        mtimeMs: stat?.mtimeMs ?? null,
        size: stat?.size ?? null,
      });
    });
    return { kind: 'ok', repositoryRoot, paths };
  }
}

/** One changed path of a turn, before line counts. */
interface ChangedPath {
  readonly path: string;
  readonly origPath?: string;
  readonly status: TurnChangeSetFileStatus;
}

/**
 * The paths that differ between two snapshots, in after-then-gone order.
 *
 * A path gone from status at turn end is clean against HEAD, so the disk
 * tells what the turn did to it (`goneButOnDisk`):
 * - absent on disk: `D` — deleted, or its deletion committed;
 * - present and untracked or added at baseline: `A` — the turn committed a
 *   new file (git status alone cannot tell this from a delete);
 * - present otherwise: `M` — modified and committed, or put back to HEAD.
 */
function diffSnapshots(
  before: ReadonlyMap<string, PathState>,
  after: ReadonlyMap<string, PathState>,
  goneButOnDisk: ReadonlySet<string>,
): ChangedPath[] {
  const changed: ChangedPath[] = [];
  for (const [relPath, now] of after) {
    const then = before.get(relPath);
    if (!then || pathChanged(then, now)) {
      changed.push({
        path: relPath,
        ...(now.origPath !== undefined && { origPath: now.origPath }),
        status: now.status,
      });
    }
  }
  for (const [relPath, then] of before) {
    if (after.has(relPath)) continue;
    const status: TurnChangeSetFileStatus = !goneButOnDisk.has(relPath)
      ? 'D'
      : then.status === 'A'
        ? 'A'
        : 'M';
    changed.push({ path: relPath, status });
  }
  return changed;
}

function pathChanged(then: PathState, now: PathState): boolean {
  if (then.signature !== now.signature) return true;
  if (!then.statted || !now.statted) return false;
  return then.mtimeMs !== now.mtimeMs || then.size !== now.size;
}

/** Status rows per path; ignored entries and untracked directories dropped. */
function groupRows(
  files: readonly GitFileStatus[],
): Map<string, GitFileStatus[]> {
  const rows = new Map<string, GitFileStatus[]>();
  for (const file of files) {
    if (file.status === '!' || file.isDirectory) continue;
    const list = rows.get(file.path);
    if (list) list.push(file);
    else rows.set(file.path, [file]);
  }
  return rows;
}

/** The path's status against HEAD across its staged and unstaged rows. */
function statusOf(entries: readonly GitFileStatus[]): TurnChangeSetFileStatus {
  const has = (...codes: GitFileStatus['status'][]): boolean =>
    entries.some((e) => codes.includes(e.status));
  if (has('U')) return 'U';
  if (has('D')) return 'D';
  if (has('R')) return 'R';
  if (has('A', '??', 'C')) return 'A';
  return 'M';
}

function signatureOf(entries: readonly GitFileStatus[]): string {
  return (
    entries
      .map(
        (e) =>
          `${e.staged ? 'S' : 'W'}${e.status}|${e.origPath ?? ''}|${String(
            e.additions ?? '?',
          )}|${String(e.deletions ?? '?')}`,
      )
      // Ordinal (UTF-16 code unit) order, as the default sort gave: only a
      // stable, locale-independent order matters for comparing signatures.
      .sort(compareOrdinal)
      .join(';')
  );
}

function compareOrdinal(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

async function statPaths(
  workspaceRoot: string,
  relPaths: readonly string[],
): Promise<FileStat[]> {
  const stats: FileStat[] = [];
  for (let i = 0; i < relPaths.length; i += STAT_CONCURRENCY) {
    const batch = relPaths.slice(i, i + STAT_CONCURRENCY);
    stats.push(
      ...(await Promise.all(
        batch.map((relPath) => statPath(path.join(workspaceRoot, relPath))),
      )),
    );
  }
  return stats;
}

async function statPath(absolutePath: string): Promise<FileStat> {
  try {
    const stat = await fs.stat(absolutePath);
    return { mtimeMs: stat.mtimeMs, size: stat.size };
  } catch {
    // A deleted path has no stat; recorded as absent, which differs from a
    // present file's stat, and its git status row reports the deletion.
    return ABSENT_ON_DISK;
  }
}
