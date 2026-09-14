/**
 * GitWatcherService specs — git-ops/workspace/content-change debouncing,
 * watcher lifecycle, ignore-list filtering, and stop/start cleanup.
 *
 * Strategy: most tests are deterministic — they invoke the private
 * `scheduleUpdate` / `scheduleGitOpsRefresh` / `scheduleContentChange`
 * callbacks directly via `(svc as any)` and drive timers via
 * `jest.useFakeTimers()`.
 *
 * A small number of tests exercise the real `fs.watch` path with actual
 * temp directories (real timers). These are timing-sensitive on Windows;
 * they intentionally use generous timeouts and tolerate occasional flake
 * by polling rather than asserting on a single tick.
 *
 * The `GitInfoService.refreshGitInfo` mock returns a static result so the
 * `git:status-update` broadcast is observable without spawning git, and
 * `getWorktrees` resolves to no worktrees unless a test says otherwise.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitWatcherService } from './git-watcher.service';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import { NestedRepoRoots, nestedRepoRootOf } from '@ptah-extension/shared';

// Pass-through spy: lets the storm spec prove `.git` markers are not parsed
// per event while storming. Every other export is the real implementation.
jest.mock('@ptah-extension/shared', () => {
  const actual = jest.requireActual('@ptah-extension/shared');
  return { ...actual, nestedRepoRootOf: jest.fn(actual.nestedRepoRootOf) };
});
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

/** Wait until `predicate()` returns true or `timeoutMs` elapses. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 1500,
  intervalMs = 25,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return predicate();
}

describe('GitWatcherService', () => {
  let logger: Logger;
  let gitInfo: jest.Mocked<GitInfoService>;
  let svc: GitWatcherService;
  let broadcast: Broadcast;

  beforeEach(() => {
    logger = makeLogger();
    gitInfo = makeGitInfo();
    svc = new GitWatcherService(gitInfo, logger);
    broadcast = jest.fn();
  });

  afterEach(() => {
    svc.stop();
    jest.useRealTimers();
  });

  // ===========================================================================
  // DETERMINISTIC TESTS — drive scheduler callbacks directly via (svc as any)
  // ===========================================================================

  describe('debounce semantics (deterministic, fake timers)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    it('scheduleContentChange coalesces rapid saves into one batched push', () => {
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      const sched = (
        svc as unknown as {
          scheduleContentChange(root: string, name: string): void;
        }
      ).scheduleContentChange.bind(svc);

      for (let i = 0; i < 5; i++) sched('D:\\fake\\ws', 'a.ts');
      jest.advanceTimersByTime(500);

      const contentCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'file:content-changed',
      );
      expect(contentCalls).toHaveLength(1);
      const payload: FileContentChangedPayload = {
        filePaths: ['D:/fake/ws/a.ts'],
        truncated: false,
      };
      expect(contentCalls[0][1]).toEqual(payload);
    });

    it('scheduleUpdate fetches and broadcasts git status after debounce', async () => {
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      (
        svc as unknown as {
          scheduleUpdate(ms: number, kind: GitChangeKind): void;
        }
      ).scheduleUpdate(500, 'workspace');
      jest.advanceTimersByTime(500);

      await Promise.resolve();
      await Promise.resolve();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledWith('D:\\fake\\ws');
      const gitCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'git:status-update',
      );
      expect(gitCalls.length).toBeGreaterThanOrEqual(1);
      const payload = gitCalls[0][1] as GitStatusUpdatePayload;
      expect(payload.causes).toEqual(['workspace']);
    });

    // TASK_2026_343. `GitInfoService` caches the branch list, stash list, tags
    // and remotes until something invalidates them, and its own invalidation
    // only covers commands it ran itself. A `git checkout` in the integrated
    // terminal reaches it through this watcher or not at all.
    //
    // TASK_2026_437: the watcher no longer invalidates and reads in two calls.
    // Invalidating from here deleted the in-flight run, so every push started
    // a parallel `git status`. `refreshGitInfo` invalidates AND joins the one
    // queued trailing run in a single call.
    it('refreshes through refreshGitInfo and never invalidates the cache itself', async () => {
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      (
        svc as unknown as {
          scheduleUpdate(ms: number, kind: GitChangeKind): void;
        }
      ).scheduleUpdate(500, 'refs');
      jest.advanceTimersByTime(500);

      await Promise.resolve();
      await Promise.resolve();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledWith('D:\\fake\\ws');
      expect(gitInfo.invalidateReadCache).not.toHaveBeenCalled();
      expect(gitInfo.getGitInfo).not.toHaveBeenCalled();
    });

    it('coalesces multiple .git/* kinds into a single broadcast carrying both causes', async () => {
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      const sched = (
        svc as unknown as {
          scheduleGitOpsRefresh(kind: GitChangeKind): void;
        }
      ).scheduleGitOpsRefresh.bind(svc);

      sched('head');
      sched('refs');
      sched('head');

      jest.advanceTimersByTime(500);
      await Promise.resolve();
      await Promise.resolve();

      const gitCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'git:status-update',
      );
      expect(gitCalls).toHaveLength(1);
      const payload = gitCalls[0][1] as GitStatusUpdatePayload;
      expect(new Set(payload.causes)).toEqual(new Set(['head', 'refs']));
    });

    it('fetchAndPush with no pending causes emits ["initial"]', async () => {
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      await (
        svc as unknown as { fetchAndPush(): Promise<void> }
      ).fetchAndPush();

      const gitCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'git:status-update',
      );
      expect(gitCalls).toHaveLength(1);
      const payload = gitCalls[0][1] as GitStatusUpdatePayload;
      expect(payload.causes).toEqual(['initial']);
    });

    it('fetchAndPush stamps the payload with the watched workspaceRoot', async () => {
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      await (
        svc as unknown as { fetchAndPush(): Promise<void> }
      ).fetchAndPush();

      const gitCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'git:status-update',
      );
      expect(gitCalls).toHaveLength(1);
      const payload = gitCalls[0][1] as GitStatusUpdatePayload;
      expect(payload.workspaceRoot).toBe('D:\\fake\\ws');
    });

    it('fetchAndPush drops the broadcast when the workspace switches mid-fetch', async () => {
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws-a';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      gitInfo.refreshGitInfo.mockImplementationOnce(async () => {
        (svc as unknown as { workspacePath: string }).workspacePath =
          'D:\\fake\\ws-b';
        return {
          isGitRepo: true,
          branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
          files: [],
        } as unknown as GitInfoResult;
      });

      await (
        svc as unknown as { fetchAndPush(): Promise<void> }
      ).fetchAndPush();

      const gitCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'git:status-update',
      );
      expect(gitCalls).toHaveLength(0);
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
    beforeEach(() => {
      jest.useFakeTimers();
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;
    });

    /** Emit `count` events `gapMs` apart, advancing fake time between them. */
    function churn(emit: () => void, count: number, gapMs: number): void {
      for (let i = 0; i < count; i++) {
        emit();
        jest.advanceTimersByTime(gapMs);
      }
    }

    function calls(type: string): unknown[][] {
      return broadcast.mock.calls.filter(([t]) => t === type);
    }

    /** Let the `void fetchAndPush()` chain settle. */
    async function flush(): Promise<void> {
      await Promise.resolve();
      await Promise.resolve();
    }

    it('workspace git status fires within WORKSPACE_MAX_WAIT_MS (8000)', async () => {
      const emit = () =>
        (
          svc as unknown as {
            scheduleUpdate(ms: number, kind: GitChangeKind): void;
          }
        ).scheduleUpdate(2000, 'workspace');

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
        (
          svc as unknown as {
            scheduleContentChange(root: string, name: string): void;
          }
        ).scheduleContentChange('D:\\fake\\ws', 'a.ts');

      churn(emit, 10, 200);
      expect(calls('file:content-changed')).toHaveLength(0);

      emit(); // t=2000
      expect(calls('file:content-changed')).toHaveLength(1);
      expect(calls('file:content-changed')[0][1]).toEqual({
        filePaths: ['D:/fake/ws/a.ts'],
        truncated: false,
      });
    });

    // TASK_2026_437: one timer and one path set for every file, replacing the
    // per-path timer map that a bulk rewrite grew to thousands of timers.
    it('content changes to many files share one timer and one push', () => {
      const emit = (name: string) =>
        (
          svc as unknown as {
            scheduleContentChange(root: string, name: string): void;
          }
        ).scheduleContentChange('D:\\fake\\ws', name);

      // `a.ts` is rewritten continuously; `b.ts` is touched once near the end.
      churn(() => emit('a.ts'), 9, 200);
      emit('b.ts'); // t=1800 — still inside the burst
      jest.advanceTimersByTime(200);
      emit('a.ts'); // t=2000 — the shared burst has expired
      expect(calls('file:content-changed')).toHaveLength(1);
      expect(calls('file:content-changed')[0][1]).toEqual({
        filePaths: ['D:/fake/ws/a.ts', 'D:/fake/ws/b.ts'],
        truncated: false,
      });

      // Nothing is left pending behind the push.
      jest.advanceTimersByTime(500);
      expect(calls('file:content-changed')).toHaveLength(1);
    });

    it('caps the batch at 256 paths and marks it truncated', () => {
      const emit = (name: string) =>
        (
          svc as unknown as {
            scheduleContentChange(root: string, name: string): void;
          }
        ).scheduleContentChange('D:\\fake\\ws', name);

      for (let i = 0; i < 300; i++) emit(`src/file-${i}.ts`);
      jest.advanceTimersByTime(500);

      expect(calls('file:content-changed')).toHaveLength(1);
      const payload = calls(
        'file:content-changed',
      )[0][1] as FileContentChangedPayload;
      expect(payload.truncated).toBe(true);
      expect(payload.filePaths).toHaveLength(256);
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
  // EVENT STORMS, WORKTREE EXCLUSION AND NESTED ROOTS (TASK_2026_437)
  //
  // On 2026-09-14 removing ten agent worktrees (~7,400 files each) drove tens
  // of thousands of events through the recursive watcher callback on the
  // Electron main thread. These tests drive that callback (`onWorkspaceEvent`)
  // with synthetic events and fake timers (which also fake `Date.now`, the
  // breaker's clock).
  // ===========================================================================

  describe('event storms and nested-repository exclusion (TASK_2026_437)', () => {
    const WS = 'D:\\fake\\ws';

    beforeEach(() => {
      jest.useFakeTimers();
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath = WS;
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;
    });

    type Internals = {
      onWorkspaceEvent(
        root: string,
        eventType: string,
        filename: string | null,
      ): void;
      isIgnoredWorkspaceEvent(filename: string): boolean;
      refreshNestedRepoRoots(root: string, generation: number): Promise<void>;
      armGeneration: number;
    };
    const internals = (): Internals => svc as unknown as Internals;

    function emit(eventType: string, filename: string): void {
      internals().onWorkspaceEvent(WS, eventType, filename);
    }

    function calls(type: string): unknown[][] {
      return broadcast.mock.calls.filter(([t]) => t === type);
    }

    async function flush(): Promise<void> {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    }

    function warnMessages(): string[] {
      return (logger.warn as jest.Mock).mock.calls.map(([m]) => String(m));
    }

    it('10,000 events under agent worktree directories cause zero refreshes and zero pushes', async () => {
      for (let i = 0; i < 10_000; i++) {
        const name =
          i % 2 === 0
            ? `.claude-worktrees\\wt-${i % 10}\\src\\file-${i}.ts`
            : `.claude/worktrees/wt-${i % 10}/src/file-${i}.ts`;
        emit(i % 3 === 0 ? 'change' : 'rename', name);
        if (i % 10 === 9) jest.advanceTimersByTime(1);
      }
      jest.advanceTimersByTime(60_000);
      await flush();

      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
      expect(warnMessages()).not.toContain('[GitWatcher] event storm entered');
    });

    it('10,000 source events in 1 s enter a storm and issue exactly one refresh and one truncated push after quiet', async () => {
      for (let i = 0; i < 10_000; i++) {
        emit('change', `src\\file-${i}.ts`);
        if (i % 10 === 9) jest.advanceTimersByTime(1);
      }
      expect(warnMessages()).toContain('[GitWatcher] event storm entered');

      // Still inside the quiet window (last event at t=1000, quiet 2000 ms):
      // nothing may have been issued — neither the pre-storm debounce nor a
      // per-event push.
      jest.advanceTimersByTime(1_900);
      await flush();
      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();

      jest.advanceTimersByTime(10_000);
      await flush();

      expect(warnMessages()).toContain('[GitWatcher] event storm exited');
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(gitInfo.invalidateReadCache).not.toHaveBeenCalled();
      expect(calls('git:status-update')).toHaveLength(1);
      expect(
        (calls('git:status-update')[0][1] as GitStatusUpdatePayload).causes,
      ).toEqual(['workspace']);
      const contentPushes = calls('file:content-changed');
      expect(contentPushes).toHaveLength(1);
      const payload = contentPushes[0][1] as FileContentChangedPayload;
      expect(payload.truncated).toBe(true);
      expect(payload.filePaths.length).toBeLessThanOrEqual(256);
    });

    it('a storm that never quiets refreshes once per maxStormMs, then re-enters', async () => {
      // 1,000 events per second for 31 s — well above the 500/s threshold.
      for (let ms = 0; ms < 31_000; ms += 10) {
        for (let i = 0; i < 10; i++) emit('rename', `build\\out-${ms}-${i}.js`);
        jest.advanceTimersByTime(10);
      }
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('file:content-changed')).toHaveLength(1);
      expect(
        warnMessages().filter((m) => m === '[GitWatcher] event storm entered'),
      ).toHaveLength(2);

      // Events stop: the re-entered storm exits on quiet with its own refresh.
      jest.advanceTimersByTime(5_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(2);
      expect(calls('file:content-changed')).toHaveLength(2);
    });

    it('.claude/commands and .claude/skills still schedule a refresh and a content push', async () => {
      emit('change', '.claude\\commands\\x.md');
      emit('change', '.claude/skills/y/SKILL.md');
      jest.advanceTimersByTime(2_000);
      await flush();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('file:content-changed')[0][1]).toEqual({
        filePaths: [
          'D:/fake/ws/.claude/commands/x.md',
          'D:/fake/ws/.claude/skills/y/SKILL.md',
        ],
        truncated: false,
      });
    });

    it('a nested .git entry excludes its parent root, detected before the .git filter', async () => {
      (svc as unknown as { nestedRepoRoots: NestedRepoRoots }).nestedRepoRoots =
        new NestedRepoRoots(WS);

      expect(
        internals().isIgnoredWorkspaceEvent('pkg\\vendor\\src\\a.ts'),
      ).toBe(false);
      emit('rename', 'pkg\\vendor\\.git');
      expect(
        internals().isIgnoredWorkspaceEvent('pkg\\vendor\\src\\a.ts'),
      ).toBe(true);
      expect(internals().isIgnoredWorkspaceEvent('pkg/other/a.ts')).toBe(false);

      emit('change', 'pkg\\vendor\\src\\a.ts');
      jest.advanceTimersByTime(10_000);
      await flush();
      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();

      // A worktree re-list keeps the root discovered at runtime.
      gitInfo.getWorktrees.mockResolvedValueOnce([]);
      await internals().refreshNestedRepoRoots(WS, internals().armGeneration);
      expect(internals().isIgnoredWorkspaceEvent('pkg/vendor/src/a.ts')).toBe(
        true,
      );
    });

    it('seeds nested roots from git worktree list (worktrees under the workspace only)', async () => {
      gitInfo.getWorktrees.mockResolvedValueOnce([
        { path: 'D:\\fake\\ws' },
        { path: 'D:/fake/ws/sandbox/wt1' },
        { path: 'D:\\elsewhere\\wt2' },
      ] as GitWorktreeInfo[]);

      await internals().refreshNestedRepoRoots(WS, internals().armGeneration);

      expect(
        internals().isIgnoredWorkspaceEvent('sandbox\\wt1\\src\\a.ts'),
      ).toBe(true);
      expect(internals().isIgnoredWorkspaceEvent('SANDBOX/WT1/a.ts')).toBe(
        true,
      );
      expect(internals().isIgnoredWorkspaceEvent('sandbox/a.ts')).toBe(false);
      expect(internals().isIgnoredWorkspaceEvent('src/a.ts')).toBe(false);
    });

    it('drops a worktree listing that resolves after the watcher moved on', async () => {
      let resolveList!: (list: GitWorktreeInfo[]) => void;
      gitInfo.getWorktrees.mockReturnValueOnce(
        new Promise((resolve) => (resolveList = resolve)),
      );
      const pending = internals().refreshNestedRepoRoots(
        WS,
        internals().armGeneration,
      );
      internals().armGeneration++;
      resolveList([{ path: 'D:\\fake\\ws\\sandbox\\wt1' } as GitWorktreeInfo]);
      await pending;

      expect(internals().isIgnoredWorkspaceEvent('sandbox/wt1/a.ts')).toBe(
        false,
      );
    });

    it('a failed worktree listing keeps the static rules and warns once', async () => {
      gitInfo.getWorktrees.mockRejectedValue(new Error('git missing'));

      await internals().refreshNestedRepoRoots(WS, internals().armGeneration);
      await internals().refreshNestedRepoRoots(WS, internals().armGeneration);

      const failures = warnMessages().filter((m) =>
        m.startsWith('[GitWatcher] Could not list worktrees'),
      );
      expect(failures).toHaveLength(1);
      expect(
        internals().isIgnoredWorkspaceEvent('.claude-worktrees/x/a.ts'),
      ).toBe(true);
      expect(internals().isIgnoredWorkspaceEvent('src/a.ts')).toBe(false);
    });

    it('re-lists worktrees after a .git/worktrees record changes, not on commits inside one', async () => {
      emit('rename', '.git\\worktrees\\wt1\\HEAD');
      emit('change', '.git/objects/ab/cdef');
      jest.advanceTimersByTime(1_000);
      await flush();
      expect(gitInfo.getWorktrees).not.toHaveBeenCalled();

      emit('rename', '.git\\worktrees\\wt1');
      emit('rename', '.git\\worktrees\\wt2');
      jest.advanceTimersByTime(500);
      await flush();
      expect(gitInfo.getWorktrees).toHaveBeenCalledTimes(1);
      expect(gitInfo.getWorktrees).toHaveBeenCalledWith(WS);

      // Events inside the workspace's own .git never schedule a status refresh.
      jest.advanceTimersByTime(10_000);
      await flush();
      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();
    });

    it('10,000 .git marker events during a storm are not parsed per event; the exit re-lists worktrees once', async () => {
      const parseSpy = nestedRepoRootOf as jest.Mock;
      for (let i = 0; i < 1_000; i++) emit('rename', `src\\f-${i}.ts`);
      expect(warnMessages()).toContain('[GitWatcher] event storm entered');
      parseSpy.mockClear();

      // `git worktree remove` deleting worktree records, plus a nested
      // repository's own metadata — both would parse a path per event.
      for (let i = 0; i < 10_000; i++) {
        emit(
          'rename',
          i % 2 === 0
            ? `.git\\worktrees\\wt-${i % 10}\\objects\\${i}`
            : `vendor\\repo\\.git\\objects\\${i}`,
        );
        if (i % 10 === 9) jest.advanceTimersByTime(1);
      }
      expect(parseSpy).not.toHaveBeenCalled();
      expect(gitInfo.getWorktrees).not.toHaveBeenCalled();

      jest.advanceTimersByTime(10_000);
      await flush();

      expect(gitInfo.getWorktrees).toHaveBeenCalledTimes(1);
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
    });

    // ---- Unattributed (null-filename) changes — Batch 6 ST-1 finding ----

    function emitNull(): void {
      internals().onWorkspaceEvent(WS, 'change', null);
    }

    it('a null-filename event alone schedules no refresh and no push inside 10 s', async () => {
      emitNull();
      jest.advanceTimersByTime(10_000);
      await flush();

      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });

    it('a null-filename event folds into the next real refresh: one refresh total', async () => {
      emitNull();
      emit('change', 'src\\a.ts');
      jest.advanceTimersByTime(2_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);

      // The real refresh covered it: no safety refresh follows.
      jest.advanceTimersByTime(120_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
    });

    it('null-only changes get exactly one safety refresh after 30 s of quiet, never more often', async () => {
      // Sporadic nulls for 20 s push the quiet window out without re-arming
      // per event.
      for (let t = 0; t < 20_000; t += 5_000) {
        emitNull();
        jest.advanceTimersByTime(5_000);
      }
      await flush();
      // Last null at t=15 s → quiet deadline t=45 s; now t=20 s.
      jest.advanceTimersByTime(24_000);
      await flush();
      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();

      jest.advanceTimersByTime(1_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(
        (calls('git:status-update')[0][1] as GitStatusUpdatePayload).causes,
      ).toEqual(['workspace']);
      expect(calls('file:content-changed')).toHaveLength(0);

      jest.advanceTimersByTime(120_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
    });

    it('a pending unattributed change is absorbed by a storm: one refresh, no safety refresh mid-storm or after', async () => {
      emitNull();
      // A storm that outlasts the 30 s safety window: 1,000 events/s for 29 s,
      // starting 2 s after the null, so the null's deadline (t=30 s) falls
      // inside the storm.
      jest.advanceTimersByTime(2_000);
      for (let ms = 0; ms < 29_000; ms += 10) {
        for (let i = 0; i < 10; i++) emit('rename', `pkgs\\big\\f-${ms}-${i}`);
        jest.advanceTimersByTime(10);
      }
      await flush();
      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();

      // Quiet exit, then long after: exactly the storm's one refresh.
      jest.advanceTimersByTime(120_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(
        (svc as unknown as { unattributedChangeTimer: unknown })
          .unattributedChangeTimer,
      ).toBeNull();
    });

    it('a flood of null-filename events enters a storm and exits with one refresh', async () => {
      for (let i = 0; i < 5_000; i++) {
        emitNull();
        if (i % 10 === 9) jest.advanceTimersByTime(1);
      }
      expect(
        warnMessages().filter((m) => m === '[GitWatcher] event storm entered'),
      ).toHaveLength(1);

      jest.advanceTimersByTime(5_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('file:content-changed')).toHaveLength(1);

      // The pre-storm nulls were covered by the exit refresh.
      jest.advanceTimersByTime(120_000);
      await flush();
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
    });

    // ---- Exit/enter pairing — Batch 6 ST-1b finding ----

    it('one storm shorter than maxStormMs logs one enter, one exit and issues one refresh, however often its timer re-arms', async () => {
      // 20 s of 1,000 events/s: the exit timer re-arms roughly every 2 s.
      for (let ms = 0; ms < 20_000; ms += 10) {
        for (let i = 0; i < 10; i++) emit('rename', `pkgs\\big\\f-${ms}-${i}`);
        jest.advanceTimersByTime(10);
      }
      jest.advanceTimersByTime(5_000);
      await flush();

      expect(
        warnMessages().filter((m) => m === '[GitWatcher] event storm entered'),
      ).toHaveLength(1);
      expect(
        warnMessages().filter((m) => m === '[GitWatcher] event storm exited'),
      ).toHaveLength(1);
      expect(gitInfo.refreshGitInfo).toHaveBeenCalledTimes(1);
      expect(calls('git:status-update')).toHaveLength(1);
      expect(calls('file:content-changed')).toHaveLength(1);
    });

    it('stop() cancels a pending storm exit', async () => {
      for (let i = 0; i < 1_000; i++) emit('rename', `src\\f-${i}.ts`);
      expect(warnMessages()).toContain('[GitWatcher] event storm entered');

      svc.stop();
      jest.advanceTimersByTime(60_000);
      await flush();

      expect(gitInfo.refreshGitInfo).not.toHaveBeenCalled();
      expect(broadcast).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // OWN-REFRESH ECHO (TASK_2026_437, Batch 6 ST-1b finding)
  //
  // `git status` reads every directory; on NTFS reading the parent of a just-
  // deleted tree makes `fs.watch` report a `change` on that directory, which
  // scheduled a second, self-inflicted refresh. Real temp directories and real
  // timers: the echo check `stat`s the path.
  // ===========================================================================

  describe('own git status echo', () => {
    let tmpDir: string;

    type EchoInternals = {
      onWorkspaceEvent(root: string, eventType: string, f: string | null): void;
      fetchAndPush(): Promise<void>;
      debounceTimer: unknown;
      ownRefreshEchoUntil: number;
      ownRefreshesInFlight: number;
      unattributedChangeAt: number | null;
      unattributedChangeTimer: unknown;
    };
    const echo = (): EchoInternals => svc as unknown as EchoInternals;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-echo-'));
      fs.mkdirSync(path.join(tmpDir, 'pkgs'));
      fs.writeFileSync(path.join(tmpDir, 'a.ts'), 'export {};\n');
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath = tmpDir;
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;
    });

    afterEach(() => {
      svc.stop();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('a git status run opens an echo window', async () => {
      expect(echo().ownRefreshEchoUntil).toBe(0);
      await echo().fetchAndPush();
      expect(echo().ownRefreshEchoUntil).toBeGreaterThan(Date.now());
    });

    it('inside the window a directory change is dropped, a file change still schedules', async () => {
      echo().ownRefreshEchoUntil = Date.now() + 60_000;

      echo().onWorkspaceEvent(tmpDir, 'change', 'pkgs');
      // Not scheduled, but not forgotten: the drop is an unattributed change,
      // covered by the next real refresh or the 30 s safety refresh.
      expect(
        await waitFor(() => echo().unattributedChangeAt !== null, 1_500),
      ).toBe(true);
      expect(echo().unattributedChangeTimer).not.toBeNull();
      expect(echo().debounceTimer).toBeNull();

      echo().onWorkspaceEvent(tmpDir, 'change', 'a.ts');
      expect(await waitFor(() => echo().debounceTimer !== null, 1_500)).toBe(
        true,
      );
    });

    it('inside the window a rename, or a change on a path already gone, still schedules', async () => {
      echo().ownRefreshEchoUntil = Date.now() + 60_000;

      echo().onWorkspaceEvent(tmpDir, 'change', 'deleted.ts');
      expect(await waitFor(() => echo().debounceTimer !== null, 1_500)).toBe(
        true,
      );

      svc.stop();
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;
      echo().ownRefreshEchoUntil = Date.now() + 60_000;
      echo().onWorkspaceEvent(tmpDir, 'rename', 'pkgs');
      expect(echo().debounceTimer).not.toBeNull();
    });

    it('outside the window a directory change schedules without any stat', () => {
      echo().onWorkspaceEvent(tmpDir, 'change', 'pkgs');
      expect(echo().debounceTimer).not.toBeNull();
    });

    it('stop() closes the window, and a run from before the stop cannot reopen it', async () => {
      let finishRun!: () => void;
      gitInfo.refreshGitInfo.mockImplementationOnce(
        () =>
          new Promise<GitInfoResult>((resolve) => {
            finishRun = () =>
              resolve({
                isGitRepo: true,
                files: [],
              } as unknown as GitInfoResult);
          }),
      );
      const staleRun = echo().fetchAndPush();
      expect(echo().ownRefreshesInFlight).toBe(1);

      svc.stop();
      expect(echo().ownRefreshesInFlight).toBe(0);
      expect(echo().ownRefreshEchoUntil).toBe(0);

      // The next arm's events must not be read as echoes of the stale run.
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;
      finishRun();
      await staleRun;
      expect(echo().ownRefreshesInFlight).toBe(0);
      expect(echo().ownRefreshEchoUntil).toBe(0);
      echo().onWorkspaceEvent(tmpDir, 'change', 'pkgs');
      expect(echo().debounceTimer).not.toBeNull();
    });
  });

  // ===========================================================================
  // FILTERING TESTS — exercise the real watcher callback function
  // ===========================================================================

  describe('node_modules / dist / .git filtering', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-filter-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    it('start() on a non-git workspace does NOT schedule git-specific watchers', () => {
      // No .git directory present
      svc.start(tmpDir, broadcast);

      // Workspace-root watcher attached (1), git-specific watchers (HEAD,
      // index, refs) NOT attached.
      const watchers = (svc as unknown as { watchers: unknown[] }).watchers;
      expect(watchers.length).toBe(1);
    });

    /**
     * Calls the SHIPPED exclusion decision (`isIgnoredWorkspaceEvent`, a
     * one-line adapter over `isExcludedWorkspacePath` /`WATCH_IGNORED_DIRS`
     * in `@ptah-extension/shared`).
     *
     * The previous version of this test hand-rolled the predicate inline,
     * which made the spec a fourth maintained copy of the exclusion list and
     * blind to exactly the drift TASK_2026_173 B4 exists to prevent. There is
     * now no list here at all.
     *
     * `fs.watch` itself is not intercepted: Node's `fs` exports are
     * non-configurable, so `jest.spyOn(fs, 'watch')` throws
     * "Cannot redefine property". The end-to-end wiring (this decision
     * actually gating the watcher callback) is covered by the real-`fs.watch`
     * integration test further down.
     */
    function isIgnored(filename: string): boolean {
      return (
        svc as unknown as {
          isIgnoredWorkspaceEvent(f: string): boolean;
        }
      ).isIgnoredWorkspaceEvent(filename);
    }

    it('drops events under every excluded directory', () => {
      // Pre-existing exclusions — unchanged behaviour.
      for (const name of [
        '.git',
        '.git/HEAD',
        '.git\\HEAD',
        'node_modules/foo.ts',
        'node_modules\\foo.ts',
        'dist/main.js',
        'dist\\main.js',
      ]) {
        expect(isIgnored(name)).toBe(true);
      }

      // Newly excluded by TASK_2026_173 B4 — the intentional behavioural delta.
      for (const name of [
        '.nx/cache/abc.tmp',
        '.nx\\cache\\abc.tmp',
        '.angular/cache/x.tmp',
        '.cache/build/x.bin',
        '.tmp/scratch',
        '.temp/scratch',
        '.hg/store',
        '.svn/entries',
        '.Trash/deleted',
        '.DS_Store',
      ]) {
        expect(isIgnored(name)).toBe(true);
      }

      // Newly excluded by TASK_2026_385 Batch 4.3 — the explorer that made
      // `coverage`/`tmp` risky to hide is gone (see workspace-scan.constants.ts).
      for (const name of [
        'coverage/lcov.info',
        'coverage\\lcov.info',
        'tmp/x',
        'tmp\\x',
      ]) {
        expect(isIgnored(name)).toBe(true);
      }

      // Nested occurrences too — monorepo churn does not only live at the root.
      for (const name of [
        'packages/foo/node_modules/bar/index.js',
        'libs\\shared\\dist\\index.js',
      ]) {
        expect(isIgnored(name)).toBe(true);
      }

      // Agent worktree directories (TASK_2026_437 NESTED_WORKSPACE_PATH_RULES).
      for (const name of [
        '.claude-worktrees/wt/src/a.ts',
        '.claude-worktrees\\wt\\src\\a.ts',
        '.claude/worktrees/wt/src/a.ts',
        '.claude\\worktrees\\wt\\src\\a.ts',
        'pkg\\.Claude-Worktrees\\wt\\a.ts',
      ]) {
        expect(isIgnored(name)).toBe(true);
      }
    });

    it('keeps genuine source events, including plausible-source directories (R-9)', () => {
      for (const name of [
        'src/foo.ts',
        'src\\foo.ts',
        'apps/ptah-electron/src/main.ts',
        'README.md',
        // Deliberately NOT excluded: each is a plausible source directory.
        'out/generated.ts',
        'build/config.ts',
        '.next/page.ts',
        '.turbo/log.ts',
        // Prefix collisions must not be treated as segment matches.
        'distribution/a.ts',
        'node_modules_backup/a.ts',
        // Config dot-directories the watcher still tracks.
        '.vscode/settings.json',
        '.github/workflows/ci.yml',
        // `.claude` alone stays watched: it holds tracked commands and skills.
        '.claude/commands/x.md',
        '.claude\\skills\\y\\SKILL.md',
      ]) {
        expect(isIgnored(name)).toBe(false);
      }
      // A null filename never reaches this predicate: `onWorkspaceEvent`
      // handles it as an unattributed change — see the "Unattributed
      // (null-filename) changes" tests inside the "event storms and
      // nested-repository exclusion (TASK_2026_437)" describe.
    });

    it('arms the dedicated .git watchers unfiltered (git ops still detected)', () => {
      // `.git` is excluded from the RECURSIVE workspace watcher only, because
      // the dedicated HEAD/index/refs watchers own it. If the shared exclusion
      // predicate ever leaked into watchFile/watchDirectory, every commit,
      // stage, checkout and branch switch would stop being detected — a far
      // worse regression than the churn B4 removes.
      const gitDir = path.join(tmpDir, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(gitDir, 'index'), '');
      fs.mkdirSync(path.join(gitDir, 'refs'));

      svc.start(tmpDir, broadcast);

      // 1 workspace-root + HEAD + index + refs = 4. A leak of the predicate
      // into watchFile/watchDirectory would drop this to 1.
      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        4,
      );
    });
  });

  // ===========================================================================
  // LIFECYCLE TESTS — start() twice, switchWorkspace(), real fs.watch
  // ===========================================================================

  describe('lifecycle', () => {
    let tmpA: string;
    let tmpB: string;

    beforeEach(() => {
      tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-life-a-'));
      tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-life-b-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpA, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      try {
        fs.rmSync(tmpB, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    it('start() called twice cleans up previous watchers (no leak)', () => {
      svc.start(tmpA, broadcast);
      const firstCount = (svc as unknown as { watchers: unknown[] }).watchers
        .length;
      expect(firstCount).toBe(1);

      svc.start(tmpB, broadcast);
      const secondCount = (svc as unknown as { watchers: unknown[] }).watchers
        .length;
      // Switching to a different non-git workspace should still result in
      // exactly the workspace-root watcher (no accumulation from tmpA).
      expect(secondCount).toBe(1);
    });

    it('switchWorkspace() to a non-git workspace re-attaches workspace watcher (after debounce)', async () => {
      svc.start(tmpA, broadcast);
      svc.switchWorkspace(tmpB);

      // Debounced: the re-arm has not happened yet.
      expect((svc as unknown as { workspacePath: string }).workspacePath).toBe(
        tmpA,
      );

      // After the switch-debounce window the final target is armed.
      await waitFor(
        () =>
          (svc as unknown as { workspacePath: string }).workspacePath === tmpB,
        1500,
      );

      const watchers = (svc as unknown as { watchers: unknown[] }).watchers;
      expect(watchers.length).toBe(1);
      expect((svc as unknown as { workspacePath: string }).workspacePath).toBe(
        tmpB,
      );
    });

    it('switchWorkspace() to the same path is a no-op', () => {
      svc.start(tmpA, broadcast);
      const before = (svc as unknown as { watchers: unknown[] }).watchers;
      const beforeRef = before;
      svc.switchWorkspace(tmpA);
      const after = (svc as unknown as { watchers: unknown[] }).watchers;
      // Same array reference — start() was not re-invoked
      expect(after).toBe(beforeRef);
    });

    it('start() on a git workspace attaches git-specific watchers (HEAD, index, refs)', () => {
      // Build a minimal .git structure
      const gitDir = path.join(tmpA, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(gitDir, 'index'), '');
      fs.mkdirSync(path.join(gitDir, 'refs'));

      svc.start(tmpA, broadcast);

      // 1 workspace-root + 1 HEAD + 1 index + 1 refs = 4
      const watchers = (svc as unknown as { watchers: unknown[] }).watchers;
      expect(watchers.length).toBe(4);
      // Nested worktree roots are seeded without blocking start().
      expect(gitInfo.getWorktrees).toHaveBeenCalledWith(tmpA);
    });

    it('start() watches .git/worktrees when the repository has linked worktrees', () => {
      const gitDir = path.join(tmpA, '.git');
      fs.mkdirSync(path.join(gitDir, 'refs'), { recursive: true });
      fs.mkdirSync(path.join(gitDir, 'worktrees'));
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(gitDir, 'index'), '');

      svc.start(tmpA, broadcast);

      // workspace-root + HEAD + index + refs + worktrees = 5
      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        5,
      );
    });

    it('start() on a non-git workspace does not list worktrees', () => {
      svc.start(tmpA, broadcast);
      expect(gitInfo.getWorktrees).not.toHaveBeenCalled();
    });

    it('git workspace push fires initial git:status-update', async () => {
      const gitDir = path.join(tmpA, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(gitDir, 'index'), '');
      fs.mkdirSync(path.join(gitDir, 'refs'));

      svc.start(tmpA, broadcast);

      // start() calls fetchAndPush() synchronously after attaching watchers
      await waitFor(
        () => broadcast.mock.calls.some(([t]) => t === 'git:status-update'),
        2000,
      );

      const gitCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'git:status-update',
      );
      expect(gitCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ===========================================================================
  // SWITCH DEBOUNCE + DEFERRED INITIAL FETCH (deterministic, fake timers)
  // ===========================================================================

  describe('switch debounce + deferred initial fetch', () => {
    let tmpA: string;
    let tmpB: string;

    beforeEach(() => {
      tmpA = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-switch-a-'));
      tmpB = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-switch-b-'));
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
      for (const dir of [tmpA, tmpB]) {
        try {
          fs.rmSync(dir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
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
      expect((svc as unknown as { workspacePath: string }).workspacePath).toBe(
        tmpB,
      );
    });

    it('A→B→A quickly leaves A watched with no teardown (queued restart dropped)', () => {
      svc.start(tmpA, broadcast);
      const startSpy = jest.spyOn(svc, 'start');

      svc.switchWorkspace(tmpB);
      svc.switchWorkspace(tmpA); // final target === currently watched path

      jest.advanceTimersByTime(300);

      // The restart is dropped because the final target is already watched.
      expect(startSpy).not.toHaveBeenCalled();
      expect((svc as unknown as { workspacePath: string }).workspacePath).toBe(
        tmpA,
      );
    });

    it('does not fire the initial git:status-update synchronously on arm', async () => {
      // Give tmpA a .git dir so the initial fetch path is reached.
      const gitDir = path.join(tmpA, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(gitDir, 'index'), '');
      fs.mkdirSync(path.join(gitDir, 'refs'));

      svc.start(tmpA, broadcast);

      // Watchers are armed immediately, but the fetch is deferred.
      expect(
        broadcast.mock.calls.some(([t]) => t === 'git:status-update'),
      ).toBe(false);

      jest.advanceTimersByTime(50);
      // Flush the async fetchAndPush microtasks.
      await Promise.resolve();
      await Promise.resolve();

      expect(gitInfo.refreshGitInfo).toHaveBeenCalledWith(tmpA);
      expect(
        broadcast.mock.calls.some(([t]) => t === 'git:status-update'),
      ).toBe(true);
    });

    it('stop() before the deferred initial fetch fires suppresses it', async () => {
      const gitDir = path.join(tmpA, '.git');
      fs.mkdirSync(gitDir);
      fs.writeFileSync(path.join(gitDir, 'HEAD'), 'ref: refs/heads/main\n');
      fs.writeFileSync(path.join(gitDir, 'index'), '');
      fs.mkdirSync(path.join(gitDir, 'refs'));

      svc.start(tmpA, broadcast);
      svc.stop();

      jest.advanceTimersByTime(50);
      await Promise.resolve();
      await Promise.resolve();

      expect(
        broadcast.mock.calls.some(([t]) => t === 'git:status-update'),
      ).toBe(false);
    });
  });

  // ===========================================================================
  // REAL fs.watch INTEGRATION — non-git workspace still schedules git:status-update
  //
  // TASK_2026_385 Batch 4.3: the file-tree refresh job (and its
  // `file:tree-changed` push) is gone along with the file explorer it fed.
  // `git:status-update` is now the only observable signal that the workspace
  // watcher's `WATCH_IGNORED_DIRS` predicate is wired into the real
  // `fs.watch` callback, so these tests assert on it instead.
  //
  // These tests use real timers and real file system events. They are
  // timing-sensitive on Windows; we tolerate up to a few seconds and poll
  // rather than depend on a precise tick.
  // ===========================================================================

  describe('real fs.watch integration (non-git workspace)', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-real-'));
    });

    afterEach(() => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    });

    it('non-git workspace still schedules git:status-update when a file is created', async () => {
      svc.start(tmpDir, broadcast);
      broadcast.mockClear();

      // Create a new file — fs.watch should emit 'rename', which schedules
      // scheduleUpdate; the broadcast fires after WORKSPACE_DEBOUNCE_MS (2000).
      fs.writeFileSync(path.join(tmpDir, 'new-file.ts'), 'export {};\n');

      const fired = await waitFor(
        () => broadcast.mock.calls.some(([t]) => t === 'git:status-update'),
        4000,
      );

      // Document timing-sensitivity: fs.watch on Windows can occasionally
      // miss events for very short-lived test files. We assert the contract
      // but tolerate a single retry.
      if (!fired) {
        fs.writeFileSync(path.join(tmpDir, 'new-file-2.ts'), 'export {};\n');
        await waitFor(
          () => broadcast.mock.calls.some(([t]) => t === 'git:status-update'),
          4000,
        );
      }

      const statusCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'git:status-update',
      );
      expect(statusCalls.length).toBeGreaterThanOrEqual(1);
    }, 10000);

    /**
     * End-to-end proof that the shared exclusion predicate is actually wired
     * into the `fs.watch` callback — the unit tests above exercise the
     * decision, this exercises the wiring.
     *
     * Positive control in the same test: if the negative half passed because
     * `fs.watch` simply delivered nothing, the positive half would fail too.
     */
    it('writes under .nx/.angular/coverage/tmp are ignored while a real source write still pushes', async () => {
      const nxCache = path.join(tmpDir, '.nx', 'cache');
      const ngCache = path.join(tmpDir, '.angular', 'cache');
      const coverageDir = path.join(tmpDir, 'coverage');
      const tmpOutputDir = path.join(tmpDir, 'tmp');
      const srcDir = path.join(tmpDir, 'src');
      // Created BEFORE start() so the mkdir events themselves are not measured.
      fs.mkdirSync(nxCache, { recursive: true });
      fs.mkdirSync(ngCache, { recursive: true });
      fs.mkdirSync(coverageDir, { recursive: true });
      fs.mkdirSync(tmpOutputDir, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      svc.start(tmpDir, broadcast);
      broadcast.mockClear();

      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(nxCache, `probe-${i}.tmp`), String(i));
        fs.writeFileSync(path.join(ngCache, `probe-${i}.tmp`), String(i));
        fs.writeFileSync(path.join(coverageDir, `probe-${i}.tmp`), String(i));
        fs.writeFileSync(path.join(tmpOutputDir, `probe-${i}.tmp`), String(i));
      }

      // Well past WORKSPACE_DEBOUNCE_MS (2000) — nothing may have been pushed.
      await new Promise((r) => setTimeout(r, 2800));
      expect(
        broadcast.mock.calls.filter(([t]) => t === 'git:status-update'),
      ).toHaveLength(0);

      // Positive control: a genuine source write still fires (B4 AC3, R-9).
      fs.writeFileSync(path.join(srcDir, 'real.ts'), 'export {};\n');
      const fired = await waitFor(
        () => broadcast.mock.calls.some(([t]) => t === 'git:status-update'),
        4000,
      );
      if (!fired) {
        // fs.watch on Windows occasionally misses a short-lived file event.
        fs.writeFileSync(path.join(srcDir, 'real-2.ts'), 'export {};\n');
        await waitFor(
          () => broadcast.mock.calls.some(([t]) => t === 'git:status-update'),
          4000,
        );
      }
      expect(
        broadcast.mock.calls.filter(([t]) => t === 'git:status-update').length,
      ).toBeGreaterThanOrEqual(1);
    }, 20000);
  });
});
