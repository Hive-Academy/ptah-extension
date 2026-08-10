/**
 * GitWatcherService specs — file-tree refresh debouncing, workspace watcher
 * lifecycle, ignore-list filtering, and stop/start cleanup.
 *
 * Strategy: most tests are deterministic — they invoke the private
 * `scheduleTreeRefresh` / `scheduleUpdate` / `scheduleContentChange` callbacks
 * directly via `(svc as any)` and drive timers via `jest.useFakeTimers()`.
 *
 * A small number of tests exercise the real `fs.watch` path with actual
 * temp directories (real timers). These are timing-sensitive on Windows;
 * they intentionally use generous timeouts and tolerate occasional flake
 * by polling rather than asserting on a single tick.
 *
 * The `GitInfoService.getGitInfo` mock returns a static result so the
 * `git:status-update` broadcast is observable without spawning git.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { GitWatcherService } from './git-watcher.service';
import type { GitInfoService, Logger } from '@ptah-extension/vscode-core';
import type {
  GitChangeKind,
  GitInfoResult,
  GitStatusUpdatePayload,
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
  return {
    getGitInfo: jest.fn(
      async (): Promise<GitInfoResult> =>
        ({
          isGitRepo: true,
          branch: { branch: 'main', upstream: null, ahead: 0, behind: 0 },
          files: [],
        }) as unknown as GitInfoResult,
    ),
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

    it('coalesces 10 rapid scheduleTreeRefresh calls into a single broadcast', () => {
      // Manually wire the broadcast + workspacePath so private schedulers run
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      for (let i = 0; i < 10; i++) {
        (
          svc as unknown as { scheduleTreeRefresh(): void }
        ).scheduleTreeRefresh();
      }

      // Before debounce window elapses, no broadcast yet
      jest.advanceTimersByTime(499);
      expect(broadcast).not.toHaveBeenCalledWith('file:tree-changed', {});

      // Crossing the 500ms window fires exactly once
      jest.advanceTimersByTime(1);
      const treeCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'file:tree-changed',
      );
      expect(treeCalls).toHaveLength(1);
      expect(treeCalls[0]).toEqual(['file:tree-changed', {}]);
    });

    it('stop() before the debounce timer fires prevents the broadcast', () => {
      (svc as unknown as { broadcastFn: Broadcast }).broadcastFn = broadcast;
      (svc as unknown as { workspacePath: string }).workspacePath =
        'D:\\fake\\ws';
      (svc as unknown as { isDisposed: boolean }).isDisposed = false;

      (svc as unknown as { scheduleTreeRefresh(): void }).scheduleTreeRefresh();
      svc.stop();
      jest.advanceTimersByTime(2000);

      const treeCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'file:tree-changed',
      );
      expect(treeCalls).toHaveLength(0);
      // watchers list is empty after stop()
      expect((svc as unknown as { watchers: unknown[] }).watchers).toHaveLength(
        0,
      );
    });

    it('scheduleContentChange coalesces rapid saves to the same path', () => {
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
      expect(contentCalls[0][1]).toEqual({ filePath: 'D:/fake/ws/a.ts' });
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

      expect(gitInfo.getGitInfo).toHaveBeenCalledWith('D:\\fake\\ws');
      const gitCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'git:status-update',
      );
      expect(gitCalls.length).toBeGreaterThanOrEqual(1);
      const payload = gitCalls[0][1] as GitStatusUpdatePayload;
      expect(payload.causes).toEqual(['workspace']);
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

      gitInfo.getGitInfo.mockImplementationOnce(async () => {
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
          isIgnoredWorkspaceEvent(f: string | null): boolean;
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

      // Nested occurrences too — monorepo churn does not only live at the root.
      for (const name of [
        'packages/foo/node_modules/bar/index.js',
        'libs\\shared\\dist\\index.js',
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
        'coverage/report.ts',
        '.next/page.ts',
        '.turbo/log.ts',
        // Prefix collisions must not be treated as segment matches.
        'distribution/a.ts',
        'node_modules_backup/a.ts',
        // Config dot-directories the tree shows and the watcher tracks.
        '.vscode/settings.json',
        '.github/workflows/ci.yml',
      ]) {
        expect(isIgnored(name)).toBe(false);
      }

      // A null filename (platforms that do not surface it) is never ignored —
      // the update must still be scheduled.
      expect(
        (
          svc as unknown as {
            isIgnoredWorkspaceEvent(f: string | null): boolean;
          }
        ).isIgnoredWorkspaceEvent(null),
      ).toBe(false);
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

      expect(gitInfo.getGitInfo).toHaveBeenCalledWith(tmpA);
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
  // REAL fs.watch INTEGRATION — non-git workspace receives file:tree-changed
  //
  // These tests use real timers and real file system events. They are
  // timing-sensitive on Windows; we tolerate up to 2s and poll rather than
  // depend on a precise tick.
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

    it('non-git workspace still receives file:tree-changed when a file is created', async () => {
      svc.start(tmpDir, broadcast);

      // Create a new file — fs.watch should emit 'rename' which triggers
      // scheduleTreeRefresh; the broadcast fires after TREE_DEBOUNCE_MS (500).
      fs.writeFileSync(path.join(tmpDir, 'new-file.ts'), 'export {};\n');

      const fired = await waitFor(
        () => broadcast.mock.calls.some(([t]) => t === 'file:tree-changed'),
        2500,
      );

      // Document timing-sensitivity: fs.watch on Windows can occasionally
      // miss events for very short-lived test files. We assert the contract
      // but tolerate a single retry.
      if (!fired) {
        fs.writeFileSync(path.join(tmpDir, 'new-file-2.ts'), 'export {};\n');
        await waitFor(
          () => broadcast.mock.calls.some(([t]) => t === 'file:tree-changed'),
          2500,
        );
      }

      const treeCalls = broadcast.mock.calls.filter(
        ([t]) => t === 'file:tree-changed',
      );
      expect(treeCalls.length).toBeGreaterThanOrEqual(1);
    });

    /**
     * End-to-end proof that the shared exclusion predicate is actually wired
     * into the `fs.watch` callback — the unit tests above exercise the
     * decision, this exercises the wiring.
     *
     * Positive control in the same test: if the negative half passed because
     * `fs.watch` simply delivered nothing, the positive half would fail too.
     */
    it('writes under .nx/.angular are ignored while a real source write still pushes', async () => {
      const nxCache = path.join(tmpDir, '.nx', 'cache');
      const ngCache = path.join(tmpDir, '.angular', 'cache');
      const srcDir = path.join(tmpDir, 'src');
      // Created BEFORE start() so the mkdir events themselves are not measured.
      fs.mkdirSync(nxCache, { recursive: true });
      fs.mkdirSync(ngCache, { recursive: true });
      fs.mkdirSync(srcDir, { recursive: true });

      svc.start(tmpDir, broadcast);
      broadcast.mockClear();

      for (let i = 0; i < 5; i++) {
        fs.writeFileSync(path.join(nxCache, `probe-${i}.tmp`), String(i));
        fs.writeFileSync(path.join(ngCache, `probe-${i}.tmp`), String(i));
      }

      // Well past TREE_DEBOUNCE_MS (500) — nothing may have been pushed.
      await new Promise((r) => setTimeout(r, 1200));
      expect(
        broadcast.mock.calls.filter(([t]) => t === 'file:tree-changed'),
      ).toHaveLength(0);

      // Positive control: a genuine source write still fires (B4 AC3, R-9).
      fs.writeFileSync(path.join(srcDir, 'real.ts'), 'export {};\n');
      const fired = await waitFor(
        () => broadcast.mock.calls.some(([t]) => t === 'file:tree-changed'),
        2500,
      );
      if (!fired) {
        // fs.watch on Windows occasionally misses a short-lived file event.
        fs.writeFileSync(path.join(srcDir, 'real-2.ts'), 'export {};\n');
        await waitFor(
          () => broadcast.mock.calls.some(([t]) => t === 'file:tree-changed'),
          2500,
        );
      }
      expect(
        broadcast.mock.calls.filter(([t]) => t === 'file:tree-changed').length,
      ).toBeGreaterThanOrEqual(1);
    }, 15000);
  });
});
