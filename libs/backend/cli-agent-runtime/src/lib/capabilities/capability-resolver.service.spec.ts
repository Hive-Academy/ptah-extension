/**
 * CapabilityResolverService (TASK_2026_560, C4).
 *
 * Every case runs against real temp directories: a fake home (the store, the
 * `~/.claude.json`, `~/.codex` and the plugin root all live under it) and one
 * or more repositories inside it, so the workspace-root walk stops at the fake
 * home and nothing here can reach the developer's real `~/.ptah` or
 * `~/.claude.json`. git is a scripted runner. The plugin loader is the real
 * `PluginLoaderService` over a Map-backed workspace storage, with the real
 * store as its global layer, so the skill/plugin layering under test is the
 * production one.
 */

import 'reflect-metadata';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { McpIntentStore } from '@ptah-extension/harness-sync';
import { PluginLoaderService } from '@ptah-extension/agent-sdk';
import type {
  IOutputChannel,
  IStateStorage,
} from '@ptah-extension/platform-core';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  isCapabilityPolicyUnknownError,
  isMcpServerEnabled,
  type CapabilityInventory,
  type EffectiveCapabilitySet,
  type PluginConfigState,
} from '@ptah-extension/shared';
import { createMockLogger } from '@ptah-extension/shared/testing';

import { McpInstallService } from '../mcp-directory/mcp-install.service';
import {
  CapabilityRequestError,
  CapabilityResolverService,
  type CapabilityResolverDependencies,
} from './capability-resolver.service';
import {
  CapabilityToggleStore,
  capabilityPolicyKey,
  capabilityWorkspaceKey,
} from './capability-toggle-store';
import {
  ClaudeApprovalReader,
  type GitRunResult,
  type GitRunner,
} from './claude-approval.reader';

const CONFIG_KEY = 'ptah.plugins.config';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const created: string[] = [];

afterEach(() => {
  jest.restoreAllMocks();
  for (const dir of created.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf-8');
}

function writeJson(file: string, value: unknown): void {
  write(file, JSON.stringify(value, null, 2));
}

/** A git that says "not a work tree": local settings are never trusted. */
const notAGitRepo: GitRunner = async () => ({
  outcome: 'exited',
  code: 128,
  stdout: '',
});

/** A git work tree in which the local settings file is ignored and untracked. */
function gitWith(options: { tracked?: boolean; ignored?: boolean }): GitRunner {
  return async (_cwd, args): Promise<GitRunResult> => {
    if (args[0] === 'rev-parse') {
      return { outcome: 'exited', code: 0, stdout: 'true\n' };
    }
    if (args[0] === 'ls-files') {
      return {
        outcome: 'exited',
        code: 0,
        stdout: options.tracked === true ? '.claude/settings.local.json\0' : '',
      };
    }
    return {
      outcome: 'exited',
      code: options.ignored === false ? 1 : 0,
      stdout: '',
    };
  };
}

/** A plain one-scope storage over a Map; `raw` is the persisted state. */
function createStateStorage(
  stored?: unknown,
): IStateStorage & { raw: Map<string, unknown> } {
  const raw = new Map<string, unknown>();
  if (stored !== undefined) raw.set(CONFIG_KEY, stored);
  return {
    raw,
    get: <T>(key: string, defaultValue?: T): T | undefined =>
      (raw.get(key) as T | undefined) ?? defaultValue,
    update: async (key: string, value: unknown): Promise<void> => {
      raw.set(key, value);
    },
    keys: (): readonly string[] => [...raw.keys()],
  };
}

function createOutput(): IOutputChannel & { lines: string[] } {
  const lines: string[] = [];
  return {
    name: 'test',
    lines,
    appendLine: (message: string) => {
      lines.push(message);
    },
    append: () => undefined,
    clear: () => undefined,
    show: () => undefined,
    hide: () => undefined,
    dispose: () => undefined,
  } as unknown as IOutputChannel & { lines: string[] };
}

interface Env {
  home: string;
  repo: string;
  output: IOutputChannel & { lines: string[] };
  store: CapabilityToggleStore;
  storage: IStateStorage & { raw: Map<string, unknown> };
  loader: PluginLoaderService;
  approvals: ClaudeApprovalReader;
  inventory: McpInstallService;
  resolver: CapabilityResolverService;
  /** Replace the scripted git for the rest of the test. */
  setGit(runner: GitRunner): void;
  /** The physical path of `repo` (8.3 names and junctions expanded). */
  physical(dir?: string): string;
  mkRepo(name: string): string;
  storeDir: string;
}

function setup(
  options: {
    git?: GitRunner;
    storedConfig?: unknown;
    overrides?: Partial<CapabilityResolverDependencies>;
  } = {},
): Env {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-resolver-'));
  created.push(home);
  const mkRepo = (name: string): string => {
    const dir = path.join(home, name);
    fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
    return dir;
  };
  const repo = mkRepo('repo');

  // Plugin root: an opt-in bundled plugin and an opt-out harness plugin.
  const pluginsBase = path.join(home, 'plugins');
  for (const [plugin, skill] of [
    ['ptah-core', 'orchestration'],
    ['ptah-harness-alpha', 'alpha-skill'],
  ]) {
    write(
      path.join(pluginsBase, plugin, 'skills', skill, 'SKILL.md'),
      `---\nname: ${skill}\ndescription: ${skill}\n---\n`,
    );
  }

  const output = createOutput();
  const storeDir = path.join(home, '.ptah', 'capabilities');
  const store = new CapabilityToggleStore(output, storeDir);
  const storage = createStateStorage(options.storedConfig);
  const loader = new PluginLoaderService(
    createMockLogger() as unknown as Logger,
    { isInstalled: () => false, listInstalled: () => [] } as never,
    { getWorkspaceRoot: () => repo } as never,
    store,
  );
  loader.initialize(pluginsBase, storage);

  let git = options.git ?? notAGitRepo;
  const approvals = new ClaudeApprovalReader({
    homeDir: home,
    runGit: (cwd, args) => git(cwd, args),
  });
  const inventory = new McpInstallService(
    null,
    new McpIntentStore(path.join(home, '.ptah', 'mcp-installed.json')),
    { homeDir: home },
  );
  const resolver = new CapabilityResolverService({
    output,
    store,
    inventory,
    approvals,
    plugins: loader,
    homeDir: home,
    ...options.overrides,
  });

  return {
    home,
    repo,
    output,
    store,
    storage,
    loader,
    approvals,
    inventory,
    resolver,
    storeDir,
    mkRepo,
    setGit: (runner) => {
      git = runner;
    },
    physical: (dir = repo) => fs.realpathSync.native(dir),
  };
}

function writeMcpJson(root: string, servers: Record<string, unknown>): void {
  writeJson(path.join(root, '.mcp.json'), { mcpServers: servers });
}

function writeClaudeJson(
  env: Env,
  content: {
    user?: Record<string, unknown>;
    projects?: Record<string, Record<string, unknown>>;
  },
): void {
  writeJson(path.join(env.home, '.claude.json'), {
    ...(content.user === undefined ? {} : { mcpServers: content.user }),
    ...(content.projects === undefined ? {} : { projects: content.projects }),
  });
}

const stdio = { command: 'node', args: ['server.js'] };

function wsKeyOf(env: Env, dir = env.repo): string {
  return capabilityWorkspaceKey(capabilityPolicyKey(env.physical(dir)));
}

function importedPath(env: Env, dir = env.repo): string {
  return path.join(
    env.storeDir,
    'workspaces',
    wsKeyOf(env, dir),
    'imported.json',
  );
}

function readItem(env: Env, kind: string, id: string, dir = env.repo): unknown {
  const file = path.join(
    env.storeDir,
    'workspaces',
    wsKeyOf(env, dir),
    'items',
    `${kind}__l_${id}.json`,
  );
  return JSON.parse(fs.readFileSync(file, 'utf-8'));
}

function entry(inventory: CapabilityInventory, kind: string, id: string) {
  return inventory.entries.find((e) => e.kind === kind && e.id === id);
}

function storedConfig(env: Env): PluginConfigState {
  return env.storage.raw.get(CONFIG_KEY) as PluginConfigState;
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('CapabilityResolverService', () => {
  describe('workspace identity (N7)', () => {
    it('resolves a sub-folder to its repository root', async () => {
      const env = setup();
      const deep = path.join(env.repo, 'src', 'deep');
      fs.mkdirSync(deep, { recursive: true });

      const fromRoot = await env.resolver.resolve(env.repo);
      const fromDeep = await env.resolver.resolve(deep);

      expect(fromDeep.physicalRoot).toBe(env.physical());
      expect(fromDeep.policyKey).toBe(fromRoot.policyKey);
    });

    it('treats a worktree (a `.git` file) as its own root', async () => {
      const env = setup();
      const worktree = path.join(env.repo, 'wt');
      write(path.join(worktree, '.git'), 'gitdir: ../.git/worktrees/wt\n');

      const main = await env.resolver.resolve(env.repo);
      const wt = await env.resolver.resolve(worktree);

      expect(wt.physicalRoot).toBe(env.physical(worktree));
      expect(wt.policyKey).not.toBe(main.policyKey);
    });

    it('does all I/O on the physical path when reached through an alias', async () => {
      const env = setup();
      const alias = path.join(env.home, 'alias');
      fs.symlinkSync(env.repo, alias, 'junction');
      writeMcpJson(env.physical(), { repoonly: stdio });
      writeClaudeJson(env, {
        projects: {
          [env.physical()]: { enabledMcpjsonServers: ['repoonly'] },
        },
      });

      const viaAlias = await env.resolver.resolve(alias);
      const direct = await env.resolver.resolve(env.repo);

      expect(viaAlias.physicalRoot).toBe(env.physical());
      expect(viaAlias.policyKey).toBe(direct.policyKey);
      // The approval keyed by the PHYSICAL root was found through the alias.
      expect(viaAlias.approvedProjectMcpServers).toEqual(['repoonly']);
      expect(viaAlias.status).toBe('verified');
    });

    (process.platform === 'win32' ? it : it.skip)(
      'folds a win32 case alias into one workspace',
      async () => {
        const env = setup();
        const upper = await env.resolver.resolve(env.repo.toUpperCase());
        const lower = await env.resolver.resolve(env.repo.toLowerCase());
        expect(upper.policyKey).toBe(lower.policyKey);
      },
    );

    it('keeps case-distinct roots apart on a case-sensitive platform', async () => {
      const env = setup({
        overrides: { platform: 'linux', realpath: (p) => p },
      });
      const upper = env.mkRepo('Repo');
      const lower = env.mkRepo('repo');
      writeClaudeJson(env, { user: { usr: stdio } });

      await env.resolver.set({
        cwd: upper,
        scope: 'workspace',
        kind: 'mcp',
        id: 'usr',
        enabled: false,
      });

      const a = await env.resolver.resolve(upper);
      const b = await env.resolver.resolve(lower);
      expect(a.policyKey).not.toBe(b.policyKey);
      expect(a.deniedMcpServers).toContain('usr');
      expect(b.deniedMcpServers).not.toContain('usr');
    });
  });

  describe('approval import (Q1, D1)', () => {
    it('imports a ~/.claude.json project entry into the IMPORTED layer', async () => {
      const env = setup();
      writeMcpJson(env.repo, { a: stdio, b: stdio });
      writeClaudeJson(env, {
        projects: { [env.physical()]: { enabledMcpjsonServers: ['a'] } },
      });

      const policy = await env.resolver.resolve(env.repo);

      expect(policy.status).toBe('verified');
      expect(policy.approvedProjectMcpServers).toEqual(['a']);
      expect(policy.deniedMcpServers).toEqual(['b']);
      expect(fs.existsSync(importedPath(env))).toBe(true);
      const list = await env.resolver.list(env.repo);
      expect(entry(list, 'mcp', 'a')?.importedFromClaude).toBe(true);
    });

    it('imports settings.local.json when git reports it ignored and untracked', async () => {
      const env = setup({ git: gitWith({ tracked: false, ignored: true }) });
      writeMcpJson(env.repo, { a: stdio });
      writeJson(path.join(env.repo, '.claude', 'settings.local.json'), {
        enabledMcpjsonServers: ['a'],
      });

      const policy = await env.resolver.resolve(env.repo);
      expect(policy.approvedProjectMcpServers).toEqual(['a']);
    });

    it.each([
      ['tracked', gitWith({ tracked: true })],
      ['not ignored', gitWith({ ignored: false })],
      ['not a git work tree', notAGitRepo],
    ])(
      'does not trust settings.local.json when it is %s',
      async (_label, git) => {
        const env = setup({ git });
        writeMcpJson(env.repo, { a: stdio });
        writeJson(path.join(env.repo, '.claude', 'settings.local.json'), {
          enableAllProjectMcpServers: true,
        });

        const policy = await env.resolver.resolve(env.repo);
        expect(policy.status).toBe('verified');
        expect(policy.deniedMcpServers).toEqual(['a']);
        expect(policy.approvedProjectMcpServers).toEqual([]);
      },
    );

    it('fails closed on a git timeout, publishes nothing, and imports on retry', async () => {
      const env = setup({
        git: async () => ({ outcome: 'failed', reason: 'git timed out' }),
      });
      writeMcpJson(env.repo, { a: stdio });
      const settings = path.join(
        env.physical(),
        '.claude',
        'settings.local.json',
      );
      writeJson(settings, { enabledMcpjsonServers: ['a'] });

      const failed = await env.resolver.resolve(env.repo);
      expect(failed.status).toBe('unverified');
      expect(failed.reasons).toContainEqual({
        path: settings,
        error: 'git timed out',
      });
      expect(isMcpServerEnabled(failed, 'a')).toBe(false);
      expect(fs.existsSync(importedPath(env))).toBe(false);

      env.setGit(gitWith({ tracked: false, ignored: true }));
      const retried = await env.resolver.resolve(env.repo);
      expect(retried.status).toBe('verified');
      expect(retried.approvedProjectMcpServers).toEqual(['a']);
      expect(fs.existsSync(importedPath(env))).toBe(true);
    });

    it('denies every repository server of an untrusted fresh clone', async () => {
      const env = setup();
      writeMcpJson(env.repo, { a: stdio, b: stdio });

      const policy = await env.resolver.resolve(env.repo);

      expect(policy.status).toBe('verified');
      expect(policy.deniedMcpServers).toEqual(['a', 'b']);
      expect(policy.approvedProjectMcpServers).toEqual([]);
      expect(policy.ptahEnabled).toBe(true);
    });

    it('publishes an empty layer when there are no sources at all', async () => {
      const env = setup();

      await env.resolver.resolve(env.repo);

      const doc = JSON.parse(fs.readFileSync(importedPath(env), 'utf-8'));
      expect(doc.entries).toEqual({});
      expect(doc.sources).toEqual([]);
    });

    it('publishes nothing on a source error, and imports on the next resolve', async () => {
      const env = setup();
      writeMcpJson(env.repo, { a: stdio });
      write(path.join(env.home, '.claude.json'), '{ broken');

      const failed = await env.resolver.resolve(env.repo);
      expect(failed.status).toBe('unverified');
      expect(failed.reasons).toContainEqual({
        path: path.join(env.home, '.claude.json'),
        error: 'invalid JSON',
      });
      expect(fs.existsSync(importedPath(env))).toBe(false);

      writeClaudeJson(env, {
        projects: { [env.physical()]: { enabledMcpjsonServers: ['a'] } },
      });
      const retried = await env.resolver.resolve(env.repo);
      expect(retried.status).toBe('verified');
      expect(retried.approvedProjectMcpServers).toEqual(['a']);
    });

    it('keeps a server added to .mcp.json after the import OFF', async () => {
      const env = setup();
      writeMcpJson(env.repo, { a: stdio });
      writeClaudeJson(env, {
        projects: { [env.physical()]: { enableAllProjectMcpServers: true } },
      });
      await env.resolver.resolve(env.repo);

      writeMcpJson(env.repo, { a: stdio, later: stdio });
      const policy = await env.resolver.resolve(env.repo);

      expect(policy.approvedProjectMcpServers).toEqual(['a']);
      expect(policy.deniedMcpServers).toEqual(['later']);
    });

    it('runs one import for two concurrent resolves (single-flight)', async () => {
      const env = setup();
      writeMcpJson(env.repo, { a: stdio });
      const reads = jest.spyOn(env.approvals, 'read');
      const publishes = jest.spyOn(env.store, 'publishImport');

      const [one, two] = await Promise.all([
        env.resolver.resolve(env.repo),
        env.resolver.resolve(env.repo),
      ]);

      expect(reads).toHaveBeenCalledTimes(1);
      expect(publishes).toHaveBeenCalledTimes(1);
      expect(one).toEqual(two);
    });

    it.each([
      ['enableAll', { enableAllProjectMcpServers: true }],
      ['an enabled list', { enabledMcpjsonServers: ['a'] }],
      [
        'both',
        { enableAllProjectMcpServers: true, enabledMcpjsonServers: ['a'] },
      ],
    ])(
      'AC-4.1: a settings.local.json with %s written after imported.json exists changes nothing',
      async (_label, fixture) => {
        const env = setup({ git: gitWith({ tracked: false, ignored: true }) });
        writeMcpJson(env.repo, { a: stdio });
        await env.resolver.resolve(env.repo);
        expect(fs.existsSync(importedPath(env))).toBe(true);

        writeJson(
          path.join(env.repo, '.claude', 'settings.local.json'),
          fixture,
        );
        const policy = await env.resolver.resolve(env.repo);

        expect(policy.status).toBe('verified');
        expect(policy.deniedMcpServers).toEqual(['a']);
        expect(policy.approvedProjectMcpServers).toEqual([]);
      },
    );
  });

  describe('set', () => {
    it('N2: the first set() in a fresh workspace imports first, then the toggle wins', async () => {
      const env = setup();
      writeMcpJson(env.repo, { a: stdio });
      writeClaudeJson(env, {
        projects: { [env.physical()]: { disabledMcpjsonServers: ['a'] } },
      });
      const publish = jest.spyOn(env.store, 'publishImport');
      const writeSpy = jest.spyOn(env.store, 'writeWorkspace');

      const result = await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'mcp',
        id: 'a',
        enabled: true,
      });

      expect(publish).toHaveBeenCalledTimes(1);
      expect(publish.mock.invocationCallOrder[0]).toBeLessThan(
        writeSpy.mock.invocationCallOrder[0],
      );
      const doc = JSON.parse(fs.readFileSync(importedPath(env), 'utf-8'));
      expect(doc.entries).toEqual({ 'mcp:a': 'off' });
      expect(result).toMatchObject({
        effectiveEnabled: true,
        inheritedFrom: 'workspace',
      });
      expect(
        (await env.resolver.resolve(env.repo)).approvedProjectMcpServers,
      ).toEqual(['a']);
    });

    it('keeps a toggle made before a failed import over the later import', async () => {
      const env = setup();
      writeMcpJson(env.repo, { a: stdio });
      write(path.join(env.home, '.claude.json'), '{ broken');

      await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'mcp',
        id: 'a',
        enabled: true,
      });
      expect(fs.existsSync(importedPath(env))).toBe(false);

      writeClaudeJson(env, {
        projects: { [env.physical()]: { disabledMcpjsonServers: ['a'] } },
      });
      const policy = await env.resolver.resolve(env.repo);

      expect(fs.existsSync(importedPath(env))).toBe(true);
      expect(policy.status).toBe('verified');
      expect(policy.approvedProjectMcpServers).toEqual(['a']);
    });

    it('AC-1.2: a toggle in workspace A leaves workspace B alone', async () => {
      const env = setup();
      const other = env.mkRepo('other');
      writeClaudeJson(env, { user: { usr: stdio } });

      await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'mcp',
        id: 'usr',
        enabled: false,
      });

      expect((await env.resolver.resolve(env.repo)).deniedMcpServers).toEqual([
        'usr',
      ]);
      expect((await env.resolver.resolve(other)).deniedMcpServers).toEqual([]);
    });

    it('AC-1.3: turning a server back on writes the inherit tombstone and shows inheriting', async () => {
      const env = setup();
      writeClaudeJson(env, { user: { usr: stdio } });
      const toggle = (enabled: boolean) =>
        env.resolver.set({
          cwd: env.repo,
          scope: 'workspace',
          kind: 'mcp',
          id: 'usr',
          enabled,
        });

      const off = await toggle(false);
      expect(off).toMatchObject({
        workspaceEnabled: false,
        effectiveEnabled: false,
      });

      const on = await toggle(true);
      expect(readItem(env, 'mcp', 'usr')).toMatchObject({ value: 'inherit' });
      expect(on.workspaceEnabled).toBeUndefined();
      expect(on).toMatchObject({
        effectiveEnabled: true,
        inheritedFrom: 'default',
        defaultReason: 'user-scope',
      });
    });

    it('AC-2.3: toggles never touch a user config file or, for a workspace write, the global layer', async () => {
      const env = setup();
      writeMcpJson(env.repo, { a: stdio });
      writeClaudeJson(env, { user: { usr: stdio } });
      write(
        path.join(env.home, '.codex', 'config.toml'),
        '[mcp_servers.cx]\ncommand = "node"\n',
      );
      const files = [
        path.join(env.repo, '.mcp.json'),
        path.join(env.home, '.claude.json'),
        path.join(env.home, '.codex', 'config.toml'),
      ];
      const before = files.map((file) => fs.readFileSync(file));
      await env.store.writeGlobal('mcp', 'cx', 'off');
      const globalBefore = await env.store.readGlobalLayer();

      for (const [id, enabled] of [
        ['a', true],
        ['usr', false],
        ['cx', true],
      ] as const) {
        await env.resolver.set({
          cwd: env.repo,
          scope: 'workspace',
          kind: 'mcp',
          id,
          enabled,
        });
      }

      expect(files.map((file) => fs.readFileSync(file))).toEqual(before);
      expect(await env.store.readGlobalLayer()).toEqual(globalBefore);
    });

    it('a global write touches only the global layer', async () => {
      const env = setup();
      writeClaudeJson(env, { user: { usr: stdio } });

      const result = await env.resolver.set({
        cwd: env.repo,
        scope: 'global',
        kind: 'mcp',
        id: 'usr',
        enabled: false,
      });

      expect(result).toMatchObject({
        globalEnabled: false,
        effectiveEnabled: false,
        inheritedFrom: 'global',
      });
      const ws = await env.store.readWorkspaceItems(wsKeyOf(env));
      expect(ws).toMatchObject({ status: 'ok', items: [] });
    });

    it.each([
      ['mcp', 'nope'],
      ['plugin', 'ptah-nope'],
      ['skill', 'no-such-skill'],
    ] as const)(
      'rejects an unknown %s id and writes nothing',
      async (kind, id) => {
        const env = setup();

        await expect(
          env.resolver.set({
            cwd: env.repo,
            scope: 'workspace',
            kind,
            id,
            enabled: false,
          }),
        ).rejects.toBeInstanceOf(CapabilityRequestError);
        expect(await env.store.readWorkspaceItems(wsKeyOf(env))).toMatchObject({
          items: [],
        });
        expect(env.storage.raw.has(CONFIG_KEY)).toBe(false);
      },
    );

    it('rejects a malformed request', async () => {
      const env = setup();
      await expect(
        env.resolver.set({
          cwd: env.repo,
          scope: 'everywhere',
          kind: 'mcp',
          id: 'a',
          enabled: true,
        } as never),
      ).rejects.toBeInstanceOf(CapabilityRequestError);
    });

    it('N6: setExplicit keeps an ON that equals a same-name Codex-global default, and approves it', async () => {
      const env = setup();
      writeMcpJson(env.repo, { dual: stdio });
      write(
        path.join(env.home, '.codex', 'config.toml'),
        '[mcp_servers.dual]\ncommand = "node"\n',
      );

      // An ordinary toggle normalizes to the tombstone: not an approval.
      await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'mcp',
        id: 'dual',
        enabled: true,
      });
      expect(readItem(env, 'mcp', 'dual')).toMatchObject({ value: 'inherit' });
      expect(
        (await env.resolver.resolve(env.repo)).approvedProjectMcpServers,
      ).toEqual([]);

      await env.resolver.setExplicit(env.repo, 'mcp', 'dual', true);

      expect(readItem(env, 'mcp', 'dual')).toMatchObject({
        value: 'on',
        source: 'install',
      });
      expect(
        (await env.resolver.resolve(env.repo)).approvedProjectMcpServers,
      ).toEqual(['dual']);
    });

    it('B6 carry: a rejecting recordWorkspaceRoot still yields a verified set and a working toggle', async () => {
      const env = setup();
      writeClaudeJson(env, { user: { usr: stdio } });
      const record = jest
        .spyOn(env.store, 'recordWorkspaceRoot')
        .mockRejectedValue(new Error('EACCES'));

      const policy = await env.resolver.resolve(env.repo);
      const toggled = await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'mcp',
        id: 'usr',
        enabled: false,
      });

      expect(record).toHaveBeenCalled();
      expect(policy.status).toBe('verified');
      expect(policy.reasons).toEqual([]);
      expect(toggled.effectiveEnabled).toBe(false);
      expect(
        env.output.lines.some((line) =>
          line.includes('Could not record the workspace root'),
        ),
      ).toBe(true);
    });
  });

  describe('fail closed', () => {
    it('an unreadable .mcp.json makes the policy unverified', async () => {
      const env = setup();
      write(path.join(env.repo, '.mcp.json'), '{ not json');

      const policy = await env.resolver.resolve(env.repo);

      expect(policy.status).toBe('unverified');
      expect(policy.reasons.map((r) => r.path)).toContain(
        path.join(env.physical(), '.mcp.json'),
      );
      expect(policy.ptahEnabled).toBe(true);
      const list = await env.resolver.list(env.repo);
      expect(list.status).toBe('unverified');
      expect(list.entries.every((e) => e.effectiveEnabled === null)).toBe(true);
    });

    it('an unreadable ~/.codex/config.toml (a directory in its place) makes the policy unverified', async () => {
      const env = setup();
      fs.mkdirSync(path.join(env.home, '.codex', 'config.toml'), {
        recursive: true,
      });

      const policy = await env.resolver.resolve(env.repo);

      expect(policy.status).toBe('unverified');
      expect(policy.reasons.map((r) => r.path)).toContain(
        path.join(env.home, '.codex', 'config.toml'),
      );
    });

    it('a corrupt explicit item or imported.json makes the policy unverified', async () => {
      const env = setup();
      await env.resolver.resolve(env.repo);
      const itemPath = path.join(
        env.storeDir,
        'workspaces',
        wsKeyOf(env),
        'items',
        'mcp__l_x.json',
      );
      write(itemPath, '');

      const withItem = await env.resolver.resolve(env.repo);
      expect(withItem.status).toBe('unverified');
      expect(withItem.reasons).toContainEqual({
        path: itemPath,
        error: 'empty file',
      });

      fs.rmSync(itemPath);
      write(importedPath(env), '{ nope');
      const withImport = await env.resolver.resolve(env.repo);
      expect(withImport.status).toBe('unverified');
      expect(withImport.reasons.map((r) => r.path)).toContain(
        importedPath(env),
      );
    });

    it('an unreadable skill/plugin policy is unverified and names the path', async () => {
      const env = setup({ storedConfig: { enabledPluginIds: 'broken' } });

      const policy = await env.resolver.resolve(env.repo);

      expect(policy.status).toBe('unverified');
      expect(policy.reasons.some((r) => r.path.includes(CONFIG_KEY))).toBe(
        true,
      );
      expect(policy.deniedSkillNames).toEqual([]);
      expect(policy.ptahEnabled).toBe(true);
    });

    it('resolve and list never throw: an unexpected failure is unverified', async () => {
      const env = setup({
        overrides: {
          inventory: {
            listDeclarations: () => Promise.reject(new TypeError('boom')),
          },
        },
      });

      const policy = await env.resolver.resolve(env.repo);
      expect(policy.status).toBe('unverified');
      expect(policy.reasons).toEqual([
        { path: env.physical(), error: 'TypeError' },
      ]);
      expect((await env.resolver.list(env.repo)).status).toBe('unverified');
    });

    it('no workspace folder: resolve is unverified and set rejects', async () => {
      const env = setup();
      expect((await env.resolver.resolve('')).status).toBe('unverified');
      await expect(
        env.resolver.set({
          cwd: '',
          scope: 'workspace',
          kind: 'mcp',
          id: 'ptah',
          enabled: false,
        }),
      ).rejects.toBeInstanceOf(CapabilityRequestError);
    });

    it('ptah stays on under an unverified policy unless a readable store says off', async () => {
      const env = setup();
      await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'mcp',
        id: 'ptah',
        enabled: false,
      });
      write(path.join(env.repo, '.mcp.json'), '{ not json');

      const policy = await env.resolver.resolve(env.repo);
      expect(policy.status).toBe('unverified');
      expect(policy.ptahEnabled).toBe(false);
    });
  });

  describe('skills and plugins (P9)', () => {
    it('takes its inputs only from getEffectivePluginConfig', async () => {
      const env = setup();
      // Record the calls the RESOLVER makes. (The loader's own skill scan reads
      // the workspace layer internally for its display-only `invocability`
      // field, which the resolver does not use.)
      const calls: string[] = [];
      const recording = new Proxy(env.loader, {
        get(target, property, receiver) {
          const value: unknown = Reflect.get(target, property, receiver);
          if (typeof value !== 'function') return value;
          return (...args: unknown[]) => {
            calls.push(String(property));
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        },
      });
      const resolver = new CapabilityResolverService({
        output: env.output,
        store: env.store,
        inventory: env.inventory,
        approvals: env.approvals,
        plugins: recording,
        homeDir: env.home,
      });
      const effective = jest.spyOn(env.loader, 'getEffectivePluginConfig');

      await resolver.resolve(env.repo);
      await resolver.list(env.repo);

      expect(effective).toHaveBeenCalledWith(env.physical());
      expect(calls).toContain('getEffectivePluginConfig');
      for (const banned of [
        'resolveCurrentPluginPaths',
        'getDisabledSkillIds',
        'getWorkspacePluginConfig',
      ]) {
        expect(calls).not.toContain(banned);
      }
    });

    it('denies a globally-OFF skill, bare and plugin:skill', async () => {
      const env = setup();
      await env.store.writeGlobal('skill', 'alpha-skill', 'off');

      const policy = await env.resolver.resolve(env.repo);

      expect(policy.deniedSkillNames).toEqual(
        expect.arrayContaining([
          'alpha-skill',
          'ptah-harness-alpha:alpha-skill',
        ]),
      );
      expect(policy.disabledPluginIds).not.toContain('ptah-harness-alpha');
    });

    it('denies the children of a globally-OFF plugin, bare and plugin:skill', async () => {
      const env = setup();
      const before = await env.resolver.resolve(env.repo);
      expect(before.deniedSkillNames).not.toContain('alpha-skill');

      await env.store.writeGlobal('plugin', 'ptah-harness-alpha', 'off');
      const policy = await env.resolver.resolve(env.repo);

      expect(policy.disabledPluginIds).toContain('ptah-harness-alpha');
      expect(policy.deniedSkillNames).toEqual(
        expect.arrayContaining([
          'alpha-skill',
          'ptah-harness-alpha:alpha-skill',
        ]),
      );
      const list = await env.resolver.list(env.repo);
      expect(entry(list, 'skill', 'alpha-skill')).toMatchObject({
        effectiveEnabled: false,
        inheritedFrom: 'parent-plugin',
        parentId: 'ptah-harness-alpha',
      });
      expect(entry(list, 'plugin', 'ptah-harness-alpha')).toMatchObject({
        globalEnabled: false,
        inheritedFrom: 'global',
      });
    });

    it('carries the loader fingerprint', async () => {
      const env = setup();
      const policy = await env.resolver.resolve(env.repo);
      const { fingerprint } = await env.loader.getEffectivePluginConfig(
        env.physical(),
      );
      expect(policy.harnessFingerprint).toBe(fingerprint);
    });

    it('AC-3.1: a workspace plugin toggle writes the workspace PluginConfigState', async () => {
      const env = setup();
      const save = jest.spyOn(env.loader, 'saveWorkspacePluginConfig');

      const result = await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'plugin',
        id: 'ptah-core',
        enabled: true,
      });

      expect(save).toHaveBeenCalledWith(expect.anything(), env.physical());
      expect(storedConfig(env).enabledPluginIds).toEqual(['ptah-core']);
      expect(result).toMatchObject({
        effectiveEnabled: true,
        workspaceEnabled: true,
      });
      expect(
        (await env.resolver.resolve(env.repo)).deniedSkillNames,
      ).not.toContain('ptah-core:orchestration');
    });

    it('a workspace skill ON over a global OFF records enabledSkillIds', async () => {
      const env = setup();
      await env.store.writeGlobal('skill', 'alpha-skill', 'off');

      await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'skill',
        id: 'alpha-skill',
        enabled: true,
      });

      expect(storedConfig(env).enabledSkillIds).toEqual(['alpha-skill']);
      expect(
        (await env.resolver.resolve(env.repo)).deniedSkillNames,
      ).not.toContain('alpha-skill');
    });

    it('(i) an unreadable workspace layer rejects the toggle and leaves the stored config as it was', async () => {
      const broken = { enabledPluginIds: [], disabledSkillIds: 'not-a-list' };
      const env = setup({ storedConfig: broken });

      const attempt = env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'skill',
        id: 'alpha-skill',
        enabled: false,
      });

      const error = await attempt.then(
        () => null,
        (rejection: unknown) => rejection,
      );
      expect(isCapabilityPolicyUnknownError(error)).toBe(true);
      expect(env.storage.raw.get(CONFIG_KEY)).toEqual(broken);
    });

    it('(ii) global X off + workspace X off: toggling Y keeps the workspace X and copies nothing in', async () => {
      const env = setup({
        storedConfig: {
          enabledPluginIds: [],
          disabledSkillIds: [],
          disabledPluginIds: ['ptah-harness-alpha'],
          disabledAgentIds: [],
        },
      });
      await env.store.writeGlobal('plugin', 'ptah-harness-alpha', 'off');
      await env.store.writeGlobal('skill', 'orchestration', 'off');

      await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'plugin',
        id: 'ptah-core',
        enabled: true,
      });

      const saved = storedConfig(env);
      expect(saved.disabledPluginIds).toEqual(['ptah-harness-alpha']);
      expect(saved.enabledPluginIds).toEqual(['ptah-core']);
      // The global-only skill item was not copied into the workspace.
      expect(saved.disabledSkillIds).toEqual([]);
    });

    it('(iii) a global-only item Z stays out of the workspace config when Y is toggled', async () => {
      const env = setup();
      await env.store.writeGlobal('plugin', 'ptah-harness-alpha', 'off');

      await env.resolver.set({
        cwd: env.repo,
        scope: 'workspace',
        kind: 'skill',
        id: 'orchestration',
        enabled: false,
      });

      const saved = storedConfig(env);
      expect(saved.disabledSkillIds).toEqual(['orchestration']);
      expect(saved.disabledPluginIds).toEqual([]);
      expect(saved.enabledPluginIds).toEqual([]);
      expect(saved).not.toHaveProperty('enabledSkillIds');
    });

    it('a global plugin toggle writes only the global layer', async () => {
      const env = setup();

      await env.resolver.set({
        cwd: env.repo,
        scope: 'global',
        kind: 'plugin',
        id: 'ptah-harness-alpha',
        enabled: false,
      });

      expect(env.storage.raw.has(CONFIG_KEY)).toBe(false);
      const global = await env.store.readGlobalLayer();
      expect(global).toMatchObject({
        status: 'ok',
        items: [expect.objectContaining({ kind: 'plugin', value: 'off' })],
      });
    });
  });

  describe('list and resolve parity', () => {
    const combinations: Record<string, (env: Env) => Promise<void>> = {
      'repository servers only': async (env) => {
        writeMcpJson(env.repo, { a: stdio, b: stdio });
      },
      'user and repository servers with an import': async (env) => {
        writeMcpJson(env.repo, { a: stdio, dual: stdio });
        writeClaudeJson(env, {
          user: { usr: stdio, dual: stdio },
          projects: { [env.physical()]: { enabledMcpjsonServers: ['a'] } },
        });
      },
      'explicit items in both layers plus plugin toggles': async (env) => {
        writeMcpJson(env.repo, { a: stdio });
        writeClaudeJson(env, { user: { usr: stdio } });
        await env.store.writeGlobal('mcp', 'usr', 'off');
        await env.store.writeGlobal('plugin', 'ptah-harness-alpha', 'off');
        await env.resolver.set({
          cwd: env.repo,
          scope: 'workspace',
          kind: 'mcp',
          id: 'a',
          enabled: true,
        });
      },
    };

    it.each(Object.keys(combinations))('agrees for %s', async (name) => {
      const env = setup();
      await combinations[name](env);

      const policy: EffectiveCapabilitySet = await env.resolver.resolve(
        env.repo,
      );
      const list = await env.resolver.list(env.repo);

      expect(list.status).toBe(policy.status);
      for (const row of list.entries) {
        if (row.kind === 'mcp') {
          expect(row.effectiveEnabled).toBe(isMcpServerEnabled(policy, row.id));
        } else if (row.kind === 'plugin') {
          expect(policy.disabledPluginIds.includes(row.id)).toBe(
            row.effectiveEnabled === false,
          );
        } else {
          expect(policy.deniedSkillNames.includes(row.id)).toBe(
            row.effectiveEnabled === false,
          );
        }
      }
    });
  });

  describe('back-off', () => {
    it('holds a failing server back in both resolve and list', async () => {
      const env = setup({
        overrides: { backoff: { getBackingOffServers: () => ['usr'] } },
      });
      writeClaudeJson(env, { user: { usr: stdio } });

      const policy = await env.resolver.resolve(env.repo);
      const list = await env.resolver.list(env.repo);

      expect(policy.deniedMcpServers).toEqual(['usr']);
      expect(entry(list, 'mcp', 'usr')).toMatchObject({
        effectiveEnabled: false,
        suppressedByBackoff: true,
      });
    });
  });
});
