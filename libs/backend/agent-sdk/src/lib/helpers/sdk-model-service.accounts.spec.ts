import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  ClaudeAccountNamedRoute,
  ClaudeCertifiedLaunchContext,
} from '@ptah-extension/auth-providers-tokens';
import type {
  ModelInfo,
  QueryFunction,
  Query,
} from '../types/sdk-types/claude-sdk.types';
import type { IAuthEnvProvider, IModelResolver } from '../auth-env.port';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { OffThreadProcessSpawner } from './off-thread-process-spawner';
import {
  buildCertifiedClaudeEnv,
  certifiedEnvDigest,
} from './claude-certified-launch';
import { SdkModelService } from './sdk-model-service';

// SDK and DI fixtures implement only the methods exercised by these controls.
function partialMock<T>(members: Partial<T>): T {
  return members as T;
}

const route = (id = 'a', authEpoch = 1): ClaudeAccountNamedRoute =>
  ({
    kind: 'named',
    provider: 'claude',
    profileId: id,
    canonicalConfigDir: `/accounts/${id}`,
    routeFingerprint: id,
    routeRevision: 1,
    authEpoch,
    runId: `run-${id}`,
  }) as ClaudeAccountNamedRoute;

/** A certified launch for `/accounts/<id>`, built by the real helpers. */
const launch = (
  id = 'a',
  version = '1.0.0',
  configDir = `/accounts/${id}`,
): ClaudeCertifiedLaunchContext => {
  const env = buildCertifiedClaudeEnv(
    {
      PATH: '/bin',
      ANTHROPIC_API_KEY: 'foreign-key',
      ANTHROPIC_AUTH_TOKEN: 'foreign-token',
      CLAUDE_CODE_USE_BEDROCK: '1',
    },
    configDir,
  );
  return {
    executable: {
      command: '/runtime/claude',
      prefixArgs: [],
      sdkExecutablePath: `/runtime/${version}/cli.js`,
      version,
      fingerprint: { size: 1, mtimeMs: 1 },
    },
    env,
    envDigest: certifiedEnvDigest(env),
    cwd: `/work/${id}`,
    settingSources: ['user', 'project', 'local'],
    policy: {
      coverage: 'win32@1.0.0',
      managedFile: 'absent',
      managedDropIn: 'absent',
      registry: 'not-applicable',
      remoteSignals: 'absent',
    },
    accountClass: 'personal',
    identityReference: `ref-${id}`,
  };
};
const models = (id: string): ModelInfo[] => [
  { value: id, displayName: id, description: '' },
];
const flush = async (): Promise<void> => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};

function harness() {
  const logger = partialMock<Logger>({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  });
  const calls: Parameters<QueryFunction>[0][] = [];
  const closes: jest.Mock[] = [];
  let result: () => Promise<ModelInfo[]> = async () => models('model-a');
  const query = jest.fn((args: Parameters<QueryFunction>[0]): Query => {
    calls.push(args);
    const close = jest.fn();
    closes.push(close);
    return partialMock<Query>({
      supportedModels: jest.fn(() => result()),
      close,
    });
  });
  const loader = partialMock<SdkModuleLoader>({
    getQueryFunction: jest.fn().mockResolvedValue(query),
    getCliJsPath: jest.fn().mockResolvedValue('/runtime/cli.js'),
  });
  const service = new SdkModelService(
    logger,
    loader,
    { ANTHROPIC_API_KEY: 'foreign-key' },
    partialMock<IModelResolver>({ resolve: jest.fn((value: string) => value) }),
    partialMock<IAuthEnvProvider>({
      resolveActiveAuth: jest.fn(() => ({
        authMethod: 'apiKey',
        providerId: 'foreign',
      })),
    }),
    partialMock<OffThreadProcessSpawner>({ spawn: jest.fn() }),
    undefined,
  );
  return {
    service,
    calls,
    closes,
    query,
    loader,
    result: (next: () => Promise<ModelInfo[]>) => {
      result = next;
    },
  };
}

describe('account-scoped model control probes', () => {
  afterEach(() => jest.useRealTimers());

  it('returns unknown for a named route without a launch and starts nothing', async () => {
    const h = harness();
    expect(await h.service.getSupportedModels(route())).toEqual([]);
    expect(await h.service.getNativeClaudeModels(route())).toEqual([]);
    expect(h.loader.getQueryFunction).not.toHaveBeenCalled();
    expect(h.query).not.toHaveBeenCalled();
  });

  it('isolates accounts, shares a flight, and consumes no inference prompt', async () => {
    const h = harness();
    const [a, same] = await Promise.all([
      h.service.getSupportedModels(route(), undefined, launch()),
      h.service.getNativeClaudeModels(route(), undefined, launch()),
    ]);
    expect(a).toEqual(same);
    expect(h.query).toHaveBeenCalledTimes(1);
    h.result(async () => models('model-b'));
    expect(
      await h.service.getNativeClaudeModels(route('b'), undefined, launch('b')),
    ).toEqual(models('model-b'));
    expect(
      await h.service.getSupportedModels(route(), undefined, launch()),
    ).toEqual(models('model-a'));
    expect(h.closes.every((close) => close.mock.calls.length === 1)).toBe(true);
    for (const call of h.calls) {
      expect(typeof call.prompt).not.toBe('string');
      if (typeof call.prompt !== 'string') {
        const messages = [];
        for await (const message of call.prompt) messages.push(message);
        expect(messages).toEqual([]);
      }
      expect(call.options?.strictMcpConfig).toBe(true);
      expect(call.options?.settingSources).toEqual([]);
    }
  });

  it('probes with the certified env, cwd and executable only', async () => {
    const h = harness();
    const certified = launch();
    await h.service.getSupportedModels(route(), undefined, certified);
    const options = h.calls[0].options;
    expect(options?.env).toEqual(certified.env);
    expect(options?.env).not.toBe(certified.env);
    expect(options?.env?.['ANTHROPIC_API_KEY']).toBeUndefined();
    expect(options?.env?.['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
    expect(options?.env?.['CLAUDE_CODE_USE_BEDROCK']).toBeUndefined();
    expect(options?.env?.['CLAUDE_CONFIG_DIR']).toBe('/accounts/a');
    expect(options?.env?.['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe(
      '/accounts/a',
    );
    expect(options?.cwd).toBe('/work/a');
    expect(options?.pathToClaudeCodeExecutable).toBe('/runtime/1.0.0/cli.js');
  });

  it('refuses a launch that no longer matches the route without spawning', async () => {
    const h = harness();
    const moved = launch('a', '1.0.0', '/accounts/other');
    expect(
      await h.service.getSupportedModels(route(), undefined, moved),
    ).toEqual([]);
    const tampered = { ...launch(), envDigest: 'not-the-digest' };
    expect(
      await h.service.getSupportedModels(route(), undefined, tampered),
    ).toEqual([]);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('returns unknown for empty/invalid catalogs and never falls back to API credentials', async () => {
    const h = harness();
    const api = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('API fallback forbidden'));
    try {
      h.result(async () => []);
      expect(
        await h.service.getSupportedModels(route(), undefined, launch()),
      ).toEqual([]);
      h.result(() => Promise.reject(new Error('unavailable')));
      expect(
        await h.service.getSupportedModels(route(), undefined, launch()),
      ).toEqual([]);
      h.query.mockImplementationOnce(() =>
        partialMock<Query>({ close: jest.fn() }),
      );
      expect(
        await h.service.getSupportedModels(route(), undefined, launch()),
      ).toEqual([]);
      expect(api).not.toHaveBeenCalled();
      expect(h.query).toHaveBeenCalledTimes(3);
    } finally {
      api.mockRestore();
    }
  });

  it('keys by the certified executable version', async () => {
    const h = harness();
    await h.service.getSupportedModels(route(), undefined, launch());
    await h.service.getSupportedModels(route(), undefined, launch());
    expect(h.query).toHaveBeenCalledTimes(1);
    await h.service.getSupportedModels(
      route(),
      undefined,
      launch('a', '2.0.0'),
    );
    expect(h.query).toHaveBeenCalledTimes(2);
    expect(h.calls[1].options?.pathToClaudeCodeExecutable).toBe(
      '/runtime/2.0.0/cli.js',
    );
  });

  it('discards late old-epoch results and invalidation closes the old probe', async () => {
    const h = harness();
    let resolve!: (value: ModelInfo[]) => void;
    h.result(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const old = h.service.getSupportedModels(route(), undefined, launch());
    await flush();
    h.service.invalidateAccountRoute(route('a', 2));
    resolve(models('stale'));
    expect(await old).toEqual([]);
    expect(h.closes[0]).toHaveBeenCalledTimes(1);
    h.result(async () => models('fresh'));
    expect(
      await h.service.getSupportedModels(route('a', 2), undefined, launch()),
    ).toEqual(models('fresh'));
    expect(
      await h.service.getSupportedModels(route(), undefined, launch()),
    ).toEqual([]);
  });

  it('keeps a shared probe until its last consumer cancels', async () => {
    const h = harness();
    h.result(() => new Promise(() => undefined));
    const first = new AbortController();
    const second = new AbortController();
    const a = h.service.getSupportedModels(route(), first.signal, launch());
    const b = h.service.getSupportedModels(route(), second.signal, launch());
    await flush();
    first.abort();
    expect(await a).toEqual([]);
    expect(h.closes[0]).not.toHaveBeenCalled();
    second.abort();
    expect(await b).toEqual([]);
    await flush();
    expect(h.closes[0]).toHaveBeenCalledTimes(1);
  });

  it('bounds stuck control calls and loader waits, disposing without a late spawn', async () => {
    jest.useFakeTimers();
    const h = harness();
    h.result(() => new Promise(() => undefined));
    const pending = h.service.getSupportedModels(route(), undefined, launch());
    await flush();
    await jest.advanceTimersByTimeAsync(15_001);
    expect(await pending).toEqual([]);
    expect(h.closes[0]).toHaveBeenCalledTimes(1);
    let loaded!: (factory: QueryFunction) => void;
    h.loader.getQueryFunction = jest.fn(
      () =>
        new Promise((resolve) => {
          loaded = resolve;
        }),
    );
    const loading = h.service.getSupportedModels(
      route('b'),
      undefined,
      launch('b'),
    );
    await flush();
    await jest.advanceTimersByTimeAsync(15_001);
    expect(await loading).toEqual([]);
    loaded(h.query);
    await flush();
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
