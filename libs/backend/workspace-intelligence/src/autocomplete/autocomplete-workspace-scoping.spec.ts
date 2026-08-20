/**
 * TASK_2026_200 — explicit workspace scoping on the `/` picker
 * (`autocomplete:agents`, `autocomplete:commands`). Acceptance criterion 10.
 *
 * What these specs pin down, and why each one exists:
 *
 * 1. **The explicit root beats the provider.** `AgentDiscoveryService` and
 *    `CommandDiscoveryService` both read `IWorkspaceProvider.getWorkspaceRoot()`
 *    per call, which tracks the *process-global* active folder. That is the
 *    window's folder in VS Code and flips at runtime in Electron, so it is not
 *    necessarily the workspace the calling tab is bound to. Supplying
 *    `workspaceRoot` must win.
 *
 * 2. **The unkeyed cache no longer answers for the wrong workspace.** This is
 *    the part the plan did not anticipate. `searchAgents` / `searchCommands` —
 *    the methods the RPC handlers actually call — served a process-global
 *    `cache` field to every caller, only refilling it when it was *empty*. So
 *    the first workspace to populate it answered for all later ones, and an
 *    explicit `workspaceRoot` would have been accepted and then silently
 *    ignored on every call after the first. The cache is now keyed by
 *    `normalizeWorkspaceRoot`, which is what makes criterion 10 observable at
 *    all. Tests marked "cache" below fail against the pre-fix code.
 *
 * 3. **Omitting the param is unchanged.** The optional-param contract: an older
 *    webview and the MCP-side callers pass nothing and must keep working.
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

/** `.md` file names the fake FS serves for a given directory. */
type DirMap = Record<string, string[]>;

/**
 * Wire `fs/promises` so each workspace has exactly one distinctly-named agent
 * or command file. Any directory not listed rejects, which is how the real
 * services see "no such directory".
 *
 * The two services read directories differently — `AgentDiscoveryService` calls
 * `readdir(dir)` (plain names) while `CommandDiscoveryService` calls
 * `readdir(dir, { withFileTypes: true })` (Dirent objects) for its recursive
 * walk — so the fake honours the option rather than assuming one shape.
 */
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

/** Provider that always reports ROOT_A — the "wrong" root for these tests. */
function providerOnA(): { getWorkspaceRoot: jest.Mock } {
  return { getWorkspaceRoot: jest.fn(() => ROOT_A) };
}

function makeAgentService(provider: { getWorkspaceRoot: jest.Mock }) {
  const ctor = AgentDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => AgentDiscoveryService;
  return new ctor(provider, { createFileWatcher: jest.fn() });
}

function makeCommandService(provider: { getWorkspaceRoot: jest.Mock }) {
  const ctor = CommandDiscoveryService as unknown as new (
    ...args: unknown[]
  ) => CommandDiscoveryService;
  return new ctor(
    provider,
    { createFileWatcher: jest.fn() },
    { captureException: jest.fn() },
  );
}

beforeEach(() => {
  readdir.mockReset();
  readFile.mockReset();
});

// ---------------------------------------------------------------------------
// autocomplete:agents
// ---------------------------------------------------------------------------

describe('AgentDiscoveryService workspace scoping (criterion 10)', () => {
  const agentDirs = (): DirMap => ({
    [path.normalize(path.join(ROOT_A, '.claude/agents'))]: ['agent-a.md'],
    [path.normalize(path.join(ROOT_B, '.claude/agents'))]: ['agent-b.md'],
    [path.normalize(path.join(os.homedir(), '.claude/agents'))]: [],
  });

  it('discoverAgents(root) scans the explicit root, not the provider root', async () => {
    mountFs(agentDirs());
    const provider = providerOnA();
    const service = makeAgentService(provider);

    const result = await service.discoverAgents(ROOT_B);

    const names = result.agents?.map((a) => a.name) ?? [];
    expect(names).toContain('agent-b');
    expect(names).not.toContain('agent-a');
  });

  it('searchAgents with an explicit root returns that root agents while the provider reports A', async () => {
    mountFs(agentDirs());
    const service = makeAgentService(providerOnA());

    const result = await service.searchAgents({
      query: 'agent-',
      workspaceRoot: ROOT_B,
    });

    expect(result.success).toBe(true);
    expect(result.agents?.map((a) => a.name)).toEqual(['agent-b']);
  });

  it('cache: a prior search for A does NOT leak A agents into a later search for B', async () => {
    mountFs(agentDirs());
    const service = makeAgentService(providerOnA());

    // Populate the process-global cache from workspace A first. Pre-fix, this
    // single call pinned every subsequent answer to A.
    const first = await service.searchAgents({ query: 'agent-' });
    expect(first.agents?.map((a) => a.name)).toEqual(['agent-a']);

    const second = await service.searchAgents({
      query: 'agent-',
      workspaceRoot: ROOT_B,
    });

    expect(second.agents?.map((a) => a.name)).toEqual(['agent-b']);
    expect(second.agents?.map((a) => a.name)).not.toContain('agent-a');
  });

  it('cache: a repeat search for the SAME root is still served from cache (no redundant rescan)', async () => {
    mountFs(agentDirs());
    const service = makeAgentService(providerOnA());

    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_B });
    const callsAfterFirst = readdir.mock.calls.length;
    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_B });

    expect(readdir.mock.calls.length).toBe(callsAfterFirst);
  });

  it('cache: separator/drive-case variants of one root hit the same cache entry (criterion 13)', async () => {
    mountFs(agentDirs());
    const service = makeAgentService(providerOnA());

    await service.searchAgents({ query: 'agent-', workspaceRoot: ROOT_B });
    const callsAfterFirst = readdir.mock.calls.length;

    const variant = isWin ? 'd:\\proj-b\\' : '/proj-b/';
    const again = await service.searchAgents({
      query: 'agent-',
      workspaceRoot: variant,
    });

    expect(again.agents?.map((a) => a.name)).toEqual(['agent-b']);
    expect(readdir.mock.calls.length).toBe(callsAfterFirst);
  });

  it('omitted workspaceRoot falls back to the provider root (unchanged contract)', async () => {
    mountFs(agentDirs());
    const provider = providerOnA();
    const service = makeAgentService(provider);

    const result = await service.searchAgents({ query: 'agent-' });

    expect(provider.getWorkspaceRoot).toHaveBeenCalled();
    expect(result.agents?.map((a) => a.name)).toEqual(['agent-a']);
  });

  it('omitted workspaceRoot tracks a provider root that changes mid-process', async () => {
    mountFs(agentDirs());
    const provider = {
      getWorkspaceRoot: jest.fn<string | undefined, []>(() => ROOT_A),
    };
    const service = makeAgentService(provider);

    expect(
      (await service.searchAgents({ query: 'agent-' })).agents?.map(
        (a) => a.name,
      ),
    ).toEqual(['agent-a']);

    // Electron flips the active folder at runtime; the picker must follow.
    provider.getWorkspaceRoot.mockReturnValue(ROOT_B);

    expect(
      (await service.searchAgents({ query: 'agent-' })).agents?.map(
        (a) => a.name,
      ),
    ).toEqual(['agent-b']);
  });

  it('with no workspace open, searchAgents surfaces the builtin agents', async () => {
    mountFs(agentDirs());
    // Documented deviation (TASK_2026_200): pre-fix this returned [] because
    // `discoverAgents` builds the builtins but does not cache them, and the old
    // `searchAgents` sliced the empty cache field instead of the return value.
    const service = makeAgentService({
      getWorkspaceRoot: jest.fn(() => undefined),
    });

    const result = await service.searchAgents({ query: '' });

    expect(result.success).toBe(true);
    expect(result.agents?.length).toBeGreaterThan(0);
    expect(result.agents?.every((a) => a.scope === 'builtin')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// autocomplete:commands
// ---------------------------------------------------------------------------

describe('CommandDiscoveryService workspace scoping (criterion 10)', () => {
  const commandDirs = (): DirMap => ({
    [path.normalize(path.join(ROOT_A, '.claude/commands'))]: ['cmd-a.md'],
    [path.normalize(path.join(ROOT_B, '.claude/commands'))]: ['cmd-b.md'],
    [path.normalize(path.join(os.homedir(), '.claude/commands'))]: [],
  });

  it('discoverCommands(root) scans the explicit root, not the provider root', async () => {
    mountFs(commandDirs());
    const service = makeCommandService(providerOnA());

    const result = await service.discoverCommands(ROOT_B);

    const names = result.commands?.map((c) => c.name) ?? [];
    expect(names).toContain('cmd-b');
    expect(names).not.toContain('cmd-a');
  });

  it('searchCommands with an explicit root returns that root commands while the provider reports A', async () => {
    mountFs(commandDirs());
    const service = makeCommandService(providerOnA());

    const result = await service.searchCommands({
      query: 'cmd-',
      workspaceRoot: ROOT_B,
    });

    expect(result.success).toBe(true);
    expect(result.commands?.map((c) => c.name)).toEqual(['cmd-b']);
  });

  it('cache: a prior search for A does NOT leak A commands into a later search for B', async () => {
    mountFs(commandDirs());
    const service = makeCommandService(providerOnA());

    const first = await service.searchCommands({ query: 'cmd-' });
    expect(first.commands?.map((c) => c.name)).toEqual(['cmd-a']);

    const second = await service.searchCommands({
      query: 'cmd-',
      workspaceRoot: ROOT_B,
    });

    expect(second.commands?.map((c) => c.name)).toEqual(['cmd-b']);
    expect(second.commands?.map((c) => c.name)).not.toContain('cmd-a');
  });

  it('cache: a repeat search for the SAME root is still served from cache', async () => {
    mountFs(commandDirs());
    const service = makeCommandService(providerOnA());

    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_B });
    const callsAfterFirst = readdir.mock.calls.length;
    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_B });

    expect(readdir.mock.calls.length).toBe(callsAfterFirst);
  });

  it('cache: invalidateCache() clears the root key too, so the next search rescans', async () => {
    mountFs(commandDirs());
    const service = makeCommandService(providerOnA());

    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_B });
    const callsAfterFirst = readdir.mock.calls.length;

    service.invalidateCache();
    await service.searchCommands({ query: 'cmd-', workspaceRoot: ROOT_B });

    expect(readdir.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it('omitted workspaceRoot falls back to the provider root (unchanged contract)', async () => {
    mountFs(commandDirs());
    const provider = providerOnA();
    const service = makeCommandService(provider);

    const result = await service.searchCommands({ query: 'cmd-' });

    expect(provider.getWorkspaceRoot).toHaveBeenCalled();
    expect(result.commands?.map((c) => c.name)).toEqual(['cmd-a']);
  });

  it('with no workspace open, searchCommands still resolves successfully with an empty list (unchanged)', async () => {
    mountFs(commandDirs());
    // Pre-fix behaviour preserved deliberately: `discoverCommands` returns
    // `success: false`, but `searchCommands` degrades to an empty list rather
    // than propagating, so the `/` picker shows nothing instead of an error.
    const service = makeCommandService({
      getWorkspaceRoot: jest.fn(() => undefined),
    });

    const result = await service.searchCommands({ query: 'cmd-' });

    expect(result.success).toBe(true);
    expect(result.commands).toEqual([]);
  });
});
