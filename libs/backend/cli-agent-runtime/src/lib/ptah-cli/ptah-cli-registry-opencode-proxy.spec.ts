/** Real spawn-boundary regression tests for OpenCode per-agent proxy ownership. */
import 'reflect-metadata';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger, IAuthSecretsService } from '@ptah-extension/vscode-core';
import type {
  SdkModuleLoader,
  SdkMessageTransformer,
  SdkPermissionHandler,
  Options,
} from '@ptah-extension/agent-sdk';
import type {
  ProviderModelsService,
  ITranslationProxy,
} from '@ptah-extension/auth-providers';
import {
  getAnthropicProvider,
  type PtahCliConfig,
  type AuthEnv,
  type OpenCodeProviderId,
} from '@ptah-extension/shared';

const created: Array<{
  id: OpenCodeProviderId;
  key: string;
  proxy: jest.Mocked<ITranslationProxy>;
}> = [];
const mockFactory = jest.fn(
  (id: OpenCodeProviderId, key: string, _logger: Logger): ITranslationProxy => {
    const port = 46000 + created.length;
    const url = `http://127.0.0.1:${port}`;
    let running = false;
    const proxy: jest.Mocked<ITranslationProxy> = {
      start: jest.fn(async () => {
        running = true;
        return { port, url };
      }),
      stop: jest.fn(async () => {
        running = false;
      }),
      isRunning: jest.fn(() => running),
      getUrl: jest.fn(() => (running ? url : undefined)),
    };
    created.push({ id, key, proxy });
    return proxy;
  },
);

jest.mock('@ptah-extension/auth-providers', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/auth-providers')>(
    '@ptah-extension/auth-providers',
  ),
  createOpenCodeProxyForKey: (
    id: OpenCodeProviderId,
    key: string,
    logger: Logger,
  ) => mockFactory(id, key, logger),
}));
jest.mock('@ptah-extension/agent-sdk', () => ({
  ...jest.requireActual<typeof import('@ptah-extension/agent-sdk')>(
    '@ptah-extension/agent-sdk',
  ),
  buildSafeEnv: jest.fn((env: unknown) => env),
}));
import { PtahCliRegistry } from './ptah-cli-registry';
import { PTAH_CLI_KEY_PREFIX } from './helpers/ptah-cli-registry.utils';
import { createFakeSdkProcessSpawner } from './testing/fake-sdk-process-spawner';
interface SpawnHarness {
  registry: PtahCliRegistry;
  getCapturedEnv: () => AuthEnv | undefined;
}
function buildHarness(
  config: PtahCliConfig,
  mode: 'complete' | 'error' | 'cancel' | 'setup-error' = 'complete',
): SpawnHarness {
  const logger = createMockLogger();

  let capturedEnv: AuthEnv | undefined;
  const queryFn = jest.fn((args: { options?: Options }) => {
    capturedEnv = args.options?.env as AuthEnv | undefined;
    if (mode === 'setup-error') throw new Error('SDK setup failed');
    return (async function* () {
      if (mode === 'error') throw new Error('SDK stream failed');
      if (mode === 'cancel') {
        const signal = args.options?.abortController?.signal;
        await new Promise<void>((resolve) => {
          if (signal?.aborted) resolve();
          else
            signal?.addEventListener('abort', () => resolve(), { once: true });
        });
      }
      // This mock never emits a message — every mode either throws or ends.
      // `yield*` over an empty array keeps it a generator for `require-yield`
      // without inventing a message the assertions would then have to ignore.
      yield* [];
    })();
  });

  const moduleLoader = {
    getQueryFunction: jest.fn().mockResolvedValue(queryFn),
    getCliJsPath: jest.fn().mockResolvedValue(undefined),
  } as unknown as SdkModuleLoader;

  const messageTransformer = {
    createIsolated: jest.fn().mockReturnValue({
      transform: jest.fn().mockReturnValue([]),
    }),
  } as unknown as SdkMessageTransformer;

  const permissionHandler = {
    getPermissionLevel: jest.fn().mockReturnValue('yolo'),
    createCallback: jest.fn(),
  } as unknown as SdkPermissionHandler;

  const authSecrets = {
    getProviderKey: jest.fn(async (id: string) =>
      id === `${PTAH_CLI_KEY_PREFIX}.${config.id}`
        ? `${config.id}-key`
        : undefined,
    ),
  } as unknown as IAuthSecretsService;

  const providerModels = {
    getModelTiers: jest.fn().mockReturnValue({
      sonnet: null,
      opus: null,
      haiku: null,
    }),
  } as unknown as ProviderModelsService;

  const configPersistence = {
    loadConfigs: jest.fn().mockReturnValue([config]),
  } as unknown as never;

  const spawnOptionsService = {
    assembleSpawnOptions: jest.fn().mockResolvedValue({
      mcpServers: {},
      hooks: undefined,
      autoCompact: {},
      systemPromptMode: 'append',
      systemPromptContent: undefined,
    }),
  } as unknown as never;

  const configManager = {
    get: jest.fn(() => undefined),
  } as unknown as never;

  const registry = new PtahCliRegistry(
    logger as unknown as Logger,
    authSecrets,
    moduleLoader,
    messageTransformer,
    permissionHandler,
    null as never,
    null as never,
    null as never,
    providerModels,
    configPersistence,
    spawnOptionsService,
    null as never,
    configManager,
    createFakeSdkProcessSpawner(),
  );

  return { registry, getCapturedEnv: () => capturedEnv };
}

function config(id: OpenCodeProviderId, suffix = ''): PtahCliConfig {
  return {
    id: `pc-${id}${suffix}`,
    name: id,
    providerId: id,
    enabled: true,
    updatedAt: 0,
  };
}

describe('PtahCliRegistry.spawnAgent OpenCode proxies', () => {
  beforeEach(() => {
    created.length = 0;
    mockFactory.mockClear();
  });

  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s binds its agent key, local SDK environment and provider tiers',
    async (id) => {
      const cfg = config(id);
      const h = buildHarness(cfg);
      const result = await h.registry.spawnAgent(cfg.id, 'work');
      if ('status' in result) throw new Error(result.message);
      await result.handle.done;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(created).toHaveLength(1);
      expect(created[0].id).toBe(id);
      expect(created[0].key).toBe(`${cfg.id}-key`);
      expect(created[0].proxy.start).toHaveBeenCalledTimes(1);
      const env = h.getCapturedEnv();
      expect(env?.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:46000');
      expect(env?.ANTHROPIC_AUTH_TOKEN).toBe('opencode-proxy-token');
      expect(env?.ANTHROPIC_API_KEY).toBeFalsy();
      expect(env?.ANTHROPIC_DEFAULT_SONNET_MODEL).toBe(
        getAnthropicProvider(id)?.defaultTiers?.sonnet,
      );
      expect(env?.ANTHROPIC_DEFAULT_OPUS_MODEL).toBe(
        getAnthropicProvider(id)?.defaultTiers?.opus,
      );
      expect(env?.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe(
        getAnthropicProvider(id)?.defaultTiers?.haiku,
      );
      expect(created[0].proxy.stop).toHaveBeenCalledTimes(1);
    },
  );

  it('concurrent agents have distinct keys and ports and cancellation stops only its proxy', async () => {
    const zen = config('opencode-zen');
    const go = config('opencode-go');
    const a = buildHarness(zen, 'cancel');
    const b = buildHarness(go, 'cancel');
    const [ra, rb] = await Promise.all([
      a.registry.spawnAgent(zen.id, 'work'),
      b.registry.spawnAgent(go.id, 'work'),
    ]);
    if ('status' in ra || 'status' in rb) throw new Error('Spawn failed');
    expect(a.getCapturedEnv()?.ANTHROPIC_BASE_URL).not.toBe(
      b.getCapturedEnv()?.ANTHROPIC_BASE_URL,
    );
    expect(new Set(created.map((c) => c.key)).size).toBe(2);
    ra.handle.abort.abort();
    await ra.handle.done;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      created.find((c) => c.id === 'opencode-zen')?.proxy.isRunning(),
    ).toBe(false);
    expect(created.find((c) => c.id === 'opencode-go')?.proxy.isRunning()).toBe(
      true,
    );
    rb.handle.abort.abort();
    await rb.handle.done;
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(created.every((c) => !c.proxy.isRunning())).toBe(true);
  });

  it.each(['opencode-zen', 'opencode-go'] as const)(
    '%s stops the proxy when the SDK stream fails',
    async (id) => {
      const cfg = config(id);
      const h = buildHarness(cfg, 'error');
      const result = await h.registry.spawnAgent(cfg.id, 'work');
      if ('status' in result) throw new Error(result.message);
      await result.handle.done;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(created[0].proxy.stop).toHaveBeenCalledTimes(1);
    },
  );

  it('stops an already-started proxy when SDK setup throws', async () => {
    const cfg = config('opencode-go');
    const h = buildHarness(cfg, 'setup-error');
    await expect(h.registry.spawnAgent(cfg.id, 'work')).rejects.toThrow(
      'SDK setup failed',
    );
    expect(created[0].proxy.stop).toHaveBeenCalledTimes(1);
  });
});
