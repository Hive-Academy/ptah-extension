import 'reflect-metadata';
import { FileType } from '../../types/platform.types';
import { createMockFileSystemProvider } from './file-system-provider.mock';
import { createMockWorkspaceProvider } from './workspace-provider.mock';
import { createMockSecretStorage } from './secret-storage.mock';
import { createMockStateStorage } from './state-storage.mock';
import { createMockHttpServerProvider } from './http-server-provider.mock';

describe('createMockFileSystemProvider — branch coverage', () => {
  it('readDirectory rejects on a non-existent path with no descendants', async () => {
    const fs = createMockFileSystemProvider();
    await expect(fs.readDirectory('/no/such/dir')).rejects.toThrow(/ENOENT/);
  });

  it('readDirectory surfaces directories registered via createDirectory', async () => {
    const fs = createMockFileSystemProvider();
    await fs.createDirectory('/root/empty-dir');
    await fs.writeFile('/root/file.txt', 'x');
    const entries = await fs.readDirectory('/root');
    const empty = entries.find((e) => e.name === 'empty-dir');
    expect(empty?.type).toBe(FileType.Directory);
  });

  it('stat reports FileType.Directory for createDirectory-only paths', async () => {
    const fs = createMockFileSystemProvider();
    await fs.createDirectory('/only-dir');
    const stat = await fs.stat('/only-dir');
    expect(stat.type).toBe(FileType.Directory);
  });

  it('delete on a directory removes that directory entry', async () => {
    const fs = createMockFileSystemProvider();
    await fs.createDirectory('/dir-to-remove');
    await fs.delete('/dir-to-remove');
    expect(await fs.exists('/dir-to-remove')).toBe(false);
  });

  it('delete recursive removes nested files and sub-directories', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile('/tree/a.txt', 'a');
    await fs.writeFile('/tree/sub/b.txt', 'b');
    await fs.createDirectory('/tree/sub/empty');

    await fs.delete('/tree', { recursive: true });

    expect(await fs.exists('/tree/a.txt')).toBe(false);
    expect(await fs.exists('/tree/sub/b.txt')).toBe(false);
    await expect(fs.readFile('/tree/a.txt')).rejects.toThrow();
  });

  it('delete on a missing path rejects with ENOENT', async () => {
    const fs = createMockFileSystemProvider();
    await expect(fs.delete('/absent')).rejects.toThrow(/ENOENT/);
  });

  it('copy rejects when source does not exist', async () => {
    const fs = createMockFileSystemProvider();
    await expect(fs.copy('/missing/src', '/dst')).rejects.toThrow(/ENOENT/);
  });

  it('copy rejects with EEXIST when overwrite=false and destination exists', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile('/src.txt', 'src');
    await fs.writeFile('/dst.txt', 'dst');
    await expect(
      fs.copy('/src.txt', '/dst.txt', { overwrite: false }),
    ).rejects.toThrow(/EEXIST/);
  });

  it('findFiles with **/* pattern returns all known files', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile('/a/one.txt', 'a');
    await fs.writeFile('/b/two.txt', 'b');
    const results = await fs.findFiles('**/*');
    expect(results.sort()).toEqual(['/a/one.txt', '/b/two.txt']);
  });

  it('findFiles respects maxResults cap', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile('/a.txt', '1');
    await fs.writeFile('/b.txt', '2');
    await fs.writeFile('/c.txt', '3');
    const results = await fs.findFiles('**/*', undefined, 2);
    expect(results.length).toBe(2);
  });

  it('findFiles with suffix-only pattern filters by suffix', async () => {
    const fs = createMockFileSystemProvider();
    await fs.writeFile('/keep.json', '{}');
    await fs.writeFile('/skip.txt', 't');
    const results = await fs.findFiles('*.json');
    expect(results).toEqual(['/keep.json']);
  });

  it('overrides replace the default implementation while preserving jest.fn() metadata', async () => {
    const customRead = jest.fn(async () => 'overridden');
    const fs = createMockFileSystemProvider({
      readFile: customRead as never,
    });
    expect(await fs.readFile('/anything')).toBe('overridden');
    expect(customRead).toHaveBeenCalledTimes(1);
    expect((fs.readFile as jest.Mock).mock.calls.length).toBeGreaterThan(0);
  });

  it('createFileWatcher returns a watcher with disposable handle', () => {
    const fs = createMockFileSystemProvider();
    const watcher = fs.createFileWatcher('**/*.ts');
    expect(typeof watcher.dispose).toBe('function');
    watcher.dispose();
  });
});

describe('createMockWorkspaceProvider — branch coverage', () => {
  it('seeds initial config map from overrides.config', () => {
    const ws = createMockWorkspaceProvider({
      config: { 'ptah.someKey': 'value' },
    });
    expect(ws.getConfiguration<string>('ptah', 'someKey')).toBe('value');
  });

  it('fireConfigurationChange surfaces through onDidChangeConfiguration', () => {
    const ws = createMockWorkspaceProvider();
    const seen: Array<{ affectsConfiguration: (s: string) => boolean }> = [];
    const sub = ws.onDidChangeConfiguration((evt) => seen.push(evt));

    ws.__state.fireConfigurationChange('ptah');

    sub.dispose();
    expect(seen).toHaveLength(1);
    expect(seen[0].affectsConfiguration('ptah')).toBe(true);
    expect(seen[0].affectsConfiguration('other')).toBe(false);
  });

  it('fireWorkspaceFoldersChange surfaces through onDidChangeWorkspaceFolders', () => {
    const ws = createMockWorkspaceProvider();
    let fired = 0;
    const sub = ws.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    ws.__state.fireWorkspaceFoldersChange();
    sub.dispose();
    expect(fired).toBe(1);
  });

  it('setFolders mutates folders list and fires the change event', () => {
    const ws = createMockWorkspaceProvider({ folders: ['/a'] });
    let fired = 0;
    const sub = ws.onDidChangeWorkspaceFolders(() => {
      fired += 1;
    });
    ws.__state.setFolders(['/b', '/c']);
    sub.dispose();
    expect(ws.getWorkspaceFolders()).toEqual(['/b', '/c']);
    expect(ws.getWorkspaceRoot()).toBe('/b');
    expect(fired).toBe(1);
  });

  it('getConfiguration falls back to defaultValue when nothing seeded', () => {
    const ws = createMockWorkspaceProvider();
    expect(ws.getConfiguration<string>('ptah', 'missing', 'fallback')).toBe(
      'fallback',
    );
  });

  it('setConfiguration persists then surfaces through onDidChangeConfiguration', async () => {
    const ws = createMockWorkspaceProvider();
    const seen: Array<{ affectsConfiguration: (s: string) => boolean }> = [];
    const sub = ws.onDidChangeConfiguration((evt) => seen.push(evt));
    await ws.setConfiguration('ptah', 'k', 42);
    sub.dispose();
    expect(ws.getConfiguration<number>('ptah', 'k')).toBe(42);
    expect(seen[0]?.affectsConfiguration('ptah')).toBe(true);
  });

  it('function overrides replace built-in methods', () => {
    const customRoot = jest.fn(() => '/custom-root');
    const ws = createMockWorkspaceProvider({
      getWorkspaceRoot: customRoot as never,
    });
    expect(ws.getWorkspaceRoot()).toBe('/custom-root');
    expect(customRoot).toHaveBeenCalledTimes(1);
  });
});

describe('createMockSecretStorage — branch coverage', () => {
  it('seed initial entries via overrides.seed', async () => {
    const sec = createMockSecretStorage({ seed: { k1: 'v1' } });
    expect(await sec.get('k1')).toBe('v1');
  });

  it('__state.seed mutates entries without firing an event', async () => {
    const sec = createMockSecretStorage();
    const seen: string[] = [];
    const sub = sec.onDidChange((e) => seen.push(e.key));
    sec.__state.seed('quiet', 'value');
    sub.dispose();
    expect(await sec.get('quiet')).toBe('value');
    expect(seen).toHaveLength(0);
  });

  it('__state.fireChange surfaces the event', () => {
    const sec = createMockSecretStorage();
    const seen: string[] = [];
    const sub = sec.onDidChange((e) => seen.push(e.key));
    sec.__state.fireChange('manual');
    sub.dispose();
    expect(seen).toEqual(['manual']);
  });

  it('overrides replace the default get implementation', async () => {
    const customGet = jest.fn(async () => 'overridden');
    const sec = createMockSecretStorage({ get: customGet as never });
    expect(await sec.get('any')).toBe('overridden');
    expect(customGet).toHaveBeenCalled();
  });

  it('delete on a missing key does not fire an event', async () => {
    const sec = createMockSecretStorage();
    const seen: string[] = [];
    const sub = sec.onDidChange((e) => seen.push(e.key));
    await sec.delete('never-existed');
    sub.dispose();
    expect(seen).toHaveLength(0);
  });
});

describe('createMockStateStorage — branch coverage', () => {
  it('seed initial entries via overrides.seed', () => {
    const st = createMockStateStorage({ seed: { foo: 1 } });
    expect(st.get<number>('foo')).toBe(1);
  });

  it('get falls back to defaultValue when key absent', () => {
    const st = createMockStateStorage();
    expect(st.get<string>('missing', 'fallback')).toBe('fallback');
  });

  it('update with undefined deletes the key', async () => {
    const st = createMockStateStorage({ seed: { foo: 'bar' } });
    await st.update('foo', undefined);
    expect(st.get<string>('foo')).toBeUndefined();
    expect(st.keys()).not.toContain('foo');
  });

  it('__state.seed mutates entries directly', () => {
    const st = createMockStateStorage();
    st.__state.seed('seeded', 99);
    expect(st.get<number>('seeded')).toBe(99);
  });

  it('overrides replace the default get implementation', () => {
    const customGet = jest.fn(() => 'overridden');
    const st = createMockStateStorage({ get: customGet as never });
    expect(st.get<string>('any')).toBe('overridden');
    expect(customGet).toHaveBeenCalled();
  });
});

describe('createMockHttpServerProvider — branch coverage', () => {
  it('records listen calls in state', async () => {
    const srv = createMockHttpServerProvider();
    const handler = jest.fn();
    const handle = await srv.listen('127.0.0.1', 1234, handler as never);
    expect(srv.state.listenCalls).toHaveLength(1);
    expect(srv.state.listenCalls[0].host).toBe('127.0.0.1');
    expect(srv.state.listenCalls[0].port).toBe(1234);
    expect(handle.host).toBe('127.0.0.1');
    expect(handle.port).toBe(58080);
    await expect(handle.close()).resolves.not.toThrow();
    await expect(handle.close()).resolves.not.toThrow();
  });

  it('honours overrides.boundPort', async () => {
    const srv = createMockHttpServerProvider({ boundPort: 9090 });
    const handle = await srv.listen('::1', 0, () => {
      return;
    });
    expect(handle.port).toBe(9090);
    await handle.close();
  });

  it('rejects with listenError when set', async () => {
    const srv = createMockHttpServerProvider({
      listenError: new Error('forced-failure'),
    });
    await expect(
      srv.listen('127.0.0.1', 0, () => {
        return;
      }),
    ).rejects.toThrow('forced-failure');
  });
});
