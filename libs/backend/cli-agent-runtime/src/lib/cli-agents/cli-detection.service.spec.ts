import 'reflect-metadata';
import type {
  AgentRoleChannel,
  CliDetectionResult,
  CliType,
} from '@ptah-extension/shared';
import { AuthSecretsService, Logger, SentryService } from '@ptah-extension/vscode-core';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type {
  AgentMessagingCapabilities,
  CliAdapter,
  CliCommandOptions,
  CliModelInfo,
  CodexAdapterFactory,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';

interface MockAdapter extends CliAdapter {
  name: CliType;
  displayName: string;
  roleChannel: AgentRoleChannel;
  detect: jest.Mock<Promise<CliDetectionResult>, []>;
  capabilities: jest.Mock<AgentMessagingCapabilities, []>;
  parseOutput: jest.Mock<string, [string]>;
  runSdk: jest.Mock<Promise<SdkHandle>, [CliCommandOptions]>;
  listModels: jest.Mock<Promise<CliModelInfo[]>, []>;
}

const mockAdapters = new Map<CliType, MockAdapter>();

function mockAdapterFor(name: CliType): MockAdapter {
  const adapter = mockAdapters.get(name);
  if (!adapter) {
    throw new Error(`no mock adapter for ${name}`);
  }
  return adapter;
}

jest.mock('./cli-adapters/copilot-sdk.adapter', () => ({
  CopilotSdkAdapter: jest.fn(() => mockAdapterFor('copilot')),
}));
jest.mock('./cli-adapters/copilot-permission-bridge', () => ({
  CopilotPermissionBridge: jest.fn(() => ({})),
}));
const mockCursorCtor = jest.fn(
  (_logger?: unknown, _resolveApiKey?: () => Promise<string | undefined>) =>
    mockAdapterFor('cursor'),
);
jest.mock('./cli-adapters/cursor-cli.adapter', () => ({
  CursorCliAdapter: mockCursorCtor,
}));
jest.mock('./cli-adapters/antigravity-cli.adapter', () => ({
  AntigravityCliAdapter: jest.fn(() => mockAdapterFor('antigravity')),
}));
jest.mock('./cli-adapters/opencode-cli.adapter', () => ({
  OpencodeCliAdapter: jest.fn(() => mockAdapterFor('opencode')),
}));
jest.mock('./cli-adapters/pi-cli.adapter', () => ({
  PiCliAdapter: jest.fn(() => mockAdapterFor('pi')),
}));
const mockGrokCtor = jest.fn((_spawner?: unknown, _logger?: unknown) =>
  mockAdapterFor('grok'),
);
jest.mock('./cli-adapters/grok-cli.adapter', () => ({
  GrokCliAdapter: mockGrokCtor,
}));
const currentPath = (): string => process.env['PATH'] ?? '';
const mockFixPathReady = jest.fn<Promise<string>, []>(() =>
  Promise.resolve(currentPath()),
);
jest.mock('./cli-adapters/fix-path', () => ({
  fixPathReady: () => mockFixPathReady(),
}));

import { CliDetectionService } from './cli-detection.service';

const CHANNELS: ReadonlyArray<[CliType, AgentRoleChannel]> = [
  ['codex', 'developer-instructions'],
  ['copilot', 'task-prompt'],
  ['cursor', 'task-prompt'],
  ['antigravity', 'task-prompt'],
  ['opencode', 'task-prompt'],
  ['pi', 'task-prompt'],
  ['grok', 'task-prompt'],
];

function createAdapter(
  name: CliType,
  roleChannel: AgentRoleChannel,
): MockAdapter {
  return {
    name,
    displayName: name,
    roleChannel,
    detect: jest.fn<Promise<CliDetectionResult>, []>().mockResolvedValue({
      cli: name,
      installed: true,
      path: `/bin/${name}`,
      version: '1.0.0',
      messagingMode: 'queue',
    }),
    capabilities: jest
      .fn<AgentMessagingCapabilities, []>()
      .mockReturnValue({ steer: false, interrupt: false, continuation: true }),
    parseOutput: jest.fn<string, [string]>((raw) => raw),
    runSdk: jest.fn<Promise<SdkHandle>, [CliCommandOptions]>()
      .mockResolvedValue({
        abort: new AbortController(), done: Promise.resolve(0),
        onOutput: () => undefined,
      }),
    listModels: jest.fn<Promise<CliModelInfo[]>, []>().mockResolvedValue([]),
  };
}

function createService(codexAdapterFactory: CodexAdapterFactory | null = {
  create: () => mockAdapterFor('codex'),
}): {
  service: CliDetectionService;
  logger: Logger;
  sentry: { captureException: jest.Mock };
  authSecrets: { getProviderKey: jest.Mock };
} {
  const logger = Object.create(Logger.prototype) as Logger;
  for (const method of ['info', 'debug', 'warn', 'error'] as const) {
    Object.defineProperty(logger, method, { value: jest.fn() });
  }
  const sentryService = Object.create(SentryService.prototype) as SentryService;
  const sentry = { captureException: jest.fn() };
  Object.defineProperty(sentryService, 'captureException', {
    value: sentry.captureException,
  });
  const authSecrets = { getProviderKey: jest.fn(async () => undefined) };
  const authSecretsService = Object.create(AuthSecretsService.prototype) as AuthSecretsService;
  Object.defineProperty(authSecretsService, 'getProviderKey', {
    value: authSecrets.getProviderKey,
  });
  const service = new CliDetectionService(
    logger,
    sentryService,
    {} as IProcessSpawner,
    authSecretsService,
    null,
    codexAdapterFactory,
  );
  return { service, logger, sentry, authSecrets };
}

describe('CliDetectionService login-shell PATH refresh', () => {
  const settle = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve));

  beforeEach(() => {
    mockAdapters.clear();
    for (const [name, channel] of CHANNELS) {
      mockAdapters.set(name, createAdapter(name, channel));
    }
  });

  afterEach(() => {
    mockFixPathReady.mockImplementation(() => Promise.resolve(currentPath()));
  });

  it('drops the cached scan once when the shell probe changes PATH', async () => {
    let land: (path: string) => void = () => undefined;
    mockFixPathReady.mockImplementation(
      () => new Promise<string>((resolve) => { land = resolve; }),
    );
    const { service } = createService();
    const invalidate = jest.spyOn(service, 'invalidateCache');

    land(`/login-shell/bin:${currentPath()}`);
    await settle();

    expect(invalidate).toHaveBeenCalledTimes(1);
  });

  it('keeps the cached scan when the shell probe leaves PATH unchanged', async () => {
    const { service } = createService();
    const invalidate = jest.spyOn(service, 'invalidateCache');

    await settle();

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe('CliDetectionService role stamp', () => {
  beforeEach(() => {
    mockAdapters.clear();
    mockCursorCtor.mockClear();
    mockGrokCtor.mockClear();
    for (const [name, channel] of CHANNELS) {
      mockAdapters.set(name, createAdapter(name, channel));
    }
  });

  it('reports an unavailable Codex slot when no native factory is registered', async () => {
    const { service, logger } = createService(null);
    expect(await service.getDetection('codex')).toMatchObject({ installed: false });
    await expect(service.getAdapter('codex')?.runSdk({
      task: 'work', workingDirectory: '/work',
    })).rejects.toThrow('Native Codex lane adapter factory is not registered');
    expect(logger.warn).toHaveBeenCalledWith(
      '[CliDetection] Native Codex adapter unavailable',
      expect.any(Error),
    );
  });

  it('keeps peer adapters usable and reports a native factory failure without legacy fallback', async () => {
    const failure = new Error('native composition failed');
    const { service, logger, sentry } = createService({
      create: () => { throw failure; },
    });

    expect(service.getAdapter('copilot')).toBe(mockAdapterFor('copilot'));
    expect(await service.getDetection('codex')).toMatchObject({ installed: false });
    expect(await service.listModelsForAll()).not.toHaveProperty('codex');
    await expect(service.getAdapter('codex')?.runSdk({
      task: 'work', workingDirectory: '/work',
    })).rejects.toThrow('Native Codex adapter unavailable: native composition failed');
    expect(logger.error).toHaveBeenCalledWith(
      '[CliDetection] Native Codex adapter factory failed', failure,
    );
    expect(sentry.captureException).toHaveBeenCalledWith(failure, {
      errorSource: 'CliDetectionService.codexAdapterFactory',
    });
  });

  it('constructs the Cursor adapter with a resolver over getProviderKey("cursor")', async () => {
    const { authSecrets } = createService();

    expect(mockCursorCtor).toHaveBeenCalledTimes(1);
    const [loggerArg, resolver] = mockCursorCtor.mock.calls[0];
    expect(loggerArg).toBeDefined();
    if (!resolver) {
      throw new Error('CursorCliAdapter was constructed without a resolver');
    }
    await resolver();
    expect(authSecrets.getProviderKey).toHaveBeenCalledWith('cursor');
  });

  it('constructs the Grok adapter with the process spawner and the logger', () => {
    createService();

    expect(mockGrokCtor).toHaveBeenCalledTimes(1);
    const [spawnerArg, loggerArg] = mockGrokCtor.mock.calls[0];
    expect(spawnerArg).toBeDefined();
    expect(loggerArg).toBeDefined();
  });

  it('checks Grok credentials in refreshCliTokens', async () => {
    const ensureTokensFresh = jest.fn(async () => true);
    Object.assign(mockAdapterFor('grok'), { ensureTokensFresh });
    const { service } = createService();

    await service.refreshCliTokens();

    expect(ensureTokensFresh).toHaveBeenCalledTimes(1);
  });

  it('stamps preamble delivery and the adapter channel on every successful detection', async () => {
    const { service } = createService();

    const results = await service.detectAll();

    expect(results).toHaveLength(CHANNELS.length);
    for (const [name, channel] of CHANNELS) {
      expect(results.find((r) => r.cli === name)).toEqual({
        cli: name,
        installed: true,
        path: `/bin/${name}`,
        version: '1.0.0',
        messagingMode: 'queue',
        roleDelivery: 'preamble',
        roleChannel: channel,
      });
    }
  });

  it('starts peer detection while the Codex binary probe is still pending', async () => {
    let releaseCodex: ((result: CliDetectionResult) => void) | undefined;
    mockAdapterFor('codex').detect.mockImplementation(
      () => new Promise((resolve) => {
        releaseCodex = resolve;
      }),
    );
    const { service } = createService();

    const pending = service.detectAll();
    for (const [name] of CHANNELS) {
      expect(mockAdapterFor(name).detect).toHaveBeenCalledTimes(1);
    }
    if (!releaseCodex) throw new Error('Codex detection did not start');
    releaseCodex({
      cli: 'codex', installed: true, path: '/bin/codex',
      version: '0.165.0', messagingMode: 'queue',
    });

    expect((await pending).map((row) => row.cli)).toEqual(CHANNELS.map(([name]) => name));
  });

  it('stamps the error-branch row when an adapter detect() throws', async () => {
    mockAdapterFor('codex').detect.mockRejectedValue(new Error('boom'));
    const { service, sentry } = createService();

    const codex = await service.getDetection('codex');

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    expect(codex).toEqual({
      cli: 'codex',
      installed: false,
      messagingMode: 'queue',
      roleDelivery: 'preamble',
      roleChannel: 'developer-instructions',
    });
  });

  it('serves stamped rows from the cache without re-detecting', async () => {
    mockAdapterFor('pi').detect.mockRejectedValue(new Error('boom'));
    const { service } = createService();

    const first = await service.detectAll();
    const second = await service.detectAll();

    expect(second).toEqual(first);
    for (const [name] of CHANNELS) {
      expect(mockAdapterFor(name).detect).toHaveBeenCalledTimes(1);
    }
    for (const row of second) {
      expect(row.roleDelivery).toBe('preamble');
      expect(row.roleChannel).toBe(mockAdapterFor(row.cli).roleChannel);
    }
  });

  it('refresh() joins a current in-flight scan instead of starting a second one', async () => {
    let releaseCodex: ((result: CliDetectionResult) => void) | undefined;
    mockAdapterFor('codex').detect.mockImplementationOnce(
      () => new Promise((resolve) => { releaseCodex = resolve; }),
    );
    const { service } = createService();
    const first = service.detectAll();

    const joined = service.refresh();
    for (const [name] of CHANNELS) {
      expect(mockAdapterFor(name).detect).toHaveBeenCalledTimes(1);
    }

    if (!releaseCodex) throw new Error('Codex detection did not start');
    releaseCodex({ cli: 'codex', installed: true, messagingMode: 'queue' });
    expect(await joined).toEqual(await first);

    // The joined scan was current, so its result is cached.
    await service.detectAll();
    for (const [name] of CHANNELS) {
      expect(mockAdapterFor(name).detect).toHaveBeenCalledTimes(1);
    }
    // With no scan in flight, refresh() re-detects.
    await service.refresh();
    for (const [name] of CHANNELS) {
      expect(mockAdapterFor(name).detect).toHaveBeenCalledTimes(2);
    }
  });

  it('refresh() does not join a scan older than 15 s, so a stuck adapter cannot hold it', async () => {
    let releaseCodex: ((result: CliDetectionResult) => void) | undefined;
    mockAdapterFor('codex').detect.mockImplementationOnce(
      () => new Promise((resolve) => { releaseCodex = resolve; }),
    );
    const clock = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const { service } = createService();
      const stuck = service.detectAll();

      clock.mockReturnValue(1_000_000 + 15_000);
      const fresh = service.refresh();
      for (const [name] of CHANNELS) {
        expect(mockAdapterFor(name).detect).toHaveBeenCalledTimes(2);
      }
      await fresh;

      if (!releaseCodex) throw new Error('Codex detection did not start');
      releaseCodex({ cli: 'codex', installed: true, messagingMode: 'queue' });
      await stuck;
    } finally {
      clock.mockRestore();
    }
  });

  it('does not join or cache a scan that started before invalidateCache()', async () => {
    let releaseCodex: ((result: CliDetectionResult) => void) | undefined;
    mockAdapterFor('codex').detect.mockImplementationOnce(
      () => new Promise((resolve) => { releaseCodex = resolve; }),
    );
    const { service } = createService();
    const stale = service.detectAll();

    service.invalidateCache();
    const fresh = service.refresh();
    for (const [name] of CHANNELS) {
      expect(mockAdapterFor(name).detect).toHaveBeenCalledTimes(2);
    }

    if (!releaseCodex) throw new Error('Codex detection did not start');
    releaseCodex({ cli: 'codex', installed: true, messagingMode: 'queue' });
    await stale;
    await fresh;

    // The fresh scan is cached; the stale one did not overwrite it.
    await service.detectAll();
    for (const [name] of CHANNELS) {
      expect(mockAdapterFor(name).detect).toHaveBeenCalledTimes(2);
    }
  });

  it('deduplicates model listing and recomputes after invalidation', async () => {
    const { service } = createService();
    await Promise.all([service.listModelsForAll(), service.listModelsForAll()]);
    for (const [name] of CHANNELS) {
      expect(mockAdapterFor(name).listModels).toHaveBeenCalledTimes(1);
    }
    await service.listModelsForAll();
    expect(mockAdapterFor('codex').listModels).toHaveBeenCalledTimes(1);
    service.invalidateCache();
    await service.listModelsForAll();
    expect(mockAdapterFor('codex').listModels).toHaveBeenCalledTimes(2);
  });
});
