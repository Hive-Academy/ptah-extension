/**
 * Surface + behaviour spec for the shared Skills.sh RPC Handlers.
 *
 * Verifies:
 *   - Method registration covers all nine `skillsSh:*` names in order.
 *   - API-first / CLI-fallback path for `search` and `getPopular`.
 *   - Curated API pool feeds `detectRecommended` when a key is present.
 *   - SecretStorage-backed key management methods round-trip correctly.
 */

import 'reflect-metadata';

import { SkillsShRpcHandlers } from './skills-sh-rpc.handlers';
import { SECRET_KEY } from './skills-sh-rpc.schema';
import type { SkillsShApiClient } from './skills-sh-api-client';
import type { SkillShEntry } from '@ptah-extension/shared';

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

class StubSecretStorage {
  readonly store_ = new Map<string, string>();
  get = jest.fn(async (key: string) => this.store_.get(key));
  store = jest.fn(async (key: string, value: string) => {
    this.store_.set(key, value);
  });
  delete = jest.fn(async (key: string) => {
    this.store_.delete(key);
  });
  onDidChange = jest.fn();
}

class StubApiClient {
  hasKey = jest.fn(async () => false);
  search = jest.fn(async (_q: string, _limit?: number) => [] as SkillShEntry[]);
  getPopular = jest.fn(async (_v?: string) => [] as SkillShEntry[]);
  getCurated = jest.fn(async () => [] as SkillShEntry[]);
  invalidateInstallCaches = jest.fn();
}

interface Harness {
  handlers: SkillsShRpcHandlers;
  rpc: StubRpcHandler;
  logger: StubLogger;
  secrets: StubSecretStorage;
  api: StubApiClient;
}

function makeHarness(opts: { workspaceRoot?: string } = {}): Harness {
  const rpc = new StubRpcHandler();
  const logger = new StubLogger();
  const secrets = new StubSecretStorage();
  const api = new StubApiClient();
  const handlers = new SkillsShRpcHandlers(
    logger as unknown as never,
    rpc as unknown as never,
    new StubWorkspaceProvider(opts.workspaceRoot) as unknown as never,
    secrets as unknown as never,
    api as unknown as SkillsShApiClient,
  );
  handlers.register();
  return { handlers, rpc, logger, secrets, api };
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
  it('exposes the nine skillsSh:* method names in registration order', () => {
    expect([...SkillsShRpcHandlers.METHODS]).toEqual([
      'skillsSh:search',
      'skillsSh:listInstalled',
      'skillsSh:install',
      'skillsSh:uninstall',
      'skillsSh:getPopular',
      'skillsSh:detectRecommended',
      'skillsSh:setApiKey',
      'skillsSh:getApiKeyStatus',
      'skillsSh:deleteApiKey',
    ]);
  });

  it('registers exactly the METHODS tuple when register() is invoked', () => {
    const h = makeHarness();
    const registeredNames = h.rpc.registered.map((r) => r.method);
    expect(registeredNames).toEqual([...SkillsShRpcHandlers.METHODS]);
  });
});

describe('SkillsShRpcHandlers — search', () => {
  it('uses the API client when a key is configured', async () => {
    const h = makeHarness();
    h.api.hasKey.mockResolvedValue(true);
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
    h.api.hasKey.mockResolvedValue(true);
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

  it('uses the CLI path when no API key is configured', async () => {
    const h = makeHarness();
    h.api.hasKey.mockResolvedValue(false);
    mockSpawnOnce('anthropics/skills@react-pro  100 installs\n');

    await h.rpc.call('skillsSh:search', { query: 'react' });

    expect(h.api.search).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledTimes(1);
  });
});

describe('SkillsShRpcHandlers — getPopular', () => {
  it('uses the API client when a key is configured', async () => {
    const h = makeHarness();
    h.api.hasKey.mockResolvedValue(true);
    h.api.getPopular.mockResolvedValue([apiSkill()]);

    const result = await h.rpc.call<{ skills: SkillShEntry[] }>(
      'skillsSh:getPopular',
    );

    expect(h.api.getPopular).toHaveBeenCalledWith('hot');
    expect(spawn).not.toHaveBeenCalled();
    expect(result.skills.length).toBe(1);
  });

  it('falls back to the CLI path when the API throws', async () => {
    const h = makeHarness();
    h.api.hasKey.mockResolvedValue(true);
    h.api.getPopular.mockRejectedValue(new Error('500'));
    mockSpawnOnce('anthropics/skills@webapp-testing  82000 installs\n');

    const result = await h.rpc.call<{ skills: SkillShEntry[] }>(
      'skillsSh:getPopular',
    );

    expect(spawn).toHaveBeenCalledTimes(1);
    expect(result.skills.length).toBeGreaterThan(0);
  });

  it('falls back to curated constants when both API and CLI fail', async () => {
    const h = makeHarness();
    h.api.hasKey.mockResolvedValue(false);
    mockSpawnOnce('', '', 1);

    const result = await h.rpc.call<{ skills: SkillShEntry[] }>(
      'skillsSh:getPopular',
    );

    expect(result.skills.length).toBeGreaterThan(0);
  });
});

describe('SkillsShRpcHandlers — detectRecommended', () => {
  it('uses the API curated pool when a key is configured', async () => {
    const h = makeHarness({ workspaceRoot: '/no/such/path' });
    h.api.hasKey.mockResolvedValue(true);
    h.api.getCurated.mockResolvedValue([
      apiSkill({ skillId: 'frontend-design' }),
    ]);

    await h.rpc.call('skillsSh:detectRecommended');

    expect(h.api.getCurated).toHaveBeenCalled();
  });

  it('returns empty detection when no workspace root is available', async () => {
    const h = makeHarness();
    const result = await h.rpc.call<{
      recommendedSkills: SkillShEntry[];
    }>('skillsSh:detectRecommended');
    expect(result.recommendedSkills).toEqual([]);
    expect(h.api.getCurated).not.toHaveBeenCalled();
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

describe('SkillsShRpcHandlers — API key management', () => {
  it('setApiKey trims and stores at SECRET_KEY', async () => {
    const h = makeHarness();

    const result = await h.rpc.call<{ success: boolean }>(
      'skillsSh:setApiKey',
      { apiKey: '  sk_live_abc  ' },
    );

    expect(result.success).toBe(true);
    expect(h.secrets.store).toHaveBeenCalledWith(SECRET_KEY, 'sk_live_abc');
    expect(h.api.invalidateInstallCaches).toHaveBeenCalled();
  });

  it('setApiKey rejects empty input without touching SecretStorage', async () => {
    const h = makeHarness();

    await expect(
      h.rpc.call('skillsSh:setApiKey', { apiKey: '   ' }),
    ).rejects.toThrow(/cannot be empty/i);
    expect(h.secrets.store).not.toHaveBeenCalled();
  });

  it('getApiKeyStatus returns configured=true when a key is stored', async () => {
    const h = makeHarness();
    h.secrets.store_.set(SECRET_KEY, 'sk_live_xyz');

    const result = await h.rpc.call<{ configured: boolean }>(
      'skillsSh:getApiKeyStatus',
    );

    expect(result.configured).toBe(true);
  });

  it('getApiKeyStatus returns configured=false for missing key', async () => {
    const h = makeHarness();
    const result = await h.rpc.call<{ configured: boolean }>(
      'skillsSh:getApiKeyStatus',
    );
    expect(result.configured).toBe(false);
  });

  it('getApiKeyStatus treats whitespace-only stored value as unconfigured', async () => {
    const h = makeHarness();
    h.secrets.store_.set(SECRET_KEY, '   ');
    const result = await h.rpc.call<{ configured: boolean }>(
      'skillsSh:getApiKeyStatus',
    );
    expect(result.configured).toBe(false);
  });

  it('deleteApiKey removes the SecretStorage entry and invalidates caches', async () => {
    const h = makeHarness();
    h.secrets.store_.set(SECRET_KEY, 'sk_live_xyz');

    const result = await h.rpc.call<{ success: boolean }>(
      'skillsSh:deleteApiKey',
    );

    expect(result.success).toBe(true);
    expect(h.secrets.delete).toHaveBeenCalledWith(SECRET_KEY);
    expect(h.secrets.store_.has(SECRET_KEY)).toBe(false);
    expect(h.api.invalidateInstallCaches).toHaveBeenCalled();
  });

  it('deleteApiKey is idempotent when no key is stored', async () => {
    const h = makeHarness();
    const result = await h.rpc.call<{ success: boolean }>(
      'skillsSh:deleteApiKey',
    );
    expect(result.success).toBe(true);
  });
});
