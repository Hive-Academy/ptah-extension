import 'reflect-metadata';
import type {
  AgentRoleChannel,
  CliDetectionResult,
  CliType,
} from '@ptah-extension/shared';
import { AuthSecretsService, Logger, SentryService } from '@ptah-extension/vscode-core';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type { CodexAdapterFactory } from './cli-adapters/cli-adapter.interface';

interface MockAdapter {
  name: CliType;
  displayName: string;
  roleChannel: AgentRoleChannel;
  detect: jest.Mock<Promise<CliDetectionResult>, []>;
  capabilities: jest.Mock;
  parseOutput: jest.Mock;
  runSdk: jest.Mock;
}

const mockAdapters = new Map<CliType, MockAdapter>();

function mockAdapterFor(name: CliType): MockAdapter {
  const adapter = mockAdapters.get(name);
  if (!adapter) {
    throw new Error(`no mock adapter for ${name}`);
  }
  return adapter;
}

jest.mock('./cli-adapters/codex-cli.adapter', () => ({
  CodexCliAdapter: jest.fn(() => mockAdapterFor('codex')),
}));
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
      .fn()
      .mockReturnValue({ steer: false, interrupt: false, continuation: true }),
    parseOutput: jest.fn((raw: string) => raw),
    runSdk: jest.fn(),
  };
}

function createService(codexAdapterFactory: CodexAdapterFactory | null = null): {
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

describe('CliDetectionService role stamp', () => {
  beforeEach(() => {
    mockAdapters.clear();
    mockCursorCtor.mockClear();
    mockGrokCtor.mockClear();
    for (const [name, channel] of CHANNELS) {
      mockAdapters.set(name, createAdapter(name, channel));
    }
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
});
