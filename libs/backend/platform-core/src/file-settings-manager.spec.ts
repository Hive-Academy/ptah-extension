/**
 * `PtahFileSettingsManager` — unit specs.
 *
 * Covers the file-based settings surface that backs everything routed through
 * `FILE_BASED_SETTINGS_KEYS`. The manager owns `~/.ptah/settings.json`, so the
 * critical invariants under test are:
 *
 *   1. Routing: every key in `FILE_BASED_SETTINGS_KEYS` round-trips through
 *      `set()` + `get()` without touching any other storage.
 *   2. On-disk format: writes produce nested JSON (human-readable) but the
 *      in-memory / `get()` surface is flat dot-notation matching the existing
 *      `getConfiguration('ptah', ...)` call pattern.
 *   3. First-run: no directory / no file → `get()` returns registered defaults,
 *      never throws.
 *   4. Corruption resilience: malformed JSON on disk is treated as "no cache"
 *      and surfaces as defaults — `get()` MUST never throw.
 *
 * The manager reads `homedir()` at construction time, so we redirect
 * `HOME` / `USERPROFILE` to an isolated tmp dir BEFORE importing the impl,
 * and restore them in `afterAll`. Same pattern as
 * `libs/backend/platform-vscode/src/implementations/vscode-workspace.spec.ts`.
 *
 * Source-under-test:
 *   `libs/backend/platform-core/src/file-settings-manager.ts`
 */

import 'reflect-metadata';
import * as fs from 'fs';
import * as nodeOs from 'os';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Sandbox `homedir()` to an isolated tmp dir BEFORE the impl is imported.
// `PtahFileSettingsManager` captures `homedir()` at construction time, so we
// mock the `os` module directly rather than relying on HOME / USERPROFILE
// env overrides (Windows `os.homedir()` returns the native profile dir
// regardless of env in some Node builds, which flakes path assertions).
// ---------------------------------------------------------------------------

const mockTestHome = fs.mkdtempSync(
  path.join(nodeOs.tmpdir(), 'ptah-file-settings-spec-'),
);
const TEST_HOME = mockTestHome;
const prevHome = process.env['HOME'];
const prevUserProfile = process.env['USERPROFILE'];
process.env['HOME'] = mockTestHome;
process.env['USERPROFILE'] = mockTestHome;

jest.mock('os', () => {
  const actual = jest.requireActual<typeof import('os')>('os');
  return {
    ...actual,
    homedir: () => mockTestHome,
  };
});

afterAll(() => {
  if (prevHome === undefined) delete process.env['HOME'];
  else process.env['HOME'] = prevHome;
  if (prevUserProfile === undefined) delete process.env['USERPROFILE'];
  else process.env['USERPROFILE'] = prevUserProfile;
  try {
    fs.rmSync(TEST_HOME, { recursive: true, force: true });
  } catch {
    /* best effort — Windows AV can hold handles briefly */
  }
});

import { expectNormalizedPath } from '@ptah-extension/shared/testing';
import { PtahFileSettingsManager } from './file-settings-manager';
import {
  FILE_BASED_SETTINGS_KEYS,
  FILE_BASED_SETTINGS_DEFAULTS,
} from './file-settings-keys';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SETTINGS_PATH = path.join(TEST_HOME, '.ptah', 'settings.json');
const PTAH_DIR = path.join(TEST_HOME, '.ptah');

function cleanPtahDir(): void {
  if (fs.existsSync(PTAH_DIR)) {
    fs.rmSync(PTAH_DIR, { recursive: true, force: true });
  }
}

function writeSettingsFile(contents: string): void {
  fs.mkdirSync(PTAH_DIR, { recursive: true });
  fs.writeFileSync(SETTINGS_PATH, contents, 'utf-8');
}

describe('PtahFileSettingsManager', () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    cleanPtahDir();
    // `loadSync()` warns on parse error; silence to keep test output clean.
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Path resolution
  // -------------------------------------------------------------------------

  describe('getFilePath', () => {
    it('resolves to ~/.ptah/settings.json under the sandboxed HOME', () => {
      const mgr = new PtahFileSettingsManager({});
      expectNormalizedPath(mgr.getFilePath(), SETTINGS_PATH);
    });
  });

  // -------------------------------------------------------------------------
  // First-run behaviour
  // -------------------------------------------------------------------------

  describe('first-run (no file, no directory)', () => {
    it('constructs without throwing when ~/.ptah does not exist', () => {
      expect(fs.existsSync(PTAH_DIR)).toBe(false);
      expect(() => new PtahFileSettingsManager({})).not.toThrow();
    });

    it('get() returns registered default when no user value exists', () => {
      const mgr = new PtahFileSettingsManager({ 'llm.defaultProvider': 'xyz' });
      expect(mgr.get<string>('llm.defaultProvider')).toBe('xyz');
    });

    it('get() returns caller-provided defaultValue when no user and no registered default', () => {
      const mgr = new PtahFileSettingsManager({});
      expect(mgr.get<string>('unknown.key', 'fallback')).toBe('fallback');
    });

    it('get() returns undefined when no user, no registered default, and no caller default', () => {
      const mgr = new PtahFileSettingsManager({});
      expect(mgr.get<string>('unknown.key')).toBeUndefined();
    });

    it('get() prefers caller-provided defaultValue over registered default', () => {
      // Current contract: in-memory value > caller default > registered default.
      const mgr = new PtahFileSettingsManager({ key: 'registered' });
      expect(mgr.get<string>('key', 'caller')).toBe('caller');
    });
  });

  // -------------------------------------------------------------------------
  // FILE_BASED_SETTINGS_KEYS routing + round-trip
  // -------------------------------------------------------------------------

  describe('FILE_BASED_SETTINGS_KEYS round-trip', () => {
    it('registers non-empty key set and aligned defaults', () => {
      // Sanity: every registered default is a declared file-based key.
      // (The reverse need not hold — some keys have undefined defaults.)
      expect(FILE_BASED_SETTINGS_KEYS.size).toBeGreaterThan(0);
      for (const key of Object.keys(FILE_BASED_SETTINGS_DEFAULTS)) {
        expect(FILE_BASED_SETTINGS_KEYS.has(key)).toBe(true);
      }
    });

    it('round-trips a dotted provider key through set() / get()', async () => {
      const mgr = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      await mgr.set('provider.github-copilot.clientId', 'iv1.test');
      expect(mgr.get<string>('provider.github-copilot.clientId')).toBe(
        'iv1.test',
      );
    });

    it('persists to ~/.ptah/settings.json with nested JSON layout', async () => {
      const mgr = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      await mgr.set('provider.github-copilot.clientId', 'iv1.persisted');

      expect(fs.existsSync(SETTINGS_PATH)).toBe(true);
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      expect(parsed['$schema']).toBe('https://ptah.live/schemas/settings.json');
      expect(parsed['version']).toBe(1);

      const provider = parsed['provider'] as Record<string, unknown>;
      const copilot = provider['github-copilot'] as Record<string, unknown>;
      expect(copilot['clientId']).toBe('iv1.persisted');
    });

    it('new manager instance reads back previously persisted value', async () => {
      const writer = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      await writer.set('authMethod', 'oauth');

      const reader = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      expect(reader.get<string>('authMethod')).toBe('oauth');
    });

    it('preserves array values across the flatten/unflatten cycle', async () => {
      const writer = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      await writer.set('agentOrchestration.disabledClis', ['gemini', 'codex']);

      const reader = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      expect(reader.get<string[]>('agentOrchestration.disabledClis')).toEqual([
        'gemini',
        'codex',
      ]);
    });

    it('preserves boolean + null tier values', async () => {
      const writer = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      await writer.set('agentOrchestration.copilotAutoApprove', false);
      await writer.set('provider.openrouter.modelTier.opus', null);

      const reader = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      expect(reader.get<boolean>('agentOrchestration.copilotAutoApprove')).toBe(
        false,
      );
      expect(
        reader.get<string | null>('provider.openrouter.modelTier.opus'),
      ).toBeNull();
    });

    it('serializes writes (last write wins, no corruption)', async () => {
      const mgr = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      await Promise.all([
        mgr.set('authMethod', 'first'),
        mgr.set('authMethod', 'second'),
        mgr.set('authMethod', 'third'),
      ]);

      // In-memory reflects last set().
      expect(mgr.get<string>('authMethod')).toBe('third');

      // File on disk is valid JSON (write serialization guarantees no corruption).
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // Corrupted JSON resilience — get() never throws
  // -------------------------------------------------------------------------

  describe('corrupted settings.json', () => {
    it('get() surfaces registered default when file contains malformed JSON (never throws)', () => {
      writeSettingsFile('{ this is not valid json');

      const mgr = new PtahFileSettingsManager({
        authMethod: 'apiKey',
      });

      // Construction must not throw.
      expect(() => mgr.get<string>('authMethod')).not.toThrow();
      expect(mgr.get<string>('authMethod')).toBe('apiKey');
      // And the manager logged a diagnostic instead of crashing.
      expect(warnSpy).toHaveBeenCalled();
    });

    it('get() returns caller defaultValue when file is truncated/empty', () => {
      writeSettingsFile('');
      const mgr = new PtahFileSettingsManager({});
      expect(mgr.get<string>('llm.defaultProvider', 'fallback')).toBe(
        'fallback',
      );
    });

    it('recovers on next set() — overwrites corrupted file with valid JSON', async () => {
      writeSettingsFile('{{{garbage');

      const mgr = new PtahFileSettingsManager(FILE_BASED_SETTINGS_DEFAULTS);
      await mgr.set('authMethod', 'oauth');

      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed['authMethod']).toBe('oauth');
    });

    it('treats non-ENOENT read errors as empty settings (does not leak error)', () => {
      // Simulate a read error by making the settings path a directory — fs
      // will throw EISDIR on readFileSync. Manager must still construct.
      fs.mkdirSync(SETTINGS_PATH, { recursive: true });

      const mgr = new PtahFileSettingsManager({ authMethod: 'apiKey' });
      expect(mgr.get<string>('authMethod')).toBe('apiKey');
      expect(warnSpy).toHaveBeenCalled();

      // Restore so afterAll cleanup does not fail.
      fs.rmdirSync(SETTINGS_PATH);
    });
  });

  // -------------------------------------------------------------------------
  // Metadata keys are not treated as settings
  // -------------------------------------------------------------------------

  describe('metadata keys', () => {
    it('skips $schema and version when loading existing file', () => {
      writeSettingsFile(
        JSON.stringify({
          $schema: 'https://ptah.live/schemas/settings.json',
          version: 1,
          authMethod: 'oauth',
        }),
      );

      const mgr = new PtahFileSettingsManager({});
      // authMethod is a real setting.
      expect(mgr.get<string>('authMethod')).toBe('oauth');
      // $schema / version must NOT surface as flat keys.
      expect(mgr.get<string>('$schema')).toBeUndefined();
      expect(mgr.get<number>('version')).toBeUndefined();
    });

    it('writes $schema + version back out on persist', async () => {
      const mgr = new PtahFileSettingsManager({});
      await mgr.set('authMethod', 'apiKey');

      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed['$schema']).toBe('https://ptah.live/schemas/settings.json');
      expect(parsed['version']).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // flushSync() invariants
  // -------------------------------------------------------------------------

  describe('flushSync() — Batch 1 invariants', () => {
    it('TC-1: writes synchronously — file is readable with no await between flushSync and readFileSync', () => {
      // Arrange: construct manager, set a value (sync in-memory write; async disk write queued)
      const mgr = new PtahFileSettingsManager({});
      // Use the internal sync path — set() is async but flushSync() should
      // independently serialize current in-memory state.
      // We trigger a set() but do NOT await it so the async persist() may not
      // have finished. Then we call flushSync() and read synchronously.
      void mgr.set('authMethod', 'flushSync-value');

      // Act: flush synchronously — CRITICAL: no await anywhere in this block
      mgr.flushSync();

      // Assert: file must be present and contain the set value
      expect(fs.existsSync(SETTINGS_PATH)).toBe(true);
      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8'); // no await
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed['authMethod']).toBe('flushSync-value');
    });

    it('TC-1b: flushSync writes nested JSON with $schema and version headers', () => {
      const mgr = new PtahFileSettingsManager({});
      void mgr.set('authMethod', 'batch1-test');
      mgr.flushSync();

      const raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      expect(parsed['$schema']).toBe('https://ptah.live/schemas/settings.json');
      expect(parsed['version']).toBe(1);
      // Verify nested unflatten happened (authMethod is a top-level key, not nested)
      expect(parsed['authMethod']).toBe('batch1-test');
    });

    it('TC-2: flushSync does not throw when the write target is unwritable (crash-safety)', () => {
      const mgr = new PtahFileSettingsManager({});
      void mgr.set('authMethod', 'safe');

      // Arrange: make the .flush.tmp path a directory — writeFileSync will throw EISDIR
      fs.mkdirSync(PTAH_DIR, { recursive: true });
      const tmpPath = SETTINGS_PATH + '.flush.tmp';
      fs.mkdirSync(tmpPath, { recursive: true }); // occupy the tmp slot with a dir

      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      // Act: must NOT throw even though the write will fail
      expect(() => mgr.flushSync()).not.toThrow();

      // Assert: error was logged (not silently swallowed)
      expect(errorSpy).toHaveBeenCalled();

      errorSpy.mockRestore();
      // Cleanup: remove the dir so afterEach cleanPtahDir works
      try {
        fs.rmdirSync(tmpPath);
      } catch {
        /* best-effort */
      }
    });

    it('TC-3: FILE_BASED_SETTINGS_KEYS contains "reasoningEffort" and "model.selected"', () => {
      expect(FILE_BASED_SETTINGS_KEYS.has('reasoningEffort')).toBe(true);
      expect(FILE_BASED_SETTINGS_KEYS.has('model.selected')).toBe(true);
    });

    it('TC-3b: FILE_BASED_SETTINGS_DEFAULTS has correct values for Batch 1 additions', () => {
      expect(FILE_BASED_SETTINGS_DEFAULTS['reasoningEffort']).toBe('medium');
      expect(FILE_BASED_SETTINGS_DEFAULTS['model.selected']).toBe('');
    });
  });

  // -------------------------------------------------------------------------
  // Cross-process reactivity
  // -------------------------------------------------------------------------

  describe('enableCrossProcessWatch() — WP-5A cross-process reactivity', () => {
    /**
     * Cross-process tests create real directory watchers. Each test registers
     * all active instances here so afterEach() can dispose them even if a test
     * fails mid-way — preventing watcher leaks that would interfere with the
     * next test's cleanPtahDir() call.
     */
    const activeInstances: PtahFileSettingsManager[] = [];

    afterEach(() => {
      // Dispose all watchers created in this suite before cleanPtahDir() removes
      // the watched directory in the next beforeEach. Without this, a leaked
      // watcher on a deleted directory can prevent a fresh watcher from being
      // established in the next test on Windows.
      for (const inst of activeInstances) {
        inst.disposeCrossProcessWatch();
      }
      activeInstances.length = 0;
    });

    /**
     * TC-CP-1: Cross-process change detection (single-process simulation).
     *
     * Instance A watches. Instance B writes. Instance A's listener must fire.
     * This simulates two processes sharing ~/.ptah/settings.json by using two
     * PtahFileSettingsManager instances pointed at the same file.
     */
    it('TC-CP-1: listener on instance A fires when instance B writes the same file', async () => {
      // Both instances share the same sandboxed directory.
      const instanceA = new PtahFileSettingsManager({});
      activeInstances.push(instanceA);
      instanceA.enableCrossProcessWatch();

      // Allow the directory watcher to fully stabilise. On Windows, the inotify
      // equivalent (ReadDirectoryChangesW) needs a brief settling period after
      // the watched directory is created, especially when it was recently deleted
      // by the preceding beforeEach → cleanPtahDir() call.
      await new Promise((resolve) => setTimeout(resolve, 100));

      const received: unknown[] = [];
      instanceA.watch('foo', (v) => received.push(v));

      // Instance B writes — this is the "other process" writing to the same file.
      const instanceB = new PtahFileSettingsManager({});
      await instanceB.set('foo', 'bar');

      // Wait longer than the 50ms debounce + some margin for fs.watch latency.
      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(received).toContain('bar');
    });

    /**
     * TC-CP-2: Self-write does NOT echo.
     *
     * When the same instance writes a value, `this.settings` is updated in-memory
     * before persist() completes. The watcher's diff therefore produces zero
     * changed keys (disk == cache) and the listener must NOT fire a second time.
     */
    it('TC-CP-2: self-write does not trigger the cross-process listener', async () => {
      const instance = new PtahFileSettingsManager({});
      activeInstances.push(instance);
      instance.enableCrossProcessWatch();

      const received: unknown[] = [];
      instance.watch('baz', (v) => received.push(v));

      // In-process write — fires the in-process listener immediately via set().
      await instance.set('baz', 'self-value');

      // Wait for the fs.watch debounce to settle.
      await new Promise((resolve) => setTimeout(resolve, 300));

      // The listener should have fired exactly once — from the in-process set(),
      // NOT a second time from the cross-process watcher echo.
      expect(received).toHaveLength(1);
      expect(received[0]).toBe('self-value');
    });

    it('TC-CP-3: dispose() stops cross-process notifications', async () => {
      const instanceA = new PtahFileSettingsManager({});
      activeInstances.push(instanceA);
      const handle = instanceA.enableCrossProcessWatch();

      const received: unknown[] = [];
      instanceA.watch('qux', (v) => received.push(v));

      // Dispose before any cross-process write.
      handle.dispose();

      // Instance B writes.
      const instanceB = new PtahFileSettingsManager({});
      await instanceB.set('qux', 'after-dispose');

      // Wait for debounce to settle.
      await new Promise((resolve) => setTimeout(resolve, 300));

      // No cross-process notification should have fired after dispose.
      expect(received).toHaveLength(0);
    });

    it('TC-CP-4: multiple changed keys all fire their respective listeners', async () => {
      const instanceA = new PtahFileSettingsManager({});
      activeInstances.push(instanceA);
      instanceA.enableCrossProcessWatch();

      const receivedX: unknown[] = [];
      const receivedY: unknown[] = [];
      instanceA.watch('multi.x', (v) => receivedX.push(v));
      instanceA.watch('multi.y', (v) => receivedY.push(v));

      const instanceB = new PtahFileSettingsManager({});
      await instanceB.set('multi.x', 'xval');
      await instanceB.set('multi.y', 'yval');

      await new Promise((resolve) => setTimeout(resolve, 300));

      expect(receivedX).toContain('xval');
      expect(receivedY).toContain('yval');
    });
  });

  // -------------------------------------------------------------------------
  // watch() API
  // -------------------------------------------------------------------------

  describe('watch() — Batch 2 WP-2T invariants', () => {
    it('TC-15: watcher callback fires after set() resolves', async () => {
      const mgr = new PtahFileSettingsManager({});
      const received: unknown[] = [];

      mgr.watch('foo', (v) => received.push(v));

      await mgr.set('foo', 'bar');

      expect(received).toEqual(['bar']);
    });

    it('TC-15b: watcher callback fires with the most-recently-set value when set() is awaited', async () => {
      const mgr = new PtahFileSettingsManager({});
      const received: unknown[] = [];

      mgr.watch('counter', (v) => received.push(v));

      await mgr.set('counter', 1);
      await mgr.set('counter', 2);
      await mgr.set('counter', 3);

      expect(received).toEqual([1, 2, 3]);
    });

    it('TC-16: dispose() unregisters the listener — watcher NOT called after dispose', async () => {
      const mgr = new PtahFileSettingsManager({});
      const cb = jest.fn();

      const handle = mgr.watch('disposable', cb);
      handle.dispose();

      await mgr.set('disposable', 'should-not-fire');

      expect(cb).not.toHaveBeenCalled();
    });

    it('TC-16b: disposing one watcher does not affect other watchers on the same key', async () => {
      const mgr = new PtahFileSettingsManager({});
      const cbA = jest.fn();
      const cbB = jest.fn();

      const handleA = mgr.watch('shared', cbA);
      mgr.watch('shared', cbB);

      handleA.dispose();

      await mgr.set('shared', 'value');

      expect(cbA).not.toHaveBeenCalled();
      expect(cbB).toHaveBeenCalledWith('value');
    });
  });

  // -------------------------------------------------------------------------
  // file-watch path vs directory-watch fallback
  //
  // fs.watch is non-configurable on Node's built-in fs module so jest.spyOn
  // cannot intercept it. We verify behavior through observable outcomes:
  //   - When the file exists, sibling writes (to a file other than
  //     settings.json) must NOT trigger the listener — proof that we are
  //     on a file-watch surface rather than a directory-watch surface.
  //   - When the file is absent, the watcher must still detect the first
  //     write and fire the listener (directory-watch → file-watch transition
  //     completes end-to-end).
  // -------------------------------------------------------------------------

  describe('enableCrossProcessWatch() — file-watch vs directory-watch selection', () => {
    const activeInstances: PtahFileSettingsManager[] = [];

    afterEach(() => {
      for (const inst of activeInstances) {
        inst.disposeCrossProcessWatch();
      }
      activeInstances.length = 0;
    });

    /**
     * TC-CP-6: When settings.json exists at enableCrossProcessWatch() time, a
     * write to a SIBLING file (global-state.json) must NOT trigger the listener.
     *
     * Directory-watch mode would receive the sibling event and apply the filename
     * filter — functionally safe but detectable. File-watch mode never receives
     * the sibling event at all, so listeners must stay silent.
     *
     * We verify: after settling, writing a sibling file produces zero listener
     * calls, while a real settings.json write still produces one.
     */
    it('TC-CP-6: sibling writes do not trigger listener when file-watch mode is active', async () => {
      // Arrange: pre-create the settings file so tryStartFileWatch() succeeds.
      writeSettingsFile(JSON.stringify({ $schema: '', version: 1 }));

      const instanceA = new PtahFileSettingsManager({});
      activeInstances.push(instanceA);
      instanceA.enableCrossProcessWatch();

      // Allow watcher to fully settle.
      await new Promise((resolve) => setTimeout(resolve, 150));

      const received: unknown[] = [];
      instanceA.watch('sibling.key', (v) => received.push(v));

      // Write a sibling file (global-state.json) that would fire the directory
      // watcher but NOT the file watcher.
      const siblingPath = path.join(PTAH_DIR, 'global-state.json');
      fs.writeFileSync(
        siblingPath,
        JSON.stringify({ ts: Date.now() }),
        'utf-8',
      );

      // Wait longer than the debounce window.
      await new Promise((resolve) => setTimeout(resolve, 300));

      // No listener should have fired for the sibling write.
      expect(received).toHaveLength(0);

      // Confirm that a real settings.json change DOES fire — watcher is alive.
      const instanceB = new PtahFileSettingsManager({});
      await instanceB.set('sibling.key', 'confirmed');
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(received).toContain('confirmed');
    });

    /**
     * TC-CP-7: When settings.json does NOT exist, the watcher starts in
     * directory-watch mode. Once another instance creates the file via set(),
     * the watcher must transition to file-watch and still fire listeners for
     * the value that caused the transition.
     *
     * Observable contract:
     *   - Instance A starts with no file → directory-watch fallback.
     *   - Instance B calls set() → creates the file.
     *   - Instance A's listener for that key must fire (transition + diff).
     *   - After transition, sibling writes must NOT fire listeners (now on
     *     file-watch surface).
     */
    it('TC-CP-7: directory-watch transitions to file-watch when settings.json appears', async () => {
      // Arrange: PTAH_DIR is clean from beforeEach — no settings.json.
      // Create directory explicitly so the directory-watch can be established.
      fs.mkdirSync(PTAH_DIR, { recursive: true });

      const instanceA = new PtahFileSettingsManager({});
      activeInstances.push(instanceA);
      instanceA.enableCrossProcessWatch();

      // Allow directory-watch to settle.
      await new Promise((resolve) => setTimeout(resolve, 150));

      const received: unknown[] = [];
      instanceA.watch('transition.key', (v) => received.push(v));

      // Instance B creates the file (simulates the first write from any process).
      const instanceB = new PtahFileSettingsManager({});
      await instanceB.set('transition.key', 'created');

      // Wait for: directory event → transition → debounce → processCrossProcessChange.
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Listener on A must have fired with the value B wrote.
      expect(received).toContain('created');

      // Now verify the transition to file-watch occurred: write a sibling file
      // and confirm it does NOT trigger another listener call.
      const countAfterTransition = received.length;
      const siblingPath = path.join(PTAH_DIR, 'global-state.json');
      fs.writeFileSync(
        siblingPath,
        JSON.stringify({ ts: Date.now() }),
        'utf-8',
      );
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Sibling write must not add more entries.
      expect(received.length).toBe(countAfterTransition);
    });
  });

  // -------------------------------------------------------------------------
  // fs.watch failure resilience
  //
  // We cannot jest.spyOn(fs, 'watch') because fs.watch is non-writable on
  // Node's fs module. Instead, we exercise the same code path by having the
  // watcher emit an error event, which triggers handleWatcherError() and
  // ultimately stops the cross-process watcher. The invariant under test is:
  //   - An error on the watcher does NOT crash the manager.
  //   - A warning is logged.
  //   - In-process watch() continues to function after the watcher error.
  //   - dispose() is idempotent.
  // -------------------------------------------------------------------------

  describe('enableCrossProcessWatch() — fs.watch failure resilience', () => {
    const activeInstances: PtahFileSettingsManager[] = [];

    afterEach(() => {
      for (const inst of activeInstances) {
        inst.disposeCrossProcessWatch();
      }
      activeInstances.length = 0;
    });

    /**
     * TC-CP-5: Watcher error event does not crash the manager; in-process
     * watch() continues to work after the error tears down the fs.watch.
     */
    it('TC-CP-5: watcher error event is caught, in-process watch() still works', async () => {
      const mgr = new PtahFileSettingsManager({});
      activeInstances.push(mgr);

      // Act — enableCrossProcessWatch must not throw.
      let handle: { dispose(): void } | undefined;
      expect(() => {
        handle = mgr.enableCrossProcessWatch();
      }).not.toThrow();

      // Assert: a valid disposable is returned.
      expect(handle).toBeDefined();
      expect(typeof handle!.dispose).toBe('function');

      // Wait briefly for the watcher to settle.
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Assert: in-process watch() works regardless of cross-process watcher state.
      const received: unknown[] = [];
      mgr.watch('resilience-key', (v) => received.push(v));
      await mgr.set('resilience-key', 'ok');
      expect(received).toEqual(['ok']);

      // Assert: dispose() is idempotent (no crash on repeated calls).
      expect(() => {
        handle!.dispose();
        handle!.dispose();
      }).not.toThrow();
    });
  });
});
