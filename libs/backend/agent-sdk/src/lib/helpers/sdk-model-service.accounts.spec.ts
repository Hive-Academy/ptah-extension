import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import type {
  ModelInfo,
  QueryFunction,
  Query,
} from '../types/sdk-types/claude-sdk.types';
import type { ClaudeInstallation } from '../detector/claude-cli-detector';
import type { IAuthEnvProvider, IModelResolver } from '../auth-env.port';
import type { SdkModuleLoader } from './sdk-module-loader';
import type { OffThreadProcessSpawner } from './off-thread-process-spawner';
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
  const installation: ClaudeInstallation = {
    path: '/runtime/claude',
    cliJsPath: '/runtime/cli.js',
    version: '1.0.0',
    source: 'path',
  };
  const detector = {
    findExecutable: jest
      .fn<Promise<ClaudeInstallation | null>, []>()
      .mockResolvedValue(installation),
  };
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
    detector,
  );
  return {
    service,
    calls,
    closes,
    query,
    loader,
    detector,
    installation,
    result: (next: () => Promise<ModelInfo[]>) => {
      result = next;
    },
  };
}

describe('account-scoped model control probes', () => {
  afterEach(() => jest.useRealTimers());

  it('isolates accounts, shares a flight, and consumes no inference prompt', async () => {
    const h = harness();
    const [a, same] = await Promise.all([
      h.service.getSupportedModels(route()),
      h.service.getNativeClaudeModels(route()),
    ]);
    expect(a).toEqual(same);
    expect(h.query).toHaveBeenCalledTimes(1);
    h.result(async () => models('model-b'));
    expect(await h.service.getNativeClaudeModels(route('b'))).toEqual(
      models('model-b'),
    );
    expect(await h.service.getSupportedModels(route())).toEqual(
      models('model-a'),
    );
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

  it('scrubs foreign selectors only in the completed child env', async () => {
    const h = harness();
    const before = { ...process.env };
    try {
      process.env['ANTHROPIC_AUTH_TOKEN'] = 'foreign-token';
      process.env['CLAUDE_CODE_USE_BEDROCK'] = '1';
      process.env['CLAUDE_SECURESTORAGE_CONFIG_DIR'] = '/foreign';
      await h.service.getSupportedModels(route());
      const env = h.calls[0].options?.env;
      expect(env?.['ANTHROPIC_API_KEY']).toBeUndefined();
      expect(env?.['ANTHROPIC_AUTH_TOKEN']).toBeUndefined();
      expect(env?.['CLAUDE_CODE_USE_BEDROCK']).toBeUndefined();
      expect(env?.['CLAUDE_CONFIG_DIR']).toBe('/accounts/a');
      expect(env?.['CLAUDE_SECURESTORAGE_CONFIG_DIR']).toBe('/accounts/a');
      expect(process.env['ANTHROPIC_AUTH_TOKEN']).toBe('foreign-token');
    } finally {
      for (const key of [
        'ANTHROPIC_AUTH_TOKEN',
        'CLAUDE_CODE_USE_BEDROCK',
        'CLAUDE_SECURESTORAGE_CONFIG_DIR',
      ]) {
        if (before[key] === undefined) delete process.env[key];
        else process.env[key] = before[key];
      }
    }
  });

  it('returns unknown for empty/invalid catalogs and never falls back to API credentials', async () => {
    const h = harness();
    const api = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('API fallback forbidden'));
    try {
      h.result(async () => []);
      expect(await h.service.getSupportedModels(route())).toEqual([]);
      h.result(() => Promise.reject(new Error('unavailable')));
      expect(await h.service.getSupportedModels(route())).toEqual([]);
      h.query.mockImplementationOnce(() =>
        partialMock<Query>({ close: jest.fn() }),
      );
      expect(await h.service.getSupportedModels(route())).toEqual([]);
      expect(api).not.toHaveBeenCalled();
      expect(h.query).toHaveBeenCalledTimes(3);
    } finally {
      api.mockRestore();
    }
  });

  it('keys by installed version and refuses unknown installation without spawning', async () => {
    const h = harness();
    await h.service.getSupportedModels(route());
    h.detector.findExecutable.mockResolvedValue({
      ...h.installation,
      version: '2.0.0',
    });
    await h.service.getSupportedModels(route());
    expect(h.query).toHaveBeenCalledTimes(2);
    h.detector.findExecutable.mockResolvedValue(null);
    expect(await h.service.getSupportedModels(route())).toEqual([]);
    expect(h.query).toHaveBeenCalledTimes(2);
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
    const old = h.service.getSupportedModels(route());
    await flush();
    h.service.invalidateAccountRoute(route('a', 2));
    resolve(models('stale'));
    expect(await old).toEqual([]);
    expect(h.closes[0]).toHaveBeenCalledTimes(1);
    h.result(async () => models('fresh'));
    expect(await h.service.getSupportedModels(route('a', 2))).toEqual(
      models('fresh'),
    );
    expect(await h.service.getSupportedModels(route())).toEqual([]);
  });

  it('keeps a shared probe until its last consumer cancels', async () => {
    const h = harness();
    h.result(() => new Promise(() => undefined));
    const first = new AbortController();
    const second = new AbortController();
    const a = h.service.getSupportedModels(route(), first.signal);
    const b = h.service.getSupportedModels(route(), second.signal);
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
    const pending = h.service.getSupportedModels(route());
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
    const loading = h.service.getSupportedModels(route('b'));
    await flush();
    await jest.advanceTimersByTimeAsync(15_001);
    expect(await loading).toEqual([]);
    loaded(h.query);
    await flush();
    expect(h.query).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
