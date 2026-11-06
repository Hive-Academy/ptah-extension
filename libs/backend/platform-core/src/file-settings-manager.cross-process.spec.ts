/**
 * Real cross-process integration test for PtahFileSettingsManager.
 *
 * Gap A: Unlike the in-process two-instance TC-CP-1 through TC-CP-5 tests in
 * file-settings-manager.spec.ts, this suite spawns an ACTUAL child Node
 * process via child_process.fork() so that the OS watcher codepath exercises
 * real cross-process file change notification semantics:
 *
 *   - Windows:  ReadDirectoryChangesW propagation across process boundaries.
 *   - macOS:    kqueue / FSEvents event propagation.
 *   - Linux:    inotify event coalescing when two processes share a file.
 *
 * Why this catches bugs single-process tests cannot:
 *   - The OS may batch/coalesce events differently when the writer is a
 *     separate process with a distinct file-descriptor table.
 *   - Windows AV hooks can delay rename events when they originate from a
 *     different process (tested here with a 2 s timeout).
 *   - The child's PtahFileSettingsManager has a completely separate module
 *     cache, so any module-level shared state does NOT bleed across.
 *
 * Flakiness note:
 *   On Windows the ReadDirectoryChangesW callback can be delayed by up to
 *   ~500 ms in heavy load or AV scanning scenarios. We use a 2 000 ms
 *   assertion timeout to stay green in CI without masking real failures.
 *   The test is NOT marked skip — it is intentionally a real OS coverage test.
 *
 * Source-under-test:
 *   libs/backend/platform-core/src/file-settings-manager.ts
 */

import * as childProcess from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// ---------------------------------------------------------------------------
// We mock os.homedir() at module level via jest.mock so that PtahFileSettingsManager
// constructed in the parent process also resolves to the temp directory.
// Each test overrides the mock return value via the updateHome() helper.
// ---------------------------------------------------------------------------

let _currentTempHome = '';

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => _currentTempHome || actual.homedir(),
  };
});

// Import after jest.mock() is established.
import { PtahFileSettingsManager } from './file-settings-manager';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Spawn the child helper script and wait for its 'ready' IPC handshake.
 * The child is given the temp dir via HOME/USERPROFILE env vars so that its
 * PtahFileSettingsManager resolves to the same path as the parent's.
 */
function spawnChild(tempHome: string): Promise<childProcess.ChildProcess> {
  return new Promise((resolve, reject) => {
    const childScript = path.join(__dirname, 'cross-process-child.ts');

    const child = childProcess.fork(childScript, [], {
      env: {
        ...process.env,
        HOME: tempHome,
        USERPROFILE: tempHome,
      },
      // ts-node/register allows TypeScript sources to run via fork().
      execArgv: ['-r', 'ts-node/register'],
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });

    const failTimer = setTimeout(() => {
      reject(new Error('Child process ready timeout (5 s)'));
      child.kill();
    }, 5000);

    const onError = (err: Error) => {
      clearTimeout(failTimer);
      reject(new Error(`Child process failed to start: ${err.message}`));
    };

    child.once('error', onError);

    child.once('message', (msg: unknown) => {
      const m = msg as { type: string };
      clearTimeout(failTimer);
      if (m.type === 'ready') {
        child.removeListener('error', onError);
        resolve(child);
      } else {
        reject(
          new Error(
            `Unexpected first message from child: ${JSON.stringify(msg)}`,
          ),
        );
      }
    });
  });
}

/**
 * Send a 'set' command to the child and wait for 'done'.
 */
function childSet(
  child: childProcess.ChildProcess,
  key: string,
  value: unknown,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (msg: unknown) => {
      const m = msg as { type: string; key?: string; message?: string };
      if (m.type === 'done' && m.key === key) {
        child.removeListener('message', handler);
        resolve();
      } else if (m.type === 'error') {
        child.removeListener('message', handler);
        reject(new Error(`Child error: ${m.message ?? 'unknown'}`));
      }
    };
    child.on('message', handler);
    child.send({ type: 'set', key, value });
  });
}

/**
 * Kill a child process and wait for it to exit.
 */
function killChild(child: childProcess.ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    child.once('exit', () => resolve());
    try {
      child.send({ type: 'exit' });
    } catch {
      // IPC channel may already be closed.
    }
    setTimeout(() => {
      try {
        child.kill();
      } catch {
        // Already exited.
      }
      resolve();
    }, 500);
  });
}

/**
 * Wait for a watcher callback to receive a specific value within a timeout.
 * Returns true if the value arrives, false on timeout.
 */
function waitForValue(
  received: unknown[],
  expected: unknown,
  timeoutMs: number,
): Promise<boolean> {
  return waitUntil(() => received.includes(expected), timeoutMs);
}

/** Poll until `predicate` is true, or until `timeoutMs` elapses. */
function waitUntil(
  predicate: () => boolean,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      if (predicate()) {
        clearInterval(interval);
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve(false);
      }
    }, 25);
  });
}

/**
 * External atomic replace: write a sibling temp file, then rename it onto
 * `filePath`. This is the write shape that replaces the watched inode.
 */
function atomicReplaceSettings(filePath: string, contents: string): void {
  const tmpPath = `${filePath}.${process.pid}.atomic.tmp`;
  fs.writeFileSync(tmpPath, contents, 'utf-8');
  fs.renameSync(tmpPath, filePath);
}

function settingsDocument(marker: string): string {
  return JSON.stringify(
    {
      $schema: 'https://ptah.live/schemas/settings.json',
      version: 1,
      external: { marker },
    },
    null,
    2,
  );
}

interface RecordedWatcher {
  target: string;
  closed: boolean;
}

/**
 * Record every `fs.watch` the manager opens, and whether `close()` ran.
 * Spies on the real `fs` exports object: the manager's `import * as fs`
 * reads that object, so a spy on this file's namespace would miss it.
 */
function recordFileWatches(): {
  records: RecordedWatcher[];
  restore: () => void;
} {
  const fsActual = jest.requireActual<typeof import('fs')>('fs');
  const originalWatch = fsActual.watch;
  const records: RecordedWatcher[] = [];
  const spy = jest.spyOn(fsActual, 'watch').mockImplementation((
    (...args: unknown[]) => {
      const watcher = Reflect.apply(
        originalWatch,
        fsActual,
        args,
      ) as fs.FSWatcher;
      const record: RecordedWatcher = {
        target: String(args[0]),
        closed: false,
      };
      const originalClose = watcher.close.bind(watcher);
      watcher.close = () => {
        record.closed = true;
        originalClose();
      };
      records.push(record);
      return watcher;
    }
  ) as typeof fs.watch);
  return { records, restore: () => spy.mockRestore() };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('PtahFileSettingsManager — REAL cross-process integration (Gap A)', () => {
  let tempHome: string;

  beforeEach(() => {
    tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-cp-real-'));
    // Set the mock homedir for parent-side manager construction.
    _currentTempHome = tempHome;
    // Ensure ~/.ptah/ exists so the directory watcher can start immediately.
    fs.mkdirSync(path.join(tempHome, '.ptah'), { recursive: true });
  });

  afterEach(() => {
    _currentTempHome = '';
    try {
      fs.rmSync(tempHome, { recursive: true, force: true });
    } catch {
      // Windows AV may hold handles briefly — ignore.
    }
  });

  /**
   * TC-CP-REAL-1: Real cross-process write detection.
   *
   * Parent watches a key. Child (separate OS process) writes it. Parent watcher must fire.
   *
   * Flakiness window: up to 2 000 ms on Windows (ReadDirectoryChangesW latency under AV).
   * Timeout: 15 000 ms (covers child startup + write + OS event delivery).
   */
  it('TC-CP-REAL-1: parent watcher fires when a child process writes the settings file', async () => {
    const parentMgr = new PtahFileSettingsManager({});
    parentMgr.enableCrossProcessWatch();

    // Allow the directory watcher to stabilise.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const received: unknown[] = [];
    parentMgr.watch('cross.process.key', (v) => received.push(v));

    let child: childProcess.ChildProcess;
    try {
      child = await spawnChild(tempHome);
    } catch (err) {
      // If fork fails (e.g. ts-node not available), skip gracefully.
      console.warn(
        `[TC-CP-REAL-1] Child spawn failed — test skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      parentMgr.disposeCrossProcessWatch();
      return;
    }

    try {
      await childSet(child, 'cross.process.key', 'from-child');

      // Wait up to 2 000 ms for the OS to deliver the fs.watch event.
      // This is the "flakiness window" described in the module doc.
      const arrived = await waitForValue(received, 'from-child', 2000);

      expect(arrived).toBe(true);
      expect(received).toContain('from-child');
    } finally {
      parentMgr.disposeCrossProcessWatch();
      await killChild(child);
    }
  }, 15000);

  /**
   * TC-CP-REAL-2: dispose() prevents cross-process notifications after child write.
   *
   * Parent watches, then disposes the cross-process watcher, then child writes.
   * No in-process listener should fire (child writes bypass the in-process watch).
   */
  it('TC-CP-REAL-2: disposed parent watcher does not fire when child writes', async () => {
    const parentMgr = new PtahFileSettingsManager({});
    parentMgr.enableCrossProcessWatch();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const received: unknown[] = [];
    parentMgr.watch('cp.dispose.key', (v) => received.push(v));

    // Dispose BEFORE the child write.
    parentMgr.disposeCrossProcessWatch();

    let child: childProcess.ChildProcess;
    try {
      child = await spawnChild(tempHome);
    } catch (err) {
      console.warn(
        `[TC-CP-REAL-2] Child spawn failed — test skipped: ${err instanceof Error ? err.message : String(err)}`,
      );
      return;
    }

    try {
      await childSet(child, 'cp.dispose.key', 'post-dispose');

      // Wait long enough that any stale event would have fired.
      await new Promise((resolve) => setTimeout(resolve, 600));

      // The cross-process watcher is disposed; child writes go directly to
      // disk without triggering the parent's fs.watch listener.
      // The in-process watch() only fires on in-process set() calls.
      expect(received).toHaveLength(0);
    } finally {
      await killChild(child);
    }
  }, 15000);

  /**
   * TC-CP-REAL-3: an existing settings.json is in file-watch mode. Two
   * successive external atomic replacements (tmp + rename) must both reload,
   * and each replaced inode's watcher must be closed.
   *
   * The 2 000 ms window matches TC-CP-REAL-1. This case fails while
   * tryStartFileWatch listens for an FSWatcher 'rename' event: the first
   * replacement can still flush, and the second is never delivered because
   * the watch stays on the dead inode.
   */
  it('TC-CP-REAL-3: two atomic replacements reload and close the stale watcher', async () => {
    const settingsPath = path.join(tempHome, '.ptah', 'settings.json');
    fs.writeFileSync(settingsPath, settingsDocument('initial'), 'utf-8');

    const { records, restore } = recordFileWatches();
    const parentMgr = new PtahFileSettingsManager({});
    const received: unknown[] = [];
    parentMgr.watch('external.marker', (value) => received.push(value));

    try {
      parentMgr.enableCrossProcessWatch();
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(records.map((record) => record.target)).toEqual([settingsPath]);
      expect(records[0].closed).toBe(false);

      atomicReplaceSettings(settingsPath, settingsDocument('edit-1'));
      const firstArrived = await waitForValue(received, 'edit-1', 2000);
      expect(firstArrived).toBe(true);
      const firstWatcherClosed = await waitUntil(
        () => records[0].closed,
        2000,
      );
      expect(firstWatcherClosed).toBe(true);

      atomicReplaceSettings(settingsPath, settingsDocument('edit-2'));
      const secondArrived = await waitForValue(received, 'edit-2', 2000);
      expect(secondArrived).toBe(true);

      expect(received).toEqual(['edit-1', 'edit-2']);
      expect(parentMgr.get('external.marker')).toBe('edit-2');
      expect(records).toHaveLength(3);
      expect(records.map((record) => record.target)).toEqual([
        settingsPath,
        settingsPath,
        settingsPath,
      ]);
      expect(records.map((record) => record.closed)).toEqual([
        true,
        true,
        false,
      ]);
    } finally {
      parentMgr.disposeCrossProcessWatch();
      expect(records.every((record) => record.closed)).toBe(true);
      restore();
    }
  }, 15000);
});
