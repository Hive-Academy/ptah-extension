import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { IStateStorage } from '@ptah-extension/platform-core';
import { collectLegacySessionSources } from './session-store-migration';

const encode = (p: string) =>
  Buffer.from(path.resolve(p)).toString('base64url');

function storage(label: string): IStateStorage & { label: string } {
  return {
    label,
    get: () => undefined,
    update: async () => undefined,
    keys: () => [],
  };
}

describe('collectLegacySessionSources', () => {
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-ws-storage-'));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  function folder(name: string, files: Record<string, string>): string {
    const dir = path.join(root, name);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  }

  it('reads live stores through their own instance and opens the rest read-only', async () => {
    const live = storage('live-alpha');
    const defaultStore = storage('default');
    folder('default', { 'workspace-state.v2/CURRENT': '{}' });
    const alphaDir = folder(encode('/projects/alpha'), {
      'workspace-state.v2/CURRENT': '{}',
    });
    const betaDir = folder(encode('/projects/beta'), {
      'workspace-state.v2/CURRENT': '{}',
    });
    const gammaDir = folder(encode('/projects/gamma'), {
      'workspace-state.json': JSON.stringify({
        'ptah.sessionMetadata': [{ sessionId: 's-gamma' }],
      }),
    });
    folder('not-a-store', { 'readme.txt': 'x' });

    const opened: string[] = [];
    const disposed: string[] = [];
    const result = await collectLegacySessionSources({
      workspaceStorageRoot: root,
      liveStorage: {
        getDefaultStorage: () => defaultStore,
        getStorageForWorkspace: (p) =>
          p === path.resolve('/projects/alpha') ? live : undefined,
      },
      openReadOnlyV2: async (dir) => {
        opened.push(dir);
        return {
          storage: storage(`temp:${path.basename(dir)}`),
          dispose: async () => {
            disposed.push(dir);
          },
        };
      },
    });

    const bySource = new Map(
      result.sources.map((s) => [s.sourcePath, s.storage]),
    );
    expect(bySource.get(path.join(root, 'default'))).toBe(defaultStore);
    expect(bySource.get(alphaDir)).toBe(live);
    expect((bySource.get(betaDir) as unknown as { label: string }).label).toBe(
      `temp:${path.basename(betaDir)}`,
    );
    expect(bySource.get(gammaDir)?.get('ptah.sessionMetadata')).toEqual([
      { sessionId: 's-gamma' },
    ]);
    expect(bySource.has(path.join(root, 'not-a-store'))).toBe(false);
    expect(opened).toEqual([betaDir]);

    await result.release();
    expect(disposed).toEqual([betaDir]);
  });

  it('never writes a v1-only store', async () => {
    const dir = folder(encode('/projects/gamma'), {
      'workspace-state.json': '{"a":1}',
    });
    const result = await collectLegacySessionSources({
      workspaceStorageRoot: root,
      liveStorage: {
        getDefaultStorage: () => storage('default'),
        getStorageForWorkspace: () => undefined,
      },
      openReadOnlyV2: async () => {
        throw new Error('not expected');
      },
    });
    const v1 = result.sources.find((s) => s.sourcePath === dir)?.storage;
    await expect(v1?.update('a', 2)).rejects.toThrow(/read-only/);
    expect(
      fs.readFileSync(path.join(dir, 'workspace-state.json'), 'utf8'),
    ).toBe('{"a":1}');
  });

  it('skips an unreadable store and keeps the others', async () => {
    const brokenV2 = folder(encode('/projects/broken-v2'), {
      'workspace-state.v2/CURRENT': '{}',
    });
    const brokenV1 = folder(encode('/projects/broken-v1'), {
      'workspace-state.json': '{not json',
    });
    const goodV2 = folder(encode('/projects/good-v2'), {
      'workspace-state.v2/CURRENT': '{}',
    });
    const disposed: string[] = [];
    const warn = jest.fn();
    const result = await collectLegacySessionSources({
      workspaceStorageRoot: root,
      liveStorage: {
        getDefaultStorage: () => storage('default'),
        getStorageForWorkspace: () => undefined,
      },
      openReadOnlyV2: async (dir) => {
        if (dir === brokenV2) throw new Error('recovery required');
        return {
          storage: storage('good'),
          dispose: async () => {
            disposed.push(dir);
          },
        };
      },
      logger: { warn },
    });

    expect(result.sources.map((s) => s.sourcePath)).toEqual([goodV2]);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls.map((c) => c[1].sourcePath).sort()).toEqual(
      [brokenV1, brokenV2].sort(),
    );
    await result.release();
    expect(disposed).toEqual([goodV2]);
  });

  it('returns nothing when the folder does not exist', async () => {
    const result = await collectLegacySessionSources({
      workspaceStorageRoot: path.join(root, 'missing'),
      liveStorage: {
        getDefaultStorage: () => storage('default'),
        getStorageForWorkspace: () => undefined,
      },
      openReadOnlyV2: async () => {
        throw new Error('not expected');
      },
    });
    expect(result.sources).toEqual([]);
  });
});
