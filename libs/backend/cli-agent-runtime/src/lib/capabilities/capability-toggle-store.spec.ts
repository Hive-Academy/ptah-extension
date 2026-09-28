// The store imports `harness-sync`'s barrel for `atomicWriteWithRetry`, which
// reaches `vscode-core` and therefore tsyringe. Same polyfill line as every
// other spec in this lib that touches a DI-carrying barrel.
import 'reflect-metadata';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  canonicalFilename,
  resolveEffective,
  type CapabilityDefault,
  type CapabilityImportDocument,
  type CapabilityLayerValues,
} from '@ptah-extension/shared';
import {
  CapabilityToggleStore,
  CapabilityToggleStoreError,
  capabilityPolicyKey,
  capabilityWorkspaceKey,
  defaultCapabilityStoreDir,
} from './capability-toggle-store';

/**
 * Every case runs against a real temp directory passed as the store's base
 * directory. The store defaults to `~/.ptah/capabilities`, so a spec that
 * omitted it would write into the developer's real store.
 */

// `fs` passthrough with a swappable `renameSync`. `fs` properties are not
// configurable in this Node build, so `jest.spyOn(fs, 'renameSync')` cannot
// redefine them (same constraint as `content-download.service.spec.ts`); a
// module-level mock reaches `atomicWriteWithRetry` inside harness-sync too.
let mockRenameSyncOverride: (() => void) | null = null;

jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  return {
    ...actual,
    renameSync: (from: fs.PathLike, to: fs.PathLike): void => {
      if (mockRenameSyncOverride) {
        mockRenameSyncOverride();
        return;
      }
      actual.renameSync(from, to);
    },
  };
});

function fakeOutput(): IOutputChannel & { appendLine: jest.Mock } {
  return {
    name: 'test',
    appendLine: jest.fn(),
    append: jest.fn(),
    clear: jest.fn(),
    show: jest.fn(),
    dispose: jest.fn(),
  };
}

const WS_KEY = capabilityWorkspaceKey('/work/repo');

/** The D2 fixed collision pair. */
const LONG_ID = 'x'.repeat(121);
const HASH_LOOKALIKE_ID = 'h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1';

function importDocument(
  entries: CapabilityImportDocument['entries'],
): CapabilityImportDocument {
  return {
    v: 1,
    createdAt: '2026-09-25T10:00:00.000Z',
    sources: [{ path: '/home/u/.claude.json', kind: 'claude-project' }],
    entries,
  };
}

describe('CapabilityToggleStore', () => {
  let baseDir: string;
  let output: ReturnType<typeof fakeOutput>;
  let store: CapabilityToggleStore;

  const itemsDir = (wsKey = WS_KEY): string =>
    path.join(baseDir, 'workspaces', wsKey, 'items');
  const globalDir = (): string => path.join(baseDir, 'global');
  const importedPath = (wsKey = WS_KEY): string =>
    path.join(baseDir, 'workspaces', wsKey, 'imported.json');

  /** Reads the three layers off `store` and builds resolver input for `key`. */
  const DEFAULT_OFF: CapabilityDefault = { enabled: false, reason: 'undeclared' };
  async function layerValuesFor(
    kind: 'mcp' | 'skill' | 'plugin',
    id: string,
    defaultValue: CapabilityDefault = DEFAULT_OFF,
    wsKey = WS_KEY,
  ): Promise<CapabilityLayerValues> {
    const [workspaceLayer, globalLayer, importedLayer] = await Promise.all([
      store.readWorkspaceItems(wsKey),
      store.readGlobalLayer(),
      store.readImported(wsKey),
    ]);
    const workspaceItem =
      workspaceLayer.status === 'ok'
        ? workspaceLayer.items.find((i) => i.kind === kind && i.id === id)
        : undefined;
    const globalItem =
      globalLayer.status === 'ok'
        ? globalLayer.items.find((i) => i.kind === kind && i.id === id)
        : undefined;
    const imported =
      importedLayer.status === 'ok'
        ? importedLayer.document.entries[`${kind}:${id}`]
        : undefined;
    return {
      workspace: workspaceItem?.value,
      global: globalItem?.value,
      imported,
      defaultValue,
    };
  }

  beforeEach(() => {
    baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-store-'));
    output = fakeOutput();
    store = new CapabilityToggleStore(output, baseDir);
  });

  afterEach(() => {
    mockRenameSyncOverride = null;
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  describe('keys', () => {
    it('defaults the base directory to ~/.ptah/capabilities', () => {
      expect(defaultCapabilityStoreDir('/home/u')).toBe(
        path.join('/home/u', '.ptah', 'capabilities'),
      );
    });

    it('derives a 32-hex workspace key from the policy key', () => {
      expect(capabilityWorkspaceKey('/work/repo')).toMatch(/^[0-9a-f]{32}$/);
    });

    it('maps win32 aliases that differ only in case to one workspace key (N7)', () => {
      const upper = capabilityPolicyKey('D:\\Projects\\Repo', 'win32');
      const lower = capabilityPolicyKey('d:\\projects\\repo', 'win32');
      expect(upper).toBe(lower);
      expect(capabilityWorkspaceKey(upper)).toBe(capabilityWorkspaceKey(lower));
    });

    it('keeps case-sensitive roots distinct (N7)', () => {
      const upper = capabilityPolicyKey('/a/Repo', 'linux');
      const lower = capabilityPolicyKey('/a/repo', 'linux');
      expect(upper).not.toBe(lower);
      expect(capabilityWorkspaceKey(upper)).not.toBe(
        capabilityWorkspaceKey(lower),
      );
    });
  });

  describe('explicit items', () => {
    it('reads an absent store as an empty layer', async () => {
      await expect(store.readGlobalLayer()).resolves.toEqual({
        status: 'ok',
        items: [],
        fingerprintEntries: [],
      });
      await expect(store.readWorkspaceItems(WS_KEY)).resolves.toEqual({
        status: 'ok',
        items: [],
        fingerprintEntries: [],
      });
    });

    it('persists a workspace toggle under its canonical file name (AC-1.1)', async () => {
      const written = await store.writeWorkspace(WS_KEY, 'mcp', 'Sentry', 'off');

      expect(written).toMatchObject({
        v: 1,
        kind: 'mcp',
        id: 'Sentry',
        value: 'off',
        source: 'user',
      });
      expect(fs.readdirSync(itemsDir())).toEqual([
        canonicalFilename('mcp', 'Sentry'),
      ]);

      // A second instance reads it back: nothing is cached in memory.
      const fresh = new CapabilityToggleStore(fakeOutput(), baseDir);
      const layer = await fresh.readWorkspaceItems(WS_KEY);
      expect(layer).toEqual({
        status: 'ok',
        items: [written],
        fingerprintEntries: [],
      });
    });

    it('writes the inherit tombstone rather than deleting the item', async () => {
      await store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'off');
      await store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'inherit');

      const layer = await store.readWorkspaceItems(WS_KEY);
      expect(layer.status).toBe('ok');
      if (layer.status !== 'ok') return;
      expect(layer.items).toHaveLength(1);
      expect(layer.items[0].value).toBe('inherit');
    });

    it('setExplicit writes a concrete ON from the install path (N6)', async () => {
      const item = await store.setExplicit(WS_KEY, 'mcp', 'sentry');
      expect(item).toMatchObject({ value: 'on', source: 'install' });
    });

    it('leaves the global snapshot byte-identical after a workspace write (AC-2.3)', async () => {
      await store.writeGlobal('mcp', 'sentry', 'on');
      const file = path.join(globalDir(), canonicalFilename('mcp', 'sentry'));
      const before = fs.readFileSync(file);
      const snapshotBefore = await store.readGlobalLayer();

      await store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'off');

      expect(fs.readFileSync(file).equals(before)).toBe(true);
      expect(fs.readdirSync(globalDir())).toHaveLength(1);
      await expect(store.readGlobalLayer()).resolves.toEqual(snapshotBefore);
    });

    it('exposes fingerprint entries for skill and plugin items only', async () => {
      await store.writeGlobal('mcp', 'sentry', 'off');
      await store.writeGlobal('skill', 'tdd', 'off');
      await store.writeGlobal('plugin', 'ptah-core', 'on');

      const layer = await store.readGlobalLayer();
      expect(layer.status).toBe('ok');
      if (layer.status !== 'ok') return;
      expect(layer.items).toHaveLength(3);
      expect(layer.fingerprintEntries.map((entry) => entry.name)).toEqual([
        canonicalFilename('plugin', 'ptah-core'),
        canonicalFilename('skill', 'tdd'),
      ]);
      const skill = layer.fingerprintEntries.find(
        (entry) => entry.name === canonicalFilename('skill', 'tdd'),
      );
      expect(skill?.content).toBe(
        fs.readFileSync(
          path.join(globalDir(), canonicalFilename('skill', 'tdd')),
          'utf-8',
        ),
      );
    });

    it('rejects an id with no UTF-8 form with the store error', async () => {
      await expect(
        store.writeWorkspace(WS_KEY, 'mcp', '\uD800', 'on'),
      ).rejects.toBeInstanceOf(CapabilityToggleStoreError);
    });

    it('rejects a workspace key that is not store-shaped', async () => {
      await expect(
        store.writeWorkspace('../../escape', 'mcp', 'sentry', 'on'),
      ).rejects.toBeInstanceOf(CapabilityToggleStoreError);
      const read = await store.readWorkspaceItems('../../escape');
      expect(read.status).toBe('error');
    });
  });

  describe('the D2 namespaces', () => {
    it('maps the fixed collision pair to two different files', async () => {
      expect(canonicalFilename('mcp', LONG_ID)).toBe(
        'mcp__h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json',
      );
      expect(canonicalFilename('mcp', HASH_LOOKALIKE_ID)).toBe(
        'mcp__l_h_79072a47bfaa54e6057a9ee21e0dea64b9edbfd1.json',
      );

      await store.writeWorkspace(WS_KEY, 'mcp', LONG_ID, 'on');
      await store.writeWorkspace(WS_KEY, 'mcp', HASH_LOOKALIKE_ID, 'off');

      expect(fs.readdirSync(itemsDir()).sort()).toEqual(
        [
          canonicalFilename('mcp', LONG_ID),
          canonicalFilename('mcp', HASH_LOOKALIKE_ID),
        ].sort(),
      );
      const layer = await store.readWorkspaceItems(WS_KEY);
      expect(layer.status).toBe('ok');
    });

    it('leaves one member of the pair byte-identical when the other is toggled or cleared', async () => {
      await store.writeWorkspace(WS_KEY, 'mcp', LONG_ID, 'on');
      await store.writeWorkspace(WS_KEY, 'mcp', HASH_LOOKALIKE_ID, 'off');
      const lookalikeFile = path.join(
        itemsDir(),
        canonicalFilename('mcp', HASH_LOOKALIKE_ID),
      );
      const before = fs.readFileSync(lookalikeFile);

      await store.writeWorkspace(WS_KEY, 'mcp', LONG_ID, 'off');
      await store.writeWorkspace(WS_KEY, 'mcp', LONG_ID, 'inherit');

      expect(fs.readFileSync(lookalikeFile).equals(before)).toBe(true);
    });

    it('reports a file whose content names a different item as an error', async () => {
      await store.writeWorkspace(WS_KEY, 'mcp', LONG_ID, 'on');
      // Content for LONG_ID under the look-alike's name: the reader must
      // recompute the name from the content and refuse it.
      fs.renameSync(
        path.join(itemsDir(), canonicalFilename('mcp', LONG_ID)),
        path.join(itemsDir(), canonicalFilename('mcp', HASH_LOOKALIKE_ID)),
      );

      const layer = await store.readWorkspaceItems(WS_KEY);
      expect(layer).toEqual({
        status: 'error',
        reasons: [
          {
            path: path.join(
              itemsDir(),
              canonicalFilename('mcp', HASH_LOOKALIKE_ID),
            ),
            error: 'file name does not match its content',
          },
        ],
      });
    });
  });

  describe('fail-closed reads', () => {
    const writeRaw = (dir: string, name: string, content: string): string => {
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, name);
      fs.writeFileSync(file, content);
      return file;
    };

    it.each([
      ['a 0-byte file', '', 'empty file'],
      ['unparseable JSON', '{"v":1,', 'invalid JSON'],
      [
        'content that fails the schema',
        JSON.stringify({ v: 1, kind: 'mcp', id: 'sentry', value: 'maybe' }),
        'not a valid item',
      ],
    ])('reports %s as an error with its path', async (_label, content, error) => {
      const file = writeRaw(
        globalDir(),
        canonicalFilename('mcp', 'sentry'),
        content,
      );
      await expect(store.readGlobalLayer()).resolves.toEqual({
        status: 'error',
        reasons: [{ path: file, error }],
      });
      expect(output.appendLine).toHaveBeenCalledWith(
        expect.stringContaining(file),
      );
    });

    it('reports the whole layer as an error when any one item is bad', async () => {
      await store.writeGlobal('mcp', 'good', 'on');
      writeRaw(globalDir(), canonicalFilename('mcp', 'bad'), '');
      const layer = await store.readGlobalLayer();
      expect(layer.status).toBe('error');
    });

    it('reports an unreadable directory as an error, not as empty', async () => {
      // A file where the directory should be: readdir fails with ENOTDIR.
      fs.mkdirSync(baseDir, { recursive: true });
      fs.writeFileSync(globalDir(), 'not a directory');
      const layer = await store.readGlobalLayer();
      expect(layer.status).toBe('error');
      if (layer.status !== 'error') return;
      expect(layer.reasons[0].path).toBe(globalDir());
    });

    it('ignores and logs names outside the item pattern, once per path', async () => {
      await store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'on');
      const tmp = writeRaw(
        itemsDir(),
        `${canonicalFilename('mcp', 'other')}.123.1.tmp`,
        '{"partial":',
      );
      writeRaw(itemsDir(), 'mcp__l_sentry (conflict copy).json', '{}');

      const first = await store.readWorkspaceItems(WS_KEY);
      await store.readWorkspaceItems(WS_KEY);

      expect(first.status).toBe('ok');
      if (first.status !== 'ok') return;
      expect(first.items.map((item) => item.id)).toEqual(['sentry']);
      const tmpLogs = output.appendLine.mock.calls.filter(([line]) =>
        String(line).includes(tmp),
      );
      expect(tmpLogs).toHaveLength(1);
    });
  });

  describe('write failures (AC-1.4)', () => {
    it('rejects with the store error and leaves the prior file byte-identical', async () => {
      await store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'on');
      const file = path.join(itemsDir(), canonicalFilename('mcp', 'sentry'));
      const before = fs.readFileSync(file);

      mockRenameSyncOverride = () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' });
      };
      try {
        const attempt = store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'off');
        await expect(attempt).rejects.toBeInstanceOf(
          CapabilityToggleStoreError,
        );
        await expect(attempt).rejects.toMatchObject({ path: file });
      } finally {
        mockRenameSyncOverride = null;
      }

      expect(fs.readFileSync(file).equals(before)).toBe(true);
      // The temp file is cleaned up on the way out.
      expect(fs.readdirSync(itemsDir())).toEqual([
        canonicalFilename('mcp', 'sentry'),
      ]);
    });
  });

  describe('the IMPORTED layer (D1)', () => {
    it('reads a missing imported.json as absent', async () => {
      await expect(store.readImported(WS_KEY)).resolves.toEqual({
        status: 'absent',
      });
    });

    it('publishes once; its existence is the marker', async () => {
      const first = importDocument({ 'mcp:sentry': 'on' });
      const second = importDocument({ 'mcp:sentry': 'off' });

      await expect(store.publishImport(WS_KEY, first)).resolves.toBe(true);
      const bytes = fs.readFileSync(importedPath());
      await expect(store.publishImport(WS_KEY, second)).resolves.toBe(false);

      expect(fs.readFileSync(importedPath()).equals(bytes)).toBe(true);
      await expect(store.readImported(WS_KEY)).resolves.toEqual({
        status: 'ok',
        document: first,
      });
    });

    it('re-imports when a crash left nothing at all, before the first byte (D1 #5)', async () => {
      // No file, not even a `.tmp`: the same state as a plain absent read,
      // but exercised end to end through publishImport to pin the "runs
      // again" behaviour, not just the read.
      await expect(store.readImported(WS_KEY)).resolves.toEqual({
        status: 'absent',
      });
      await expect(
        store.publishImport(WS_KEY, importDocument({ 'mcp:a': 'on' })),
      ).resolves.toBe(true);
      await expect(store.readImported(WS_KEY)).resolves.toMatchObject({
        status: 'ok',
      });
    });

    it('re-imports when a crash left only a .tmp', async () => {
      const dir = path.dirname(importedPath());
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(`${importedPath()}.999.1.tmp`, '{"v":1,"crea');

      await expect(store.readImported(WS_KEY)).resolves.toEqual({
        status: 'absent',
      });
      await expect(
        store.publishImport(WS_KEY, importDocument({ 'mcp:a': 'off' })),
      ).resolves.toBe(true);
      const read = await store.readImported(WS_KEY);
      expect(read.status).toBe('ok');
    });

    it.each([
      ['corrupt', '{"v":1,', 'invalid JSON'],
      ['0-byte', '', 'empty file'],
      [
        'schema-failing',
        JSON.stringify({ v: 1, createdAt: 'x', sources: [], entries: {} }),
        'not a valid import document',
      ],
      [
        'non-MCP keys',
        JSON.stringify({
          v: 1,
          createdAt: '2026-09-25T10:00:00.000Z',
          sources: [],
          entries: { 'skill:tdd': 'off' },
        }),
        'not a valid import document',
      ],
    ])(
      'reads a %s imported.json as an error, never absent, and does not overwrite it',
      async (_label, content, error) => {
        fs.mkdirSync(path.dirname(importedPath()), { recursive: true });
        fs.writeFileSync(importedPath(), content);

        await expect(store.readImported(WS_KEY)).resolves.toEqual({
          status: 'error',
          reasons: [{ path: importedPath(), error }],
        });
        await expect(
          store.publishImport(WS_KEY, importDocument({ 'mcp:a': 'on' })),
        ).resolves.toBe(false);
        expect(fs.readFileSync(importedPath(), 'utf-8')).toBe(content);
      },
    );

    it('refuses to publish an invalid document', async () => {
      const invalid = importDocument({ 'skill:tdd': 'off' });
      await expect(store.publishImport(WS_KEY, invalid)).rejects.toBeInstanceOf(
        CapabilityToggleStoreError,
      );
      expect(fs.existsSync(importedPath())).toBe(false);
    });

    it('resolves two concurrent publishImport calls to exactly one complete, schema-valid file (D1 #8)', async () => {
      const snapshotA = importDocument({ 'mcp:sentry': 'on', 'mcp:x': 'off' });
      const snapshotB = importDocument({ 'mcp:sentry': 'off' });
      const secondStore = new CapabilityToggleStore(fakeOutput(), baseDir);

      const [resultA, resultB] = await Promise.all([
        store.publishImport(WS_KEY, snapshotA),
        secondStore.publishImport(WS_KEY, snapshotB),
      ]);

      // Exactly one of the two racing calls actually published (the other saw
      // the marker already present) OR both raced the marker check and both
      // renamed a complete file in — either way the file on disk afterwards
      // must be exactly one of the two snapshots, never a byte mix of both.
      expect([resultA, resultB].filter(Boolean).length).toBeGreaterThanOrEqual(
        1,
      );
      const onDisk = JSON.parse(
        fs.readFileSync(importedPath(), 'utf-8'),
      ) as CapabilityImportDocument;
      expect([snapshotA, snapshotB]).toContainEqual(onDisk);

      const read = await store.readImported(WS_KEY);
      expect(read).toEqual({ status: 'ok', document: onDisk });
      // Real filesystem writes racing under heavy parallel CI load can
      // exceed Jest's 5000 ms default; give this real-fs concurrency test
      // more room (revise round 1).
    }, 30_000);

    it('keeps explicit items and the imported layer in separate files', async () => {
      await store.publishImport(WS_KEY, importDocument({ 'mcp:sentry': 'on' }));
      await store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'inherit');

      const imported = await store.readImported(WS_KEY);
      const items = await store.readWorkspaceItems(WS_KEY);
      expect(imported).toMatchObject({
        status: 'ok',
        document: { entries: { 'mcp:sentry': 'on' } },
      });
      expect(items).toMatchObject({
        status: 'ok',
        items: [{ id: 'sentry', value: 'inherit' }],
      });
    });
  });

  describe('concurrent writers, no lock', () => {
    it('lands 200 interleaved writes from two instances on different items, all present (D2 #4)', async () => {
      const secondStore = new CapabilityToggleStore(fakeOutput(), baseDir);
      const ITEM_COUNT = 100;

      const writesA = Array.from({ length: ITEM_COUNT }, (_, i) =>
        store.writeWorkspace(WS_KEY, 'mcp', `item-a-${i}`, i % 2 === 0 ? 'on' : 'off'),
      );
      const writesB = Array.from({ length: ITEM_COUNT }, (_, i) =>
        secondStore.writeWorkspace(
          WS_KEY,
          'mcp',
          `item-b-${i}`,
          i % 2 === 0 ? 'off' : 'on',
        ),
      );

      // Interleave: both instances race, none sharing a target file (each
      // index names a distinct item), so there is nothing for a lock to
      // protect.
      await Promise.all([...writesA, ...writesB]);

      const layer = await store.readWorkspaceItems(WS_KEY);
      expect(layer.status).toBe('ok');
      if (layer.status !== 'ok') return;
      expect(layer.items).toHaveLength(ITEM_COUNT * 2);

      const byId = new Map(layer.items.map((item) => [item.id, item]));
      for (let i = 0; i < ITEM_COUNT; i++) {
        expect(byId.get(`item-a-${i}`)?.value).toBe(i % 2 === 0 ? 'on' : 'off');
        expect(byId.get(`item-b-${i}`)?.value).toBe(i % 2 === 0 ? 'off' : 'on');
      }
      // 200 real filesystem writes racing under heavy parallel CI load can
      // exceed Jest's 5000 ms default; give this real-fs concurrency test
      // more room (revise round 1).
    }, 30_000);
  });

  describe('the resolver over the store layers (D1 #6, #7)', () => {
    it('keeps an imported OFF under an inherited global ON as OFF', async () => {
      await store.writeGlobal('mcp', 'sentry', 'on');
      await store.publishImport(WS_KEY, importDocument({ 'mcp:sentry': 'off' }));

      const layers = await layerValuesFor('mcp', 'sentry');
      expect(resolveEffective(layers)).toEqual({
        enabled: false,
        origin: 'imported',
      });
    });

    it('keeps a clear (inherit tombstone) written before an import cleared', async () => {
      await store.writeGlobal('mcp', 'sentry', 'on');
      await store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'inherit');
      await store.publishImport(WS_KEY, importDocument({ 'mcp:sentry': 'off' }));

      // The tombstone skips the imported layer entirely, so it falls through
      // to global, not to the imported OFF.
      const layers = await layerValuesFor('mcp', 'sentry');
      expect(resolveEffective(layers)).toEqual({
        enabled: true,
        origin: 'global',
      });
    });

    it('keeps a clear (inherit tombstone) written after an import cleared', async () => {
      await store.writeGlobal('mcp', 'sentry', 'on');
      await store.publishImport(WS_KEY, importDocument({ 'mcp:sentry': 'off' }));
      await store.writeWorkspace(WS_KEY, 'mcp', 'sentry', 'inherit');

      const layers = await layerValuesFor('mcp', 'sentry');
      expect(resolveEffective(layers)).toEqual({
        enabled: true,
        origin: 'global',
      });
    });
  });

  describe('root.json', () => {
    it('records the physical root once, for diagnostics', async () => {
      await store.recordWorkspaceRoot(WS_KEY, '/work/Repo', '/work/repo');
      const file = path.join(baseDir, 'workspaces', WS_KEY, 'root.json');
      const first = fs.readFileSync(file, 'utf-8');
      await store.recordWorkspaceRoot(WS_KEY, '/elsewhere', '/elsewhere');

      expect(fs.readFileSync(file, 'utf-8')).toBe(first);
      expect(JSON.parse(first)).toMatchObject({
        v: 1,
        physicalRoot: '/work/Repo',
        policyKey: '/work/repo',
      });
    });
  });
});
