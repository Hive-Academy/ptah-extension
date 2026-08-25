/**
 * Per-workspace invalidation for the `@` and `/` pickers.
 *
 * TASK_2026_200 keyed the discovery cache by root, which stopped one workspace
 * ANSWERING for another. It left two things unfinished, and both only show up
 * with more than one folder open:
 *
 * 1. **One slot held one workspace.** Two folders in alternating use evicted
 *    each other, so every keystroke in either paid for a full rescan of both
 *    its project directory and `~/.claude`.
 * 2. **The watcher refreshed the wrong folder.** A single unscoped watcher
 *    re-ran discovery for `getWorkspaceRoot()` — the process-global active
 *    folder — so an edit in folder B rescanned folder A and republished under
 *    A's key. B's own edit never invalidated B.
 *
 * These specs pin the fix: a per-root cache, and one watcher per open folder
 * that invalidates the folder it was armed for. The old
 * "DELIBERATELY NOT root-parameterized" note is still honoured — nothing is
 * pinned to the activation-time root, and the folder set is re-armed when it
 * changes (last block).
 */

import 'reflect-metadata';

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  readFile: jest.fn(),
}));

import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { AgentDiscoveryService } from './agent-discovery.service';
import { CommandDiscoveryService } from './command-discovery.service';

const readdir = fsPromises.readdir as unknown as jest.Mock;
const readFile = fsPromises.readFile as unknown as jest.Mock;

const isWin = process.platform === 'win32';
const ROOT_A = isWin ? 'D:\\proj-a' : '/proj-a';
const ROOT_B = isWin ? 'D:\\proj-b' : '/proj-b';

type DirMap = Record<string, string[]>;

function mountFs(dirs: DirMap): void {
  readdir.mockImplementation(
    async (dir: string, options?: { withFileTypes?: boolean }) => {
      const entries = dirs[path.normalize(dir)];
      if (!entries) throw new Error(`ENOENT: ${dir}`);
      if (!options?.withFileTypes) return entries;
      return entries.map((name) => ({
        name,
        isDirectory: () => false,
        isFile: () => true,
      }));
    },
  );
  readFile.mockImplementation(async (filePath: string) => {
    const name = path.basename(filePath, '.md');
    return `---\nname: ${name}\ndescription: from ${name}\n---\nbody\n`;
  });
}

function stubLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

/** Fires registered handlers on demand — stands in for `IEvent`. */
function stubEvent() {
  const handlers: Array<() => void> = [];
  const event = (handler: () => void) => {
    handlers.push(handler);
    return { dispose: jest.fn() };
  };
  return { event, fire: () => handlers.forEach((h) => h()) };
}

/**
 * A provider over a real folder LIST — the shape the fixed watcher reads. The
 * "active" root stays A throughout, which is what makes a B invalidation
 * observable: pre-fix, every refresh went to A regardless.
 */
function multiRootProvider(folders: string[]) {
  const folderChange = stubEvent();
  return {
    provider: {
      getWorkspaceRoot: jest.fn(() => folders[0]),
      getWorkspaceFolders: jest.fn(() => [...folders]),
      onDidChangeWorkspaceFolders: folderChange.event,
    },
    fireFolderChange: folderChange.fire,
    setFolders: (next: string[]) => {
      folders.splice(0, folders.length, ...next);
    },
  };
}

/**
 * A file-system provider that records which `cwd` each watcher was armed for
 * and lets a test fire that watcher's events.
 */
function watchableFs() {
  const armed = new Map<string, Array<() => void>>();
  const disposed: string[] = [];
  return {
    armedRoots: (): string[] => [...armed.keys()],
    disposed,
    fireChange: (folder: string): void =>
      (armed.get(folder) ?? []).forEach((h) => h()),
    fsProvider: {
      createFileWatcher: jest.fn(
        (_pattern: string, options?: { cwd?: string }) => {
          const cwd = options?.cwd ?? '';
          const handlers: Array<() => void> = [];
          armed.set(cwd, handlers);
          const register = (handler: () => void) => {
            handlers.push(handler);
            return { dispose: jest.fn() };
          };
          return {
            onDidCreate: register,
            onDidChange: register,
            onDidDelete: register,
            dispose: jest.fn(() => {
              disposed.push(cwd);
              armed.delete(cwd);
            }),
          };
        },
      ),
    },
  };
}

function makeAgentService(provider: object, fsProvider: object) {
  const ctor = AgentDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => AgentDiscoveryService;
  return new ctor(provider, fsProvider, stubLogger());
}

function makeCommandService(provider: object, fsProvider: object) {
  const ctor = CommandDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => CommandDiscoveryService;
  return new ctor(
    provider,
    fsProvider,
    { captureException: jest.fn() },
    stubLogger(),
  );
}

const agentDirs = (): DirMap => ({
  [path.normalize(path.join(ROOT_A, '.claude/agents'))]: ['agent-a.md'],
  [path.normalize(path.join(ROOT_B, '.claude/agents'))]: ['agent-b.md'],
  [path.normalize(path.join(os.homedir(), '.claude/agents'))]: [],
});

beforeEach(() => {
  readdir.mockReset();
  readFile.mockReset();
});

describe('AgentDiscoveryService — per-folder watchers', () => {
  it('arms one watcher per open folder, each scoped to that folder', () => {
    const { provider } = multiRootProvider([ROOT_A, ROOT_B]);
    const fs = watchableFs();
    makeAgentService(provider, fs.fsProvider).initializeWatchers();

    expect(fs.armedRoots().sort()).toEqual([ROOT_A, ROOT_B].sort());
    // Relative pattern + `cwd`, so every adapter can resolve it exactly.
    expect(fs.fsProvider.createFileWatcher).toHaveBeenCalledWith(
      '.claude/agents/*.md',
      { cwd: ROOT_A },
    );
  });

  it('is idempotent — a second call does not arm a second set', () => {
    const { provider } = multiRootProvider([ROOT_A]);
    const fs = watchableFs();
    const service = makeAgentService(provider, fs.fsProvider);

    service.initializeWatchers();
    service.initializeWatchers();

    expect(fs.fsProvider.createFileWatcher).toHaveBeenCalledTimes(1);
  });

  /**
   * The defect in one test. The provider reports A as active throughout, so
   * pre-fix the B event ran discovery for A and republished under A's key,
   * leaving B's cached list untouched and stale.
   */
  it('an edit in a NON-active folder invalidates that folder, not the active one', async () => {
    mountFs(agentDirs());
    const { provider } = multiRootProvider([ROOT_A, ROOT_B]);
    const fs = watchableFs();
    const service = makeAgentService(provider, fs.fsProvider);
    service.initializeWatchers();

    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_A });
    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_B });
    const settled = readdir.mock.calls.length;

    fs.fireChange(ROOT_B);

    // B rescans…
    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_B });
    const afterB = readdir.mock.calls.length;
    expect(afterB).toBeGreaterThan(settled);

    // …and A, which nothing touched, is still served from cache.
    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_A });
    expect(readdir.mock.calls.length).toBe(afterB);
  });

  /**
   * The other half of the single-slot problem: two folders used alternately
   * used to evict each other, so neither was ever served from cache.
   */
  it('keeps BOTH folders cached at once', async () => {
    mountFs(agentDirs());
    const { provider } = multiRootProvider([ROOT_A, ROOT_B]);
    const fs = watchableFs();
    const service = makeAgentService(provider, fs.fsProvider);

    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_A });
    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_B });
    const settled = readdir.mock.calls.length;

    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_A });
    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_B });

    expect(readdir.mock.calls.length).toBe(settled);
  });

  it('re-arms the watcher set when the open folders change', () => {
    const roots = multiRootProvider([ROOT_A]);
    const fs = watchableFs();
    makeAgentService(roots.provider, fs.fsProvider).initializeWatchers();
    expect(fs.armedRoots()).toEqual([ROOT_A]);

    roots.setFolders([ROOT_A, ROOT_B]);
    roots.fireFolderChange();

    // A folder added after activation gets a watcher — the old single-watcher
    // code was frozen at activation time.
    expect(fs.armedRoots().sort()).toEqual([ROOT_A, ROOT_B].sort());
    expect(fs.disposed).toContain(ROOT_A);
  });

  it('survives a host whose watcher cannot be created', () => {
    const { provider } = multiRootProvider([ROOT_A]);
    const throwing = {
      createFileWatcher: jest.fn(() => {
        throw new Error('no watcher here');
      }),
    };

    expect(() =>
      makeAgentService(provider, throwing).initializeWatchers(),
    ).not.toThrow();
  });
});

describe('CommandDiscoveryService — per-folder watchers', () => {
  const commandDirs = (): DirMap => ({
    [path.normalize(path.join(ROOT_A, '.claude/commands'))]: ['cmd-a.md'],
    [path.normalize(path.join(ROOT_B, '.claude/commands'))]: ['cmd-b.md'],
    [path.normalize(path.join(os.homedir(), '.claude/commands'))]: [],
  });

  it('arms one watcher per open folder, each scoped to that folder', () => {
    const { provider } = multiRootProvider([ROOT_A, ROOT_B]);
    const fs = watchableFs();
    makeCommandService(provider, fs.fsProvider).initializeWatchers();

    expect(fs.armedRoots().sort()).toEqual([ROOT_A, ROOT_B].sort());
    expect(fs.fsProvider.createFileWatcher).toHaveBeenCalledWith(
      '.claude/commands/**/*.md',
      { cwd: ROOT_B },
    );
  });

  it('an edit in a NON-active folder invalidates that folder, not the active one', async () => {
    mountFs(commandDirs());
    const { provider } = multiRootProvider([ROOT_A, ROOT_B]);
    const fs = watchableFs();
    const service = makeCommandService(provider, fs.fsProvider);
    service.initializeWatchers();

    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_A });
    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_B });
    const settled = readdir.mock.calls.length;

    fs.fireChange(ROOT_B);

    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_B });
    const afterB = readdir.mock.calls.length;
    expect(afterB).toBeGreaterThan(settled);

    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_A });
    expect(readdir.mock.calls.length).toBe(afterB);
  });

  /**
   * The plugin handlers call `invalidateCache()` with no argument after a
   * harness reconcile, which is not attributable to one folder. That call must
   * keep meaning "drop everything".
   */
  it('invalidateCache() with no root still clears every workspace', async () => {
    mountFs(commandDirs());
    const { provider } = multiRootProvider([ROOT_A, ROOT_B]);
    const fs = watchableFs();
    const service = makeCommandService(provider, fs.fsProvider);

    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_A });
    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_B });
    const settled = readdir.mock.calls.length;

    service.invalidateCache();

    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_A });
    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_B });

    expect(readdir.mock.calls.length).toBeGreaterThan(settled);
  });
});
