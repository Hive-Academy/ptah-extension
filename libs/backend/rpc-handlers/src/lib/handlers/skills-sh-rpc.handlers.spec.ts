/**
 * Surface + behaviour spec for the shared Skills.sh RPC Handlers.
 *
 * Verifies:
 *   - Method registration covers all six `skillsSh:*` names in order.
 *   - API-first / CLI-fallback path for `search`.
 *   - CLI / curated-constant fallback chain for `getPopular`.
 *   - Curated constants feed `detectRecommended`.
 */

import 'reflect-metadata';

import { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';
import type { SkillsShApiClient } from '@ptah-extension/cli-agent-runtime';
import type { SkillShEntry } from '@ptah-extension/shared';

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

interface Harness {
  handlers: SkillsShRpcHandlers;
  rpc: StubRpcHandler;
  logger: StubLogger;
  api: StubApiClient;
}

function makeHarness(opts: { workspaceRoot?: string } = {}): Harness {
  const rpc = new StubRpcHandler();
  const logger = new StubLogger();
  const api = new StubApiClient();
  const handlers = new SkillsShRpcHandlers(
    logger as unknown as never,
    rpc as unknown as never,
    new StubWorkspaceProvider(opts.workspaceRoot) as unknown as never,
    api as unknown as SkillsShApiClient,
  );
  handlers.register();
  return { handlers, rpc, logger, api };
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

describe('SkillsShRpcHandlers — install/uninstall cache invalidation', () => {
  it('invalidates the API client install caches after install', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    mockSpawnOnce('', '', 0);

    await h.rpc.call('skillsSh:install', {
      source: 'anthropics/skills',
      skillId: 'frontend-design',
      scope: 'project',
    });

    expect(h.api.invalidateInstallCaches).toHaveBeenCalled();
  });

  it('invalidates the API client install caches after uninstall', async () => {
    const h = makeHarness({ workspaceRoot: '/repo' });
    mockSpawnOnce('', '', 0);

    await h.rpc.call('skillsSh:uninstall', {
      name: 'frontend-design',
      scope: 'project',
    });

    expect(h.api.invalidateInstallCaches).toHaveBeenCalled();
  });
});
