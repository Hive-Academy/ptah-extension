/**
 * GitWatcherService specs — git-ops/workspace/content-change debouncing, the
 * workspace subscription on the batched `IWorkspaceWatcher` port, overflow
 * handling, nested worktree roots, watcher lifecycle and stop/start cleanup.
 *
 * Strategy: deterministic. The workspace feed is a fake `IWorkspaceWatcher`
 * that records each subscription and lets a test deliver batches exactly as
 * the port shapes them; timers are `jest.useFakeTimers()`. The per-event work
 * the port replaced — exclusion, storm breaking, coalescing — is the watch
 * host's, pinned in platform-core (`workspace-change-coalescer.spec.ts`) and
 * end to end on the real host in `git-watcher.stress.spec.ts`.
 *
 * The dedicated `.git` watchers stay real `fs.watch` handles over temp
 * directories. The `GitInfoService.refreshGitInfo` mock returns a static
 * result so the `git:status-update` broadcast is observable without spawning
 * git, and `getWorktrees` resolves to no worktrees unless a test says
 * otherwise.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitWatcherService } from './git-watcher.service';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import type { WorkspaceChange } from '@ptah-extension/platform-core';
import {
  createMockWorkspaceWatcher,
  type MockWorkspaceWatcher,
} from '@ptah-extension/platform-core/testing';
import {
  NESTED_WORKSPACE_PATH_RULES,
  WATCH_IGNORED_DIRS,
} from '@ptah-extension/shared';
import type {
  FileContentChangedPayload,
  GitChangeKind,
  GitInfoResult,
  GitStatusUpdatePayload,
  GitWorktreeInfo,
} from '@ptah-extension/shared';

type Broadcast = jest.Mock<void, [string, unknown]>;

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

function makeGitInfo(): jest.Mocked<GitInfoService> {
  const result = async (): Promise<GitInfoResult> =>
    ({
      isGitRepo: true,
      branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
      files: [],
    }) as unknown as GitInfoResult;
  return {
    invalidateReadCache: jest.fn(),
    getGitInfo: jest.fn(result),
    refreshGitInfo: jest.fn(result),
    getWorktrees: jest.fn(async (): Promise<GitWorktreeInfo[]> => []),
  } as unknown as jest.Mocked<GitInfoService>;
}

function changes(
  root: string,
  kind: WorkspaceChange['kind'],
  ...names: string[]
): WorkspaceChange[] {
  return names.map((name) => ({ path: path.join(root, name), kind }));
}

/** Let the `void fetchAndPush()` chain settle. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

function makeGitDir(root: string, withWorktrees = false): void {
  const gitDir = path.join(root, '.git');
  fs.mkdirSync(path.join(gitDir, 'refs'), { recursive: true });
  if (withWorktrees) fs.mkdirSync(path.join(gitDir, 'worktrees'));
  fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(gitDir, 'index'), '');
}

describe('GitWatcherService', () => {
  let logger: Logger;
  let gitInfo: jest.Mocked<GitInfoService>;
  let workspaceWatcher: MockWorkspaceWatcher;
  let svc: GitWatcherService;
  let broadcast: Broadcast;
  const tempDirs: string[] = [];

  function tempDir(prefix: string): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    tempDirs.push(dir);
    return dir;
  }

  function calls(type: string): unknown[][] {
    return broadcast.mock.calls.filter(([t]) => t === type);
  }

  beforeEach(() => {
    logger = makeLogger();
    gitInfo = makeGitInfo();
    workspaceWatcher = createMockWorkspaceWatcher();
    svc = new GitWatcherService(gitInfo, logger, workspaceWatcher);
    broadcast = jest.fn();
  });

  afterEach(() => {
    svc.stop();
    jest.useRealTimers();
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // ===========================================================================
  // THE WORKSPACE SUBSCRIPTION (TASK_2026_437 C10)
  // ===========================================================================

  describe('workspace subscription', () => {
    it('subscribes once to the root with the shared exclusion policy and nested repo detection', () => {
      const root = tempDir('gw-sub-');
      svc.start(root, broadcast);

      expect(workspaceWatcher.__state.subscriptions).toHaveLength(1);
      const { root: watched, options } =
        workspaceWatcher.__state.subscriptions[0];
      expect(watched).toBe(root);
      expect(options.excludeGlobs).toEqual([]);
      expect(new Set(options.excludeDirNames)).toEqual(WATCH_IGNORED_DIRS);
      expect(options.excludeDirNames).toContain('.git');
      expect(options.excludeSegmentRules).toBe(NESTED_WORKSPACE_PATH_RULES);
      expect(options.nestedRepoDetection).toBe(true);
      expect(options.nestedRepoRoots).toEqual([]);
      // A 1 s leading-edge hold: longer than @parcel/watcher's up-to-550 ms
      // gap between a burst's lone first event and the rest (ST-1b, AC-2).
      expect(options.minBatchIntervalMs).toBe(1_000);
      // No recursive fs.watch of the workspace any more: a non-git workspace
      // holds no fs.watch handle at all.
      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        0,
      );
    });

    it('a failing watch() is logged and does not break start()', () => {
      const root = tempDir('gw-sub-fail-');
      makeGitDir(root);
      workspaceWatcher.watch.mockImplementation(() => {
        throw new Error('host unavailable');
      });

      expect(() => svc.start(root, broadcast)).not.toThrow();
      expect(logger.warn).toHaveBeenCalledWith(
        '[GitWatcher] Failed to watch workspace root',
        expect.objectContaining({ error: 'host unavailable' }),
      );
      // The dedicated .git watchers are still armed.
      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        3,
      );
    });

    it('stop() disposes the subscription and a late batch does nothing', async () => {
      jest.useFakeTimers();
      const root = tempDir('gw-sub-stop-');
      svc.start(root, broadcast);
      svc.stop();

      expect(workspaceWatcher.__state.live()).toHaveLength(0);
      workspaceWatcher.__state
        .latest()
        .deliver({ changes: changes(root, 'update', 'a.ts') });
      workspaceWatcher.__state.latest().deliver({ overflow: true });
      jest.advanceTimersByTime(10_000);
      await flush();

      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('a batch from the previous workspace is ignored after a restart', async () => {
      jest.useFakeTimers();
      const rootA = tempDir('gw-sub-a-');
      const rootB = tempDir('gw-sub-b-');
      svc.start(rootA, broadcast);
      const stale = workspaceWatcher.__state.subscriptions[0];
      svc.start(rootB, broadcast);

      expect(stale.disposed).toBe(true);
      stale.listener({
        root: rootA,
        changes: changes(rootA, 'update', 'a.ts'),
        truncated: false,
        overflow: false,
        droppedCount: 0,
      });
      jest.advanceTimersByTime(10_000);
      await flush();

      expect(calls('file:content-changed')).toHaveLength(0);
      expect(calls('git:status-update')).toHaveLength(0);
    });
  });

  // ===========================================================================
  // BATCHES — debounce semantics (deterministic, fake timers)
  // ===========================================================================

  describe('batch handling', () => {
    const WS = path.join(os.tmpdir(), 'gw-fake-ws');

    beforeEach(() => {
      jest.useFakeTimers();
      (svc as unknown as { workspacePath: string }).workspacePath = WS;
      svc.start(WS, broadcast);
      // The fake timers hold the initial fetch; a non-git root has none.
      broadcast.mockClear();
    });

    it('a normal batch schedules one refresh after the debounce and one content push for its updates', async () => {
      workspaceWatcher.__state.latest().deliver({
        changes: [
          ...changes(WS, 'update', 'src/a.ts', 'src/b.ts'),
          ...changes(WS, 'create', 'src/new.ts'),
          ...changes(WS, 'delete', 'src/gone.ts'),
        ],
      });

      jest.advanceTimersByTime(500);
      expect(calls('file:content-changed')).toHaveLength(1);
      const payload = calls('file:content-changed')[0][1];
      expect(payload).toEqual({
        filePaths: [
          path.join(WS, 'src/a.ts').replace(/\\/g, '/'),
          path.join(WS, 'src/b.ts').replace(/\\/g, '/'),
        ],
        truncated: false,
      } satisfies FileContentChangedPayload);

      jest.advanceTimersByTime(1_500);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledWith(WS);
      expect(gitInfo.invalidateReadCache).not.toHaveBeenCalled();
      const status = calls('git:status-update');
      expect(status).toHaveLength(1);
      expect((status[0][1] as GitStatusUpdatePayload).causes).toEqual([
        'workspace',
      ]);
    });

    it('a batch of creates and deletes refreshes status but pushes no content', async () => {
      workspaceWatcher.__state.latest().deliver({
        changes: [
          ...changes(WS, 'create', 'x.ts'),
          ...changes(WS, 'delete', 'y.ts'),
        ],
      });
      jest.advanceTimersByTime(2_000);
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('file:content-changed')).toHaveLength(0);
    });

    it('an empty non-overflow batch does nothing', async () => {
      workspaceWatcher.__state.latest().deliver({ changes: [] });
      jest.advanceTimersByTime(10_000);
      await flush();

      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('batches arriving 250 ms apart coalesce into one refresh and one content push', async () => {
      for (let i = 0; i < 4; i++) {
        workspaceWatcher.__state.latest().deliver({
          changes: changes(WS, 'update', `src/f-${i}.ts`),
        });
        jest.advanceTimersByTime(250);
      }
      jest.advanceTimersByTime(2_000);
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('file:content-changed')).toHaveLength(1);
      expect(
        (calls('file:content-changed')[0][1] as FileContentChangedPayload)
          .filePaths,
      ).toHaveLength(4);
    });

    it('caps the content set at 256 paths and marks the push truncated', () => {
      const names = Array.from({ length: 300 }, (_, i) => `src/file-${i}.ts`);
      workspaceWatcher.__state.latest().deliver({
        changes: changes(WS, 'update', ...names.slice(0, 150)),
      });
      jest.advanceTimersByTime(250);
      workspaceWatcher.__state.latest().deliver({
        changes: changes(WS, 'update', ...names.slice(150)),
      });
      jest.advanceTimersByTime(500);

      expect(calls('file:content-changed')).toHaveLength(1);
      const payload = calls(
        'file:content-changed',
      )[0][1] as FileContentChangedPayload;
      expect(payload.truncated).toBe(true);
      expect(payload.filePaths).toHaveLength(256);
    });

    it('.claude/commands and .claude/skills still refresh and push content (the port excludes only worktrees)', async () => {
      workspaceWatcher.__state.latest().deliver({
        changes: changes(
          WS,
          'update',
          '.claude/commands/x.md',
          '.claude/skills/y/SKILL.md',
        ),
      });
      jest.advanceTimersByTime(2_000);
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(
        (calls('file:content-changed')[0][1] as FileContentChangedPayload)
          .filePaths,
      ).toEqual([
        path.join(WS, '.claude/commands/x.md').replace(/\\/g, '/'),
        path.join(WS, '.claude/skills/y/SKILL.md').replace(/\\/g, '/'),
      ]);
    });

    it('coalesces multiple .git/* kinds into a single broadcast carrying both causes', async () => {
      const sched = (
        svc as unknown as {
          scheduleGitOpsRefresh(kind: GitChangeKind): void;
        }
      ).scheduleGitOpsRefresh.bind(svc);

      sched('head');
      sched('refs');
      sched('head');

      jest.advanceTimersByTime(500);
      await flush();

      const gitCalls = calls('git:status-update');
      expect(gitCalls).toHaveLength(1);
      const payload = gitCalls[0][1] as GitStatusUpdatePayload;
      expect(new Set(payload.causes)).toEqual(new Set(['head', 'refs']));
    });

    it('fetchAndPush with no pending causes emits ["initial"], stamped with the watched root', async () => {
      await (
        svc as unknown as { fetchAndPush(): Promise<void> }
      ).fetchAndPush();

      const gitCalls = calls('git:status-update');
      expect(gitCalls).toHaveLength(1);
      const payload = gitCalls[0][1] as GitStatusUpdatePayload;
      expect(payload.causes).toEqual(['initial']);
      expect(payload.workspaceRoot).toBe(WS);
    });

    it('fetchAndPush drops the broadcast when the workspace switches mid-fetch', async () => {
      gitInfo.refreshGitInfo.mockImplementationOnce(async () => {
        (svc as unknown as { workspacePath: string }).workspacePath = path.join(
          os.tmpdir(),
          'gw-other-ws',
        );
        return {
          isGitRepo: true,
          files: [],
        } as unknown as GitInfoResult;
      });

      await (
        svc as unknown as { fetchAndPush(): Promise<void> }
      ).fetchAndPush();

      expect(calls('git:status-update')).toHaveLength(0);
    });
  });

  // ===========================================================================
  // OVERFLOW (TASK_2026_437 C10, FU-4d, FU-8b)
  //
  // `overflow` means events were lost or suppressed (a storm, a host restart, a
  // degraded 60 s rescan tick); `truncated` means more paths than one batch
  // holds. Both leave the path list incomplete, so both become exactly one
  // refresh and one truncated content push, and repeating them never stacks.
  // ===========================================================================

  describe('overflow and truncated batches', () => {
    const WS = path.join(os.tmpdir(), 'gw-fake-overflow-ws');

    beforeEach(() => {
      jest.useFakeTimers();
      svc.start(WS, broadcast);
      broadcast.mockClear();
    });

    it('overflow issues exactly one refresh and one truncated content push, immediately', async () => {
      workspaceWatcher.__state
        .latest()
        .deliver({ overflow: true, droppedCount: 8_000 });
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('git:status-update')).toHaveLength(1);
      expect(
        (calls('git:status-update')[0][1] as GitStatusUpdatePayload).causes,
      ).toEqual(['workspace']);
      expect(calls('file:content-changed')).toEqual([
        [
          'file:content-changed',
          {
            filePaths: [],
            truncated: true,
          } satisfies FileContentChangedPayload,
        ],
      ]);

      // Nothing else is left pending behind it.
      jest.advanceTimersByTime(60_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(broadcast).toHaveBeenCalledTimes(2);
    });

    it('a truncated batch is handled like an overflow', async () => {
      workspaceWatcher.__state.latest().deliver({
        changes: changes(WS, 'update', 'a.ts'),
        truncated: true,
        droppedCount: 1_200,
      });
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('file:content-changed')).toEqual([
        ['file:content-changed', { filePaths: [], truncated: true }],
      ]);
      jest.advanceTimersByTime(10_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
    });

    it('absorbs a refresh and content paths still pending from an earlier batch', async () => {
      workspaceWatcher.__state
        .latest()
        .deliver({ changes: changes(WS, 'update', 'early.ts') });
      jest.advanceTimersByTime(250);
      workspaceWatcher.__state.latest().deliver({ overflow: true });
      await flush();

      jest.advanceTimersByTime(60_000);
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('git:status-update')).toHaveLength(1);
      expect(calls('file:content-changed')).toEqual([
        ['file:content-changed', { filePaths: [], truncated: true }],
      ]);
    });

    it('degraded rescans every 60 s cost one refresh each and never stack while a refresh is running', async () => {
      let finish!: () => void;
      gitInfo.refreshGitInfo.mockImplementation(
        () =>
          new Promise<GitInfoResult>((resolve) => {
            finish = () =>
              resolve({
                isGitRepo: true,
                files: [],
              } as unknown as GitInfoResult);
          }),
      );

      // Three overflow ticks, the first refresh never settling in between.
      workspaceWatcher.__state.latest().deliver({ overflow: true });
      jest.advanceTimersByTime(60_000);
      workspaceWatcher.__state.latest().deliver({ overflow: true });
      jest.advanceTimersByTime(60_000);
      workspaceWatcher.__state.latest().deliver({ overflow: true });
      await flush();

      // One call per tick; GitInfoService's single flight joins them to at
      // most one running and one trailing git status (pinned in vscode-core).
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(3);
      expect(calls('file:content-changed')).toHaveLength(3);
      // No timer is left armed by the overflow path itself.
      expect(
        (svc as unknown as { debounceTimer: unknown }).debounceTimer,
      ).toBeNull();
      expect(
        (svc as unknown as { contentChangeTimer: unknown }).contentChangeTimer,
      ).toBeNull();
      finish();
      await flush();
    });
  });

  // ===========================================================================
  // MAX-WAIT CEILINGS (TASK_2026_175)
  //
  // A plain re-arming debounce starves: while events keep arriving inside the
  // window the timer is cleared every time and the trailing edge never runs.
  // Measured against the live monorepo the workspace channel produced 0
  // `git:status-update` pushes across 60s despite 655 qualifying events.
  //
  // Each test below emits FASTER than the channel's debounce window for
  // LONGER than its ceiling, and proves two things: nothing fires before the
  // ceiling (the debounce window is untouched — TASK_2026_173 C1 AC2), and
  // the push is forced once the ceiling is crossed.
  // ===========================================================================

  describe('max-wait ceilings under continuous churn', () => {
    const WS = path.join(os.tmpdir(), 'gw-fake-maxwait-ws');

    beforeEach(() => {
      jest.useFakeTimers();
      svc.start(WS, broadcast);
      broadcast.mockClear();
    });

    /** Emit `count` events `gapMs` apart, advancing fake time between them. */
    function churn(emit: () => void, count: number, gapMs: number): void {
      for (let i = 0; i < count; i++) {
        emit();
        jest.advanceTimersByTime(gapMs);
      }
    }

    it('workspace git status fires within WORKSPACE_MAX_WAIT_MS (8000)', async () => {
      const emit = () =>
        workspaceWatcher.__state
          .latest()
          .deliver({ changes: changes(WS, 'create', 'x.ts') });

      // 500ms apart — a quarter of the debounce window, so the trailing edge
      // is never reached by coalescing alone. Last emit lands at t=7500.
      churn(emit, 16, 500);
      await flush();
      expect(calls('git:status-update')).toHaveLength(0);

      // t=8000: the burst has now run for the full ceiling.
      emit();
      await flush();
      expect(calls('git:status-update').length).toBeGreaterThanOrEqual(1);
      const payload = calls(
        'git:status-update',
      )[0][1] as GitStatusUpdatePayload;
      expect(payload.causes).toEqual(['workspace']);
    });

    it('git-ops refresh fires within GIT_OPS_MAX_WAIT_MS (2000)', async () => {
      const emit = () =>
        (
          svc as unknown as { scheduleGitOpsRefresh(kind: GitChangeKind): void }
        ).scheduleGitOpsRefresh('index');

      churn(emit, 10, 200);
      await flush();
      expect(calls('git:status-update')).toHaveLength(0);

      emit(); // t=2000
      await flush();
      expect(calls('git:status-update')).toHaveLength(1);
    });

    it('content change fires within CONTENT_CHANGE_MAX_WAIT_MS (2000)', () => {
      const emit = () =>
        workspaceWatcher.__state
          .latest()
          .deliver({ changes: changes(WS, 'update', 'a.ts') });

      // 250 ms apart: the port's batch cadence, half the content debounce.
      churn(emit, 8, 250);
      expect(calls('file:content-changed')).toHaveLength(0);

      emit(); // t=2000
      expect(calls('file:content-changed')).toHaveLength(1);
      expect(calls('file:content-changed')[0][1]).toEqual({
        filePaths: [path.join(WS, 'a.ts').replace(/\\/g, '/')],
        truncated: false,
      });
    });

    it('a forced fire starts a fresh burst rather than firing on every event (git-ops channel)', async () => {
      const emit = () =>
        (
          svc as unknown as { scheduleGitOpsRefresh(kind: GitChangeKind): void }
        ).scheduleGitOpsRefresh('index');

      churn(emit, 10, 200);
      emit(); // t=2000 — forced
      await flush();
      expect(calls('git:status-update')).toHaveLength(1);

      // The next event opens a new burst; it must NOT fire immediately.
      jest.advanceTimersByTime(200);
      emit();
      await flush();
      expect(calls('git:status-update')).toHaveLength(1);

      churn(emit, 10, 200);
      emit();
      await flush();
      expect(calls('git:status-update')).toHaveLength(2);
    });

    it('stop() clears the burst so a restarted watcher does not fire instantly (git-ops channel)', async () => {
      const emit = () =>
        (
          svc as unknown as { scheduleGitOpsRefresh(kind: GitChangeKind): void }
        ).scheduleGitOpsRefresh('index');

      churn(emit, 10, 200);
      svc.stop();
      broadcast.mockClear();

      (svc as unknown as { isDisposed: boolean }).isDisposed = false;
      emit();
      await flush();
      expect(calls('git:status-update')).toHaveLength(0);
    });
  });

  // ===========================================================================
  // NESTED WORKTREE ROOTS (TASK_2026_437 INV-2)
  //
  // The host excludes nested repositories it SEES appear (a `.git` event). A
  // worktree that already exists produces no such event, so the listing seeds
  // the subscription; a changed listing resubscribes.
  // ===========================================================================

  describe('nested worktree roots', () => {
    let root: string;

    beforeEach(() => {
      root = tempDir('gw-nested-');
      makeGitDir(root, true);
    });

    async function settleListing(): Promise<void> {
      await flush();
      await flush();
    }

    it('lists worktrees without blocking start() and resubscribes with the roots under the workspace only', async () => {
      gitInfo.getWorktrees.mockResolvedValueOnce([
        { path: root },
        { path: path.join(root, 'sandbox', 'wt1') },
        { path: path.join(root, '.claude-worktrees', 'agent-1') },
        { path: path.join(os.tmpdir(), 'elsewhere', 'wt2') },
      ] as GitWorktreeInfo[]);

      svc.start(root, broadcast);
      expect(gitInfo.getWorktrees).toHaveBeenCalledWith(root);
      expect(workspaceWatcher.__state.subscriptions).toHaveLength(1);

      await settleListing();

      expect(workspaceWatcher.__state.subscriptions).toHaveLength(2);
      const [first, second] = workspaceWatcher.__state.subscriptions;
      expect(first.disposed).toBe(true);
      expect(second.disposed).toBe(false);
      // Agent worktree directories are already excluded by name.
      const expected = path.join(root, 'sandbox', 'wt1');
      expect(second.options.nestedRepoRoots).toHaveLength(1);
      expect(second.options.nestedRepoRoots?.[0].toLowerCase()).toBe(
        expected.toLowerCase(),
      );
    });

    it('does not resubscribe when no worktree lives under the workspace', async () => {
      gitInfo.getWorktrees.mockResolvedValueOnce([
        { path: root },
      ] as GitWorktreeInfo[]);

      svc.start(root, broadcast);
      await settleListing();

      expect(workspaceWatcher.__state.subscriptions).toHaveLength(1);
    });

    it('drops a worktree listing that resolves after the watcher moved on', async () => {
      let resolveList!: (list: GitWorktreeInfo[]) => void;
      gitInfo.getWorktrees.mockReturnValueOnce(
        new Promise((resolve) => (resolveList = resolve)),
      );

      svc.start(root, broadcast);
      svc.stop();
      resolveList([
        { path: path.join(root, 'sandbox', 'wt1') },
      ] as GitWorktreeInfo[]);
      await settleListing();

      expect(workspaceWatcher.__state.subscriptions).toHaveLength(1);
      expect(workspaceWatcher.__state.live()).toHaveLength(0);
    });

    it('a failed worktree listing keeps the subscription and warns once', async () => {
      gitInfo.getWorktrees.mockRejectedValue(new Error('git missing'));

      svc.start(root, broadcast);
      await settleListing();
      await (
        svc as unknown as {
          refreshNestedRepoRoots(
            root: string,
            generation: number,
          ): Promise<void>;
        }
      ).refreshNestedRepoRoots(
        root,
        (svc as unknown as { armGeneration: number }).armGeneration,
      );

      const failures = (logger.warn as jest.Mock).mock.calls.filter(([m]) =>
        String(m).startsWith('[GitWatcher] Could not list worktrees'),
      );
      expect(failures).toHaveLength(1);
      expect(workspaceWatcher.__state.live()).toHaveLength(1);
    });

    it('a listing that resolves after a newer one never resubscribes over it', async () => {
      const wt1 = path.join(root, 'sandbox', 'wt1');
      const wt2 = path.join(root, 'sandbox', 'wt2');
      gitInfo.getWorktrees.mockResolvedValueOnce([
        { path: root },
      ] as GitWorktreeInfo[]);
      svc.start(root, broadcast);
      await settleListing();
      expect(workspaceWatcher.__state.subscriptions).toHaveLength(1);

      // Rapid worktree churn: two listings in flight, the older resolves last.
      let resolveOlder!: (list: GitWorktreeInfo[]) => void;
      let resolveNewer!: (list: GitWorktreeInfo[]) => void;
      gitInfo.getWorktrees
        .mockReturnValueOnce(new Promise((r) => (resolveOlder = r)))
        .mockReturnValueOnce(new Promise((r) => (resolveNewer = r)));
      const refresh = (
        svc as unknown as {
          refreshNestedRepoRoots(
            root: string,
            generation: number,
          ): Promise<void>;
        }
      ).refreshNestedRepoRoots.bind(svc);
      const generation = (svc as unknown as { armGeneration: number })
        .armGeneration;
      const older = refresh(root, generation);
      const newer = refresh(root, generation);

      resolveNewer([
        { path: root },
        { path: wt1 },
        { path: wt2 },
      ] as GitWorktreeInfo[]);
      await newer;
      resolveOlder([{ path: root }, { path: wt1 }] as GitWorktreeInfo[]);
      await older;

      expect(workspaceWatcher.__state.subscriptions).toHaveLength(2);
      const live = workspaceWatcher.__state.live();
      expect(live).toHaveLength(1);
      expect(
        live[0].options.nestedRepoRoots?.map((r) => r.toLowerCase()),
      ).toEqual([wt1.toLowerCase(), wt2.toLowerCase()]);
    });

    it('re-lists worktrees on a .git/worktrees change, resubscribing only when the set changed', async () => {
      jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick'] });
      const wt = path.join(root, 'sandbox', 'wt1');
      gitInfo.getWorktrees
        .mockResolvedValueOnce([{ path: root }] as GitWorktreeInfo[])
        .mockResolvedValueOnce([
          { path: root },
          { path: wt },
        ] as GitWorktreeInfo[])
        .mockResolvedValueOnce([
          { path: root },
          { path: wt },
        ] as GitWorktreeInfo[]);

      svc.start(root, broadcast);
      await settleListing();
      expect(workspaceWatcher.__state.subscriptions).toHaveLength(1);

      const refresh = (
        svc as unknown as { scheduleNestedRootsRefresh(): void }
      ).scheduleNestedRootsRefresh.bind(svc);
      refresh();
      refresh();
      jest.advanceTimersByTime(500);
      await settleListing();
      expect(gitInfo.getWorktrees).toHaveBeenCalledTimes(2);
      expect(workspaceWatcher.__state.subscriptions).toHaveLength(2);

      refresh();
      jest.advanceTimersByTime(500);
      await settleListing();
      expect(gitInfo.getWorktrees).toHaveBeenCalledTimes(3);
      expect(workspaceWatcher.__state.subscriptions).toHaveLength(2);
      expect(workspaceWatcher.__state.live()).toHaveLength(1);
    });
  });

  // ===========================================================================
  // DEDICATED .git WATCHERS AND LIFECYCLE — real fs.watch on temp directories
  // ===========================================================================

  describe('lifecycle', () => {
    it('arms the dedicated .git watchers (HEAD, index, refs) on a git workspace', () => {
      const root = tempDir('gw-life-git-');
      makeGitDir(root);

      svc.start(root, broadcast);

      // HEAD + index + refs. The workspace itself is the port subscription.
      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        3,
      );
      expect(workspaceWatcher.__state.live()).toHaveLength(1);
    });

    it('watches .git/worktrees when the repository has linked worktrees', () => {
      const root = tempDir('gw-life-wt-');
      makeGitDir(root, true);

      svc.start(root, broadcast);

      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        4,
      );
    });

    it('a non-git workspace arms no .git watcher and lists no worktrees', () => {
      const root = tempDir('gw-life-plain-');
      svc.start(root, broadcast);

      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        0,
      );
      expect(gitInfo.getWorktrees).not.toHaveBeenCalled();
      expect(workspaceWatcher.__state.live()).toHaveLength(1);
    });

    it('start() called twice cleans up the previous subscription and watchers (no leak)', () => {
      const rootA = tempDir('gw-life-a-');
      const rootB = tempDir('gw-life-b-');
      makeGitDir(rootA);

      svc.start(rootA, broadcast);
      svc.start(rootB, broadcast);

      expect(workspaceWatcher.__state.live()).toHaveLength(1);
      expect(workspaceWatcher.__state.live()[0].root).toBe(rootB);
      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        0,
      );
    });

    it('git workspace push fires the initial git:status-update', async () => {
      const root = tempDir('gw-life-initial-');
      makeGitDir(root);

      svc.start(root, broadcast);

      const start = Date.now();
      while (
        Date.now() - start < 2_000 &&
        calls('git:status-update').length === 0
      ) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(calls('git:status-update').length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // SWITCH DEBOUNCE + DEFERRED INITIAL FETCH (deterministic, fake timers)
  // ===========================================================================

  describe('switch debounce + deferred initial fetch', () => {
    let tmpA: string;
    let tmpB: string;

    beforeEach(() => {
      tmpA = tempDir('gw-switch-a-');
      tmpB = tempDir('gw-switch-b-');
      jest.useFakeTimers();
    });

    it('collapses rapid switches into a single re-arm on the final target', () => {
      svc.start(tmpA, broadcast);
      const startSpy = jest.spyOn(svc, 'start');

      svc.switchWorkspace(tmpB);
      svc.switchWorkspace(tmpA);
      svc.switchWorkspace(tmpB);

      // Nothing re-armed yet — still debouncing.
      expect(startSpy).not.toHaveBeenCalled();
      expect((svc as unknown as { workspacePath: string }).workspacePath).toBe(
        tmpA,
      );

      jest.advanceTimersByTime(300);

      // Exactly one re-arm, on the final target (tmpB).
      expect(startSpy).toHaveBeenCalledTimes(1);
      expect(startSpy).toHaveBeenCalledWith(tmpB, broadcast);
      expect(workspaceWatcher.__state.subscriptions).toHaveLength(2);
      expect(workspaceWatcher.__state.live()[0].root).toBe(tmpB);
    });

    it('A→B→A quickly leaves A watched with no teardown (queued restart dropped)', () => {
      svc.start(tmpA, broadcast);
      const startSpy = jest.spyOn(svc, 'start');

      svc.switchWorkspace(tmpB);
      svc.switchWorkspace(tmpA); // final target === currently watched path

      jest.advanceTimersByTime(300);

      expect(startSpy).not.toHaveBeenCalled();
      expect(workspaceWatcher.__state.subscriptions).toHaveLength(1);
      expect(workspaceWatcher.__state.live()[0].root).toBe(tmpA);
    });

    it('switchWorkspace() to the same path is a no-op', () => {
      svc.start(tmpA, broadcast);
      svc.switchWorkspace(tmpA);
      jest.advanceTimersByTime(300);

      expect(workspaceWatcher.__state.subscriptions).toHaveLength(1);
    });

    it('does not fire the initial git:status-update synchronously on arm', async () => {
      makeGitDir(tmpA);
      svc.start(tmpA, broadcast);

      // Watchers are armed immediately, but the fetch is deferred.
      expect(calls('git:status-update')).toHaveLength(0);

      jest.advanceTimersByTime(50);
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledWith(tmpA);
      expect(calls('git:status-update')).toHaveLength(1);
    });

    it('stop() before the deferred initial fetch fires suppresses it', async () => {
      makeGitDir(tmpA);
      svc.start(tmpA, broadcast);
      svc.stop();

      jest.advanceTimersByTime(50);
      await flush();

      expect(calls('git:status-update')).toHaveLength(0);
    });
  });
});
