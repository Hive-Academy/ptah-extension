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
  // Batch 1 targeted invariants — WP-1T validation
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
});
