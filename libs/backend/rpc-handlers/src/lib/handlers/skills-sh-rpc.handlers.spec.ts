/**
 * Surface + behaviour spec for the shared Skills.sh RPC Handlers.
 *
 * Verifies:
 *   - Method registration covers all six `skillsSh:*` names in order.
 *   - API-first / CLI-fallback path for `search`.
 *   - CLI / curated-constant fallback chain for `getPopular`.
 *   - Curated constants feed `detectRecommended`.
 *   - install/uninstall go through the SOURCE ROOT service and then PROPAGATE,
 *     never `reconcile`, and a propagation failure does not fail the action.
 *   - a hostile `source`, `skillId` or `name` is refused AT THE BOUNDARY, so
 *     nothing traversal-shaped reaches a path join or a spawned process.
 *
 * `SkillsShSourceRootService` is stubbed throughout: the real one writes to
 * `~/.ptah/plugins`, and what this file is about is which calls the handler
 * makes and in what order.
 */

import 'reflect-metadata';

import { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';
import {
  SkillsShSourceRootService,
  type SkillsShMakeGlobalHooks,
  type SkillsShMakeGlobalOutcome,
} from '../skills-sh/skills-sh-source-root.service';
import {
  SKILLS_SH_NO_WORKSPACE_ERROR,
  verifyOwnedRoot,
} from '../skills-sh/skills-sh-source-root';
import type { SkillsShApiClient } from '@ptah-extension/cli-agent-runtime';
import {
  SKILLS_SH_RETIRED_FILE,
  type InstalledSkill,
  type KeptItem,
  type SkillShEntry,
} from '@ptah-extension/shared';
import { resolveHarnessWorkspaceRoot } from '@ptah-extension/harness-sync';
import { RpcUserError } from '@ptah-extension/vscode-core';
import * as fs from 'fs/promises';
import { readdirSync } from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  SkillsShApiClient: class {},
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));

// Only the scratch-dir fetch is faked, and only the real-service block below
// uses it: the third-party CLI must never run in a spec.
const stageSkillsInstallMock = jest.fn();
jest.mock('../utils/skills-sh-cli', () => {
  const actual = jest.requireActual('../utils/skills-sh-cli');
  return {
    ...actual,
    stageSkillsInstall: (...args: unknown[]) => stageSkillsInstallMock(...args),
  };
});
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { STAGED_SKILLS_REL } from '../utils/skills-sh-cli';

type SpawnMock = jest.MockedFunction<typeof spawn>;

interface RegisteredMethod {
  method: string;
  handler: (params: unknown) => Promise<unknown>;
}

class StubRpcHandler {
  readonly registered: RegisteredMethod[] = [];
  registerMethod(
    method: string,
    handler: (params: unknown) => Promise<unknown>,
  ): void {
    this.registered.push({ method, handler });
  }
  async call<T>(method: string, params: unknown = {}): Promise<T> {
    const entry = this.registered.find((r) => r.method === method);
    if (!entry) throw new Error(`Method ${method} not registered`);
    return (await entry.handler(params)) as T;
  }
}

class StubLogger {
  debug = jest.fn();
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
}

class StubWorkspaceProvider {
  constructor(private readonly root?: string) {}
  getWorkspaceRoot(): string | undefined {
    return this.root;
  }
}

class StubApiClient {
  search = jest.fn(async (_q: string, _limit?: number) => [] as SkillShEntry[]);
  invalidateInstallCaches = jest.fn();
}

class StubSourceRoots {
  readonly pluginsBasePath = '/home/user/.ptah/plugins';
  adoptLegacyInstalls = jest.fn(async () => 0);
  install = jest.fn(async () => ({
    success: true as const,
    rootId: 'ptah-skillssh-anthropics-skills',
    slugs: ['frontend-design'],
  }));
  uninstall = jest.fn(async () => ({
    success: true as const,
    rootId: 'ptah-skillssh-anthropics-skills',
    removedRoot: true,
  }));
  listInstalled = jest.fn(async (_ws?: string | null) => []);
  installedSlugs = jest.fn(async (_ws?: string | null) => new Set<string>());
  listRoots = jest.fn(
    async (
      _ws?: string | null,
    ): Promise<Array<{ scope: 'workspace' | 'global'; slugs: string[] }>> => [],
  );
  makeGlobal = jest.fn(
    async (
      _name: string,
      _ws: string | null | undefined,
      _hooks: SkillsShMakeGlobalHooks,
    ): Promise<SkillsShMakeGlobalOutcome> => ({
      success: true,
      rootId: 'ptah-skillssh-anthropics-skills',
      globalRootDir: '/home/user/.ptah/plugins/ptah-skillssh-anthropics-skills',
      convertedSkills: ['frontend-design'],
      resumed: false,
      workspaceRootRemoved: true,
    }),
  );
}

class StubPluginLoader {
  discoverSkillsShPluginPaths = jest.fn((): string[] => []);
}

/** The harness root a `/repo` workspace propagates (8.1). */
const HARNESS_ROOT = resolveHarnessWorkspaceRoot('/repo');

const CLEAN_HEALTH = {
  workspaceRoot: HARNESS_ROOT,
  generatedAt: '2026-01-01T00:00:00.000Z',
  mode: 'full',
  reason: 'test',
  sources: 'ok',
  targets: [],
  collisions: [],
};

class StubPropagation {
  propagateWithReport = jest.fn(
    async (): Promise<{
      health: typeof CLEAN_HEALTH | null;
      userLayer: 'refreshed' | 'failed' | 'skipped';
    }> => ({ health: CLEAN_HEALTH, userLayer: 'refreshed' }),
  );
}

class StubLocalItems {
  keptReport = jest.fn(async (): Promise<KeptItem[]> => []);
}

interface Harness {
  handlers: SkillsShRpcHandlers;
  rpc: StubRpcHandler;
  logger: StubLogger;
  api: StubApiClient;
  sourceRoots: StubSourceRoots;
  propagation: StubPropagation;
  localItems: StubLocalItems;
  pluginLoader: StubPluginLoader;
}

function makeHarness(opts: { workspaceRoot?: string } = {}): Harness {
  const rpc = new StubRpcHandler();
  const logger = new StubLogger();
  const api = new StubApiClient();
  const sourceRoots = new StubSourceRoots();
  const propagation = new StubPropagation();
  const localItems = new StubLocalItems();
  const pluginLoader = new StubPluginLoader();
  const handlers = new SkillsShRpcHandlers(
    logger as unknown as never,
    rpc as unknown as never,
    new StubWorkspaceProvider(opts.workspaceRoot) as unknown as never,
    api as unknown as SkillsShApiClient,
    sourceRoots as unknown as SkillsShSourceRootService,
    propagation as unknown as never,
    localItems as unknown as never,
    pluginLoader as unknown as never,
  );
  handlers.register();
  return {
    handlers,
    rpc,
    logger,
    api,
    sourceRoots,
    propagation,
    localItems,
    pluginLoader,
  };
}

function makeFakeChild(
  stdout: string,
  stderr = '',
  exitCode: number | null = 0,
): EventEmitter & {
  stdout: EventEmitter & { setEncoding: jest.Mock };
  stderr: EventEmitter & { setEncoding: jest.Mock };
  kill: jest.Mock;
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: jest.Mock };
    stderr: EventEmitter & { setEncoding: jest.Mock };
    kill: jest.Mock;
  };
  const stdoutEmitter = new EventEmitter() as EventEmitter & {
    setEncoding: jest.Mock;
  };
  stdoutEmitter.setEncoding = jest.fn();
  const stderrEmitter = new EventEmitter() as EventEmitter & {
    setEncoding: jest.Mock;
  };
  stderrEmitter.setEncoding = jest.fn();
  child.stdout = stdoutEmitter;
  child.stderr = stderrEmitter;
  child.kill = jest.fn();

  setImmediate(() => {
    if (stdout) stdoutEmitter.emit('data', stdout);
    if (stderr) stderrEmitter.emit('data', stderr);
    child.emit('close', exitCode);
  });
  return child;
}

function mockSpawnOnce(stdout: string, stderr = '', exit: number | null = 0) {
  const child = makeFakeChild(stdout, stderr, exit);
  (spawn as SpawnMock).mockReturnValueOnce(child as unknown as never);
}

const apiSkill = (overrides: Partial<SkillShEntry> = {}): SkillShEntry => ({
  source: 'anthropics/skills',
  skillId: 'frontend-design',
  name: 'Frontend Design',
  description: '',
  installs: 100,
  isInstalled: false,
  ...overrides,
});

beforeEach(() => {
  (spawn as SpawnMock).mockReset();
});

describe('SkillsShRpcHandlers (shared) — surface', () => {
  it('exposes the seven skillsSh:* method names in registration order', () => {
    expect([...SkillsShRpcHandlers.METHODS]).toEqual([
      'skillsSh:search',
      'skillsSh:listInstalled',
      'skillsSh:install',
      'skillsSh:uninstall',
      'skillsSh:makeGlobal',
      'skillsSh:getPopular',
      'skillsSh:detectRecommended',
    ]);
  });

  it('registers exactly the METHODS tuple when register() is invoked', () => {
    const h = makeHarness();
    const registeredNames = h.rpc.registered.map((r) => r.method);
    expect(registeredNames).toEqual([...SkillsShRpcHandlers.METHODS]);
  });
});

describe('SkillsShRpcHandlers — search', () => {
  it('uses the API client first without any key gate', async () => {
    const h = makeHarness();
    h.api.search.mockResolvedValue([apiSkill({ skillId: 'react-pro' })]);

    const result = await h.rpc.call<{ skills: SkillShEntry[] }>(
      'skillsSh:search',
      { query: 'react' },
    );

    expect(h.api.search).toHaveBeenCalledWith('react');
    expect(spawn).not.toHaveBeenCalled();
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0].skillId).toBe('react-pro');
  });

  it('falls back to the CLI path when the API throws', async () => {
    const h = makeHarness();
    h.api.search.mockRejectedValue(new Error('429 rate limited'));
    mockSpawnOnce('anthropics/skills@react-pro  100 installs\n');

    const result = await h.rpc.call<{ skills: SkillShEntry[] }>(
      'skillsSh:search',
      { query: 'react' },
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.skills.length).toBeGreaterThan(0);
    expect(h.logger.warn).toHaveBeenCalled();
  });
});

describe('SkillsShRpcHandlers — getPopular', () => {
  it('uses the CLI path first', async () => {
    const h = makeHarness();
    mockSpawnOnce('anthropics/skills@webapp-testing  82000 installs\n');

    const result = await h.rpc.call<{ skills: SkillShEntry[] }>(
      'skillsSh:getPopular',
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.skills.length).toBeGreaterThan(0);
  });

  it('falls back to curated constants when the CLI fails', async () => {
    const h = makeHarness();
    mockSpawnOnce('', '', 1);

    const result = await h.rpc.call<{ skills: SkillShEntry[] }>(
      'skillsSh:getPopular',
    );

    expect(result.skills.length).toBeGreaterThan(0);
  });
});

describe('SkillsShRpcHandlers — detectRecommended', () => {
  it('returns empty detection when no workspace root is available', async () => {
    const h = makeHarness();
    const result = await h.rpc.call<{
      recommendedSkills: SkillShEntry[];
    }>('skillsSh:detectRecommended');
    expect(result.recommendedSkills).toEqual([]);
  });
});

type ActionResult = { success: boolean; error?: string };

describe('SkillsShRpcHandlers — install lands in the source root and propagates', () => {
  it('installs through the source-root service, never the CLI directly', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    const result = await h.rpc.call<ActionResult>('skillsSh:install', {
      source: 'anthropics/skills',
      skillId: 'frontend-design',
    });

    expect(result.success).toBe(true);
    expect(h.sourceRoots.install).toHaveBeenCalledWith(
      { source: 'anthropics/skills', skillId: 'frontend-design' },
      { scope: 'workspace', workspaceRoot: '/repo' },
    );
    expect(spawn).not.toHaveBeenCalled();
    expect(h.api.invalidateInstallCaches).toHaveBeenCalled();
  });

  it('propagates AFTER the write, and only via propagate()', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    await h.rpc.call('skillsSh:install', { source: 'anthropics/skills' });

    expect(h.propagation.propagateWithReport).toHaveBeenCalledWith(
      HARNESS_ROOT,
      'skillsSh:install',
    );
    expect(h.sourceRoots.install.mock.invocationCallOrder[0]).toBeLessThan(
      h.propagation.propagateWithReport.mock.invocationCallOrder[0],
    );
  });

  it('sweeps legacy installs before writing anything new', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    await h.rpc.call('skillsSh:install', { source: 'anthropics/skills' });

    expect(h.sourceRoots.adoptLegacyInstalls).toHaveBeenCalledWith('/repo');
    expect(
      h.sourceRoots.adoptLegacyInstalls.mock.invocationCallOrder[0],
    ).toBeLessThan(h.sourceRoots.install.mock.invocationCallOrder[0]);
  });

  it('does not propagate when there is no workspace to reconcile', async () => {
    const h = makeHarness();

    await h.rpc.call('skillsSh:install', {
      source: 'anthropics/skills',
      scope: 'global',
    });

    expect(h.sourceRoots.install).toHaveBeenCalled();
    expect(h.propagation.propagateWithReport).not.toHaveBeenCalled();
  });

  it('still reports success when propagation fails — the bytes are on disk', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.propagation.propagateWithReport.mockRejectedValue(
      new Error('reconcile exploded'),
    );

    const result = await h.rpc.call<ActionResult>('skillsSh:install', {
      source: 'anthropics/skills',
    });

    expect(result.success).toBe(true);
    expect(h.logger.warn).toHaveBeenCalled();
    // Primary success, failed pass after it (8.10a).
    expect(result).toMatchObject({ libraryPass: 'failed' });
  });

  it('does not propagate when the install itself failed', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.sourceRoots.install.mockResolvedValue({
      success: false,
      error: 'network down',
    } as unknown as never);

    const result = await h.rpc.call<ActionResult>('skillsSh:install', {
      source: 'anthropics/skills',
    });

    expect(result).toEqual({ success: false, error: 'network down' });
    expect(h.propagation.propagateWithReport).not.toHaveBeenCalled();
    // A primary failure carries no kept report (8.10).
    expect(h.localItems.keptReport).not.toHaveBeenCalled();
  });

  it('logs the failure reason, so a failed install is diagnosable from the log', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.sourceRoots.install.mockResolvedValue({
      success: false,
      error: 'CLI timed out after 120000ms',
    } as unknown as never);

    await h.rpc.call('skillsSh:install', {
      source: 'anthropics/skills',
      skillId: 'webapp-testing',
    });

    expect(h.logger.warn).toHaveBeenCalledWith('RPC: skillsSh:install failed', {
      source: 'anthropics/skills',
      skillId: 'webapp-testing',
      error: 'CLI timed out after 120000ms',
    });
  });
});

describe('SkillsShRpcHandlers — install reports kept local items (TASK_2026_701 B12)', () => {
  const keptItem: KeptItem = {
    approvalId: '7f1c0a52-3b7e-4b8a-9f43-2a1d5c6e7f80',
    family: 'skills-sh',
    target: 'claude',
    relPath: '.claude/skills/frontend-design',
    reason: 'owned-edited',
  };

  it('asks for the kept report of THIS install, at the harness root', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    await h.rpc.call('skillsSh:install', { source: 'anthropics/skills' });

    expect(h.localItems.keptReport).toHaveBeenCalledWith({
      harnessRoot: HARNESS_ROOT,
      sourceRef: 'skills-sh:ptah-skillssh-anthropics-skills',
      slugs: { skills: ['frontend-design'], commands: [], agents: [] },
      health: CLEAN_HEALTH,
      fileFamily: 'skills-sh',
    });
  });

  it('returns the kept items and an updated Library pass', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.localItems.keptReport.mockResolvedValue([keptItem]);

    const result = await h.rpc.call<{
      success: boolean;
      kept?: KeptItem[];
      libraryPass?: string;
    }>('skillsSh:install', { source: 'anthropics/skills' });

    expect(result).toEqual({
      success: true,
      kept: [keptItem],
      libraryPass: 'updated',
    });
  });

  it('reports libraryPass failed when the user-layer refresh failed', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.propagation.propagateWithReport.mockResolvedValue({
      health: CLEAN_HEALTH,
      userLayer: 'failed',
    });

    const result = await h.rpc.call<{ success: boolean; libraryPass?: string }>(
      'skillsSh:install',
      { source: 'anthropics/skills' },
    );

    expect(result).toMatchObject({ success: true, libraryPass: 'failed' });
  });

  it('still succeeds with no kept items when the report itself fails', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.localItems.keptReport.mockRejectedValue(new Error('scan exploded'));

    const result = await h.rpc.call<{ success: boolean; kept?: KeptItem[] }>(
      'skillsSh:install',
      { source: 'anthropics/skills' },
    );

    expect(result).toMatchObject({ success: true, kept: [] });
  });

  it('reports nothing when there is no workspace', async () => {
    const h = makeHarness();

    const result = await h.rpc.call<{ success: boolean; kept?: KeptItem[] }>(
      'skillsSh:install',
      { source: 'anthropics/skills', scope: 'global' },
    );

    expect(result).toMatchObject({ success: true, kept: [] });
    expect(h.localItems.keptReport).not.toHaveBeenCalled();
  });
});

describe('SkillsShRpcHandlers — uninstall reaps', () => {
  it('removes from the source root and propagates so the reap sweep runs', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    const result = await h.rpc.call<ActionResult>('skillsSh:uninstall', {
      name: 'frontend-design',
    });

    expect(result.success).toBe(true);
    expect(h.sourceRoots.uninstall).toHaveBeenCalledWith('frontend-design', {
      scope: 'global',
    });
    expect(h.propagation.propagateWithReport).toHaveBeenCalledWith(
      HARNESS_ROOT,
      'skillsSh:uninstall',
    );
    expect(h.sourceRoots.uninstall.mock.invocationCallOrder[0]).toBeLessThan(
      h.propagation.propagateWithReport.mock.invocationCallOrder[0],
    );
    expect(h.api.invalidateInstallCaches).toHaveBeenCalled();
  });

  it('does not propagate when the skill was not installed', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.sourceRoots.uninstall.mockResolvedValue({
      success: false,
      error: 'No skills.sh skill named "ghost" is installed.',
    } as unknown as never);

    const result = await h.rpc.call<ActionResult>('skillsSh:uninstall', {
      name: 'ghost',
    });

    expect(result.success).toBe(false);
    expect(h.propagation.propagateWithReport).not.toHaveBeenCalled();
  });
});

/**
 * These values reach BOTH a `path.join` and a spawned process argv, so a
 * rejection here is the difference between a bad request and a write outside
 * `~/.ptah/plugins`. The refactor moved the code that enforced it; this block
 * is what stops it from moving again unnoticed.
 */
describe('SkillsShRpcHandlers — hostile input is refused at the boundary', () => {
  it.each([
    ['traversal in the owner half', '../../../../etc'],
    ['traversal as both halves', '../..'],
    ['an absolute path', '/etc/passwd'],
    ['a backslash separator', 'owner\\..\\..\\repo'],
    ['a shell metacharacter', 'owner/repo; rm -rf ~'],
    ['a flag-shaped source', '--global'],
    ['an empty source', ''],
  ])('rejects %s without touching the source roots', async (_label, source) => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    const result = await h.rpc.call<ActionResult>('skillsSh:install', {
      source,
    });

    expect(result.success).toBe(false);
    expect(h.sourceRoots.install).not.toHaveBeenCalled();
    expect(h.propagation.propagateWithReport).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it.each([
    ['traversal', '../../evil'],
    ['a bare dot-dot', '..'],
    ['a path separator', 'a/b'],
    ['a shell metacharacter', 'design && curl evil.sh'],
  ])('rejects %s as a skillId', async (_label, skillId) => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    const result = await h.rpc.call<ActionResult>('skillsSh:install', {
      source: 'anthropics/skills',
      skillId,
    });

    expect(result.success).toBe(false);
    expect(h.sourceRoots.install).not.toHaveBeenCalled();
  });

  it.each([
    ['traversal', '../../../.ssh'],
    ['a bare dot-dot', '..'],
    ['a single dot', '.'],
    ['a path separator', 'skills/frontend-design'],
  ])('rejects %s as an uninstall name', async (_label, name) => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    const result = await h.rpc.call<ActionResult>('skillsSh:uninstall', {
      name,
    });

    expect(result.success).toBe(false);
    expect(h.sourceRoots.uninstall).not.toHaveBeenCalled();
  });
});

describe('SkillsShRpcHandlers — install scope (TASK_2026_853 D-3)', () => {
  it('defaults to THIS workspace when no scope is sent', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.sourceRoots.install.mockResolvedValue({
      success: true,
      rootId: 'ptah-skillssh-anthropics-skills',
      rootDir: '/repo/.ptah/plugins/ptah-skillssh-anthropics-skills',
      scope: 'workspace',
      slugs: ['frontend-design'],
    } as unknown as never);

    const result = await h.rpc.call<{ success: boolean; scope?: string }>(
      'skillsSh:install',
      { source: 'anthropics/skills' },
    );

    expect(h.sourceRoots.install).toHaveBeenCalledWith(
      { source: 'anthropics/skills', skillId: undefined },
      { scope: 'workspace', workspaceRoot: '/repo' },
    );
    expect(result).toMatchObject({ success: true, scope: 'workspace' });
  });

  it('refuses a workspace install with no folder open: fixed RpcUserError, nothing touched', async () => {
    const h = makeHarness();

    const call = h.rpc.call('skillsSh:install', {
      source: 'anthropics/skills',
    });

    await expect(call).rejects.toBeInstanceOf(RpcUserError);
    await expect(call).rejects.toMatchObject({
      message: SKILLS_SH_NO_WORKSPACE_ERROR,
      errorCode: 'WORKSPACE_NOT_OPEN',
    });
    expect(h.sourceRoots.adoptLegacyInstalls).not.toHaveBeenCalled();
    expect(h.sourceRoots.install).not.toHaveBeenCalled();
    expect(h.propagation.propagateWithReport).not.toHaveBeenCalled();
  });

  it('refuses an explicit workspace install with no folder open the same way', async () => {
    const h = makeHarness();

    await expect(
      h.rpc.call('skillsSh:install', {
        source: 'anthropics/skills',
        scope: 'workspace',
      }),
    ).rejects.toMatchObject({ errorCode: 'WORKSPACE_NOT_OPEN' });
    expect(h.sourceRoots.install).not.toHaveBeenCalled();
  });

  it('installs globally only on an explicit global scope, folder or not', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    await h.rpc.call('skillsSh:install', {
      source: 'anthropics/skills',
      scope: 'global',
    });

    expect(h.sourceRoots.install).toHaveBeenCalledWith(
      { source: 'anthropics/skills', skillId: undefined },
      { scope: 'global' },
    );
  });

  it('rejects an unknown scope at the boundary', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    const result = await h.rpc.call<ActionResult>('skillsSh:install', {
      source: 'anthropics/skills',
      scope: 'project',
    });

    expect(result.success).toBe(false);
    expect(h.sourceRoots.install).not.toHaveBeenCalled();
  });
});

describe('SkillsShRpcHandlers — list and uninstall resolve the true scope', () => {
  it('lists the global roots plus THIS workspace', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    await h.rpc.call('skillsSh:listInstalled', {});

    expect(h.sourceRoots.listInstalled).toHaveBeenCalledWith('/repo');
  });

  it('lists only global roots with no folder open', async () => {
    const h = makeHarness();

    await h.rpc.call('skillsSh:listInstalled', {});

    expect(h.sourceRoots.listInstalled).toHaveBeenCalledWith(null);
  });

  it('uninstalls from the workspace root when it holds the skill', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.sourceRoots.listRoots.mockResolvedValue([
      { scope: 'global', slugs: ['other'] },
      { scope: 'workspace', slugs: ['frontend-design'] },
    ]);

    await h.rpc.call('skillsSh:uninstall', { name: 'frontend-design' });

    expect(h.sourceRoots.listRoots).toHaveBeenCalledWith('/repo');
    expect(h.sourceRoots.uninstall).toHaveBeenCalledWith('frontend-design', {
      scope: 'workspace',
      workspaceRoot: '/repo',
    });
  });

  it('uninstalls from the global root when only it holds the skill', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.sourceRoots.listRoots.mockResolvedValue([
      { scope: 'global', slugs: ['frontend-design'] },
      { scope: 'workspace', slugs: ['other'] },
    ]);

    await h.rpc.call('skillsSh:uninstall', { name: 'frontend-design' });

    expect(h.sourceRoots.uninstall).toHaveBeenCalledWith('frontend-design', {
      scope: 'global',
    });
  });
});

describe('SkillsShRpcHandlers — makeGlobal delegates to the proven service', () => {
  it('passes the name, the open workspace and the hooks; success invalidates caches', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });

    const result = await h.rpc.call('skillsSh:makeGlobal', {
      name: 'frontend-design',
    });

    expect(result).toEqual({
      success: true,
      convertedSkills: ['frontend-design'],
    });
    expect(h.sourceRoots.makeGlobal).toHaveBeenCalledWith(
      'frontend-design',
      '/repo',
      expect.objectContaining({
        propagate: expect.any(Function),
        isDiscovered: expect.any(Function),
      }),
    );
    expect(h.api.invalidateInstallCaches).toHaveBeenCalled();
  });

  it('answers a service failure with its fixed copy and logs the code', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    h.sourceRoots.makeGlobal.mockResolvedValue({
      success: false,
      code: 'propagation-failed',
      error: 'Could not change where frontend-design is installed.',
      rollbackComplete: true,
    });

    const result = await h.rpc.call('skillsSh:makeGlobal', {
      name: 'frontend-design',
    });

    expect(result).toEqual({
      success: false,
      error: 'Could not change where frontend-design is installed.',
    });
    expect(h.logger.warn).toHaveBeenCalledWith(
      'RPC: skillsSh:makeGlobal refused or failed',
      expect.objectContaining({ code: 'propagation-failed' }),
    );
    expect(h.api.invalidateInstallCaches).not.toHaveBeenCalled();
  });

  it('never leaks an unexpected error: fixed copy out, cause logged', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    const cause = new Error('EACCES /home/user/.ptah/plugins');
    h.sourceRoots.makeGlobal.mockRejectedValue(cause);

    const result = await h.rpc.call('skillsSh:makeGlobal', {
      name: 'frontend-design',
    });

    expect(result).toEqual({
      success: false,
      error: 'Could not change where frontend-design is installed.',
    });
    expect(h.logger.error).toHaveBeenCalledWith(
      'RPC: skillsSh:makeGlobal failed',
      cause,
    );
  });

  it.each([['..'], ['a/b'], ['../../x']])(
    'refuses the name %p before the service runs',
    async (name) => {
      const h = makeHarness({ workspaceRoot: '/repo' });

      const result = await h.rpc.call<ActionResult>('skillsSh:makeGlobal', {
        name,
      });

      expect(result.success).toBe(false);
      expect(result.error).not.toContain(name);
      expect(h.sourceRoots.makeGlobal).not.toHaveBeenCalled();
    },
  );

  it('propagate hook: single entry point; refreshed only when health exists and the user layer refreshed', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    await h.rpc.call('skillsSh:makeGlobal', { name: 'frontend-design' });
    const hooks = h.sourceRoots.makeGlobal.mock.calls[0][2];

    await expect(hooks.propagate('register')).resolves.toEqual({
      userLayerRefreshed: true,
    });
    expect(h.propagation.propagateWithReport).toHaveBeenLastCalledWith(
      HARNESS_ROOT,
      'skillsSh:makeGlobal',
    );

    h.propagation.propagateWithReport.mockResolvedValueOnce({
      health: CLEAN_HEALTH,
      userLayer: 'failed',
    });
    await expect(hooks.propagate('register')).resolves.toEqual({
      userLayerRefreshed: false,
    });

    h.propagation.propagateWithReport.mockResolvedValueOnce({
      health: null,
      userLayer: 'refreshed',
    });
    await expect(hooks.propagate('register')).resolves.toEqual({
      userLayerRefreshed: false,
    });

    // A rejection is the step-6 failure signal: it must reach the service.
    h.propagation.propagateWithReport.mockRejectedValueOnce(new Error('boom'));
    await expect(hooks.propagate('register')).rejects.toThrow('boom');
  });

  it('isDiscovered hook asks the plugin loader', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    await h.rpc.call('skillsSh:makeGlobal', { name: 'frontend-design' });
    const hooks = h.sourceRoots.makeGlobal.mock.calls[0][2];
    const dir = '/home/user/.ptah/plugins/ptah-skillssh-anthropics-skills';

    expect(await hooks.isDiscovered(dir)).toBe(false);
    h.pluginLoader.discoverSkillsShPluginPaths.mockReturnValue([dir]);
    expect(await hooks.isDiscovered(dir)).toBe(true);
  });
});

/**
 * The same handler over the REAL source-root service in temp directories,
 * so the acceptance rules are observed on disk: where an install lands, when
 * the retired id clears, and that the workspace root stays the active install
 * through a failed conversion and a retry. Never the real home directory.
 */
describe('SkillsShRpcHandlers — real source roots (D-3 acceptance)', () => {
  jest.setTimeout(30_000);

  const ROOT_ID = 'ptah-skillssh-anthropics-skills';
  let tmp: string;
  let homeDir: string;
  let ws: string;

  const globalPlugins = (): string => path.join(homeDir, '.ptah', 'plugins');
  const globalRoot = (): string => path.join(globalPlugins(), ROOT_ID);
  const workspaceRoot = (): string =>
    path.join(ws, '.ptah', 'plugins', ROOT_ID);
  const exists = async (p: string): Promise<boolean> =>
    fs.access(p).then(
      () => true,
      () => false,
    );

  function stageWrites(slugs: string[]): void {
    stageSkillsInstallMock.mockImplementation(
      async (_request: unknown, stagingDir: string) => {
        for (const slug of slugs) {
          const dir = path.join(stagingDir, ...STAGED_SKILLS_REL, slug);
          await fs.mkdir(dir, { recursive: true });
          await fs.writeFile(
            path.join(dir, 'SKILL.md'),
            `---\nname: ${slug}\ndescription: ${slug}\n---\n`,
            'utf8',
          );
        }
        return { success: true };
      },
    );
  }

  async function writeRetired(): Promise<void> {
    await fs.mkdir(globalPlugins(), { recursive: true });
    await fs.writeFile(
      path.join(globalPlugins(), SKILLS_SH_RETIRED_FILE),
      JSON.stringify({
        version: 1,
        roots: { [ROOT_ID]: { retiredAt: '2026-10-01T00:00:00.000Z' } },
      }),
      'utf8',
    );
  }

  async function retiredIds(): Promise<string[]> {
    try {
      const raw = JSON.parse(
        await fs.readFile(
          path.join(globalPlugins(), SKILLS_SH_RETIRED_FILE),
          'utf8',
        ),
      ) as { roots: Record<string, unknown> };
      return Object.keys(raw.roots);
    } catch {
      return [];
    }
  }

  /** A loader stand-in that lists global `ptah-skillssh-*` dirs on disk. */
  function diskLoader(): StubPluginLoader {
    const loader = new StubPluginLoader();
    loader.discoverSkillsShPluginPaths.mockImplementation(() => {
      try {
        return readdirSync(globalPlugins())
          .filter((entry) => entry.startsWith('ptah-skillssh-'))
          .map((entry) => path.join(globalPlugins(), entry));
      } catch {
        return [];
      }
    });
    return loader;
  }

  function makeReal(): {
    rpc: StubRpcHandler;
    propagation: StubPropagation;
    loader: StubPluginLoader;
  } {
    const rpc = new StubRpcHandler();
    const logger = new StubLogger();
    const propagation = new StubPropagation();
    const loader = diskLoader();
    const service = new SkillsShSourceRootService(
      logger as unknown as never,
      homeDir,
    );
    new SkillsShRpcHandlers(
      logger as unknown as never,
      rpc as unknown as never,
      new StubWorkspaceProvider(ws) as unknown as never,
      new StubApiClient() as unknown as SkillsShApiClient,
      service,
      propagation as unknown as never,
      new StubLocalItems() as unknown as never,
      loader as unknown as never,
    ).register();
    return { rpc, propagation, loader };
  }

  const list = async (rpc: StubRpcHandler): Promise<InstalledSkill[]> =>
    (await rpc.call<{ skills: InstalledSkill[] }>('skillsSh:listInstalled', {}))
      .skills;

  async function expectWorkspaceActive(rpc: StubRpcHandler): Promise<void> {
    expect((await verifyOwnedRoot(workspaceRoot())).status).toBe('owned');
    expect(await exists(globalRoot())).toBe(false);
    expect(await list(rpc)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'a', scope: 'workspace' }),
      ]),
    );
  }

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skillssh-rpc-spec-'));
    homeDir = path.join(tmp, 'home');
    ws = path.join(tmp, 'ws');
    await fs.mkdir(homeDir, { recursive: true });
    await fs.mkdir(ws, { recursive: true });
    stageSkillsInstallMock.mockReset();
  });

  afterEach(async () => {
    await fs.rm(tmp, { recursive: true, force: true });
  });

  it('a default install lands in the workspace root and lists as workspace', async () => {
    const { rpc } = makeReal();
    stageWrites(['a']);

    const result = await rpc.call('skillsSh:install', {
      source: 'anthropics/skills',
    });

    expect(result).toMatchObject({ success: true, scope: 'workspace' });
    expect(await exists(path.join(workspaceRoot(), 'skills', 'a'))).toBe(true);
    expect(await exists(globalRoot())).toBe(false);
    expect(await list(rpc)).toEqual([
      expect.objectContaining({ name: 'a', scope: 'workspace' }),
    ]);
  });

  it('an explicit global install clears the retired id only after a successful write', async () => {
    const { rpc } = makeReal();
    await writeRetired();
    stageSkillsInstallMock.mockResolvedValueOnce({
      success: false,
      error: 'network down',
    });

    const failed = await rpc.call<ActionResult>('skillsSh:install', {
      source: 'anthropics/skills',
      scope: 'global',
    });
    expect(failed.success).toBe(false);
    expect(await retiredIds()).toEqual([ROOT_ID]);

    stageWrites(['a']);
    const ok = await rpc.call('skillsSh:install', {
      source: 'anthropics/skills',
      scope: 'global',
    });
    expect(ok).toMatchObject({ success: true, scope: 'global' });
    expect(await retiredIds()).toEqual([]);
    expect(await list(rpc)).toEqual([
      expect.objectContaining({ name: 'a', scope: 'global' }),
    ]);
  });

  it('makeGlobal keeps the workspace root active when the user layer is not refreshed, and a retry converts the whole root', async () => {
    const { rpc, propagation } = makeReal();
    stageWrites(['a', 'b']);
    await rpc.call('skillsSh:install', { source: 'anthropics/skills' });

    const workspaceDuringRegister: boolean[] = [];
    propagation.propagateWithReport.mockImplementation(async () => {
      workspaceDuringRegister.push(await exists(workspaceRoot()));
      return { health: CLEAN_HEALTH, userLayer: 'failed' };
    });

    const failed = await rpc.call('skillsSh:makeGlobal', { name: 'a' });

    expect(failed).toEqual({
      success: false,
      error: 'Could not change where a is installed.',
    });
    expect(workspaceDuringRegister[0]).toBe(true);
    await expectWorkspaceActive(rpc);

    propagation.propagateWithReport.mockImplementation(async () => ({
      health: CLEAN_HEALTH,
      userLayer: 'refreshed',
    }));
    const retry = await rpc.call('skillsSh:makeGlobal', { name: 'a' });

    expect(retry).toEqual({ success: true, convertedSkills: ['a', 'b'] });
    expect(await exists(workspaceRoot())).toBe(false);
    const proof = await verifyOwnedRoot(globalRoot());
    expect(proof.status === 'owned' && proof.metadata.scope).toBe('global');
    const listed = await list(rpc);
    expect(listed.map((s) => [s.name, s.scope])).toEqual([
      ['a', 'global'],
      ['b', 'global'],
    ]);
  });

  it('makeGlobal keeps the workspace root active when the loader does not discover the global root, and a retry succeeds', async () => {
    const { rpc, loader } = makeReal();
    stageWrites(['a']);
    await rpc.call('skillsSh:install', { source: 'anthropics/skills' });
    loader.discoverSkillsShPluginPaths.mockReturnValueOnce([]);

    const failed = await rpc.call<ActionResult>('skillsSh:makeGlobal', {
      name: 'a',
    });

    expect(failed).toEqual({
      success: false,
      error: 'Could not change where a is installed.',
    });
    await expectWorkspaceActive(rpc);

    const retry = await rpc.call('skillsSh:makeGlobal', { name: 'a' });
    expect(retry).toEqual({ success: true, convertedSkills: ['a'] });
    expect(await exists(workspaceRoot())).toBe(false);
  });

  it('uninstall removes from the root that really holds the skill', async () => {
    const { rpc } = makeReal();
    stageWrites(['a']);
    await rpc.call('skillsSh:install', { source: 'anthropics/skills' });
    stageWrites(['g']);
    await rpc.call('skillsSh:install', {
      source: 'other/repo',
      scope: 'global',
    });
    const otherGlobal = path.join(globalPlugins(), 'ptah-skillssh-other-repo');
    expect(await exists(otherGlobal)).toBe(true);

    await rpc.call('skillsSh:uninstall', { name: 'g' });
    expect(await exists(otherGlobal)).toBe(false);
    expect(await exists(workspaceRoot())).toBe(true);

    await rpc.call('skillsSh:uninstall', { name: 'a' });
    expect(await exists(workspaceRoot())).toBe(false);
    expect(await list(rpc)).toEqual([]);
  });
});
