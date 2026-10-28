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
import type { SkillsShSourceRootService } from '../skills-sh/skills-sh-source-root.service';
import type { SkillsShApiClient } from '@ptah-extension/cli-agent-runtime';
import type { KeptItem, SkillShEntry } from '@ptah-extension/shared';
import { resolveHarnessWorkspaceRoot } from '@ptah-extension/harness-sync';

jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  SkillsShApiClient: class {},
}));

jest.mock('child_process', () => ({
  spawn: jest.fn(),
}));
import { spawn } from 'child_process';
import { EventEmitter } from 'events';

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
  listInstalled = jest.fn(async () => []);
  installedSlugs = jest.fn(async () => new Set<string>());
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
}

function makeHarness(opts: { workspaceRoot?: string } = {}): Harness {
  const rpc = new StubRpcHandler();
  const logger = new StubLogger();
  const api = new StubApiClient();
  const sourceRoots = new StubSourceRoots();
  const propagation = new StubPropagation();
  const localItems = new StubLocalItems();
  const handlers = new SkillsShRpcHandlers(
    logger as unknown as never,
    rpc as unknown as never,
    new StubWorkspaceProvider(opts.workspaceRoot) as unknown as never,
    api as unknown as SkillsShApiClient,
    sourceRoots as unknown as SkillsShSourceRootService,
    propagation as unknown as never,
    localItems as unknown as never,
  );
  handlers.register();
  return { handlers, rpc, logger, api, sourceRoots, propagation, localItems };
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
  it('exposes the six skillsSh:* method names in registration order', () => {
    expect([...SkillsShRpcHandlers.METHODS]).toEqual([
      'skillsSh:search',
      'skillsSh:listInstalled',
      'skillsSh:install',
      'skillsSh:uninstall',
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
    expect(h.sourceRoots.install).toHaveBeenCalledWith({
      source: 'anthropics/skills',
      skillId: 'frontend-design',
    });
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

    await h.rpc.call('skillsSh:install', { source: 'anthropics/skills' });

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
      { source: 'anthropics/skills' },
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
    expect(h.sourceRoots.uninstall).toHaveBeenCalledWith('frontend-design');
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
