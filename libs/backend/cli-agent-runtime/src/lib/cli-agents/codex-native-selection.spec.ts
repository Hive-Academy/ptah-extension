import 'reflect-metadata';
import { container } from 'tsyringe';
import type { CliType } from '@ptah-extension/shared';
import { AuthSecretsService, Logger, SentryService, TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { IProcessSpawner } from '@ptah-extension/platform-core';
import type {
  CliAdapter,
  CliCommandOptions,
  CodexAdapterFactory,
  SdkHandle,
} from './cli-adapters/cli-adapter.interface';

const mockAdapters = new Map<CliType, CliAdapter>();

function adapter(name: CliType): CliAdapter {
  const selected = mockAdapters.get(name);
  if (!selected) throw new Error(`Missing ${name} test adapter`);
  return selected;
}

jest.mock('./cli-adapters/copilot-sdk.adapter', () => ({
  CopilotSdkAdapter: jest.fn(() => adapter('copilot')),
}));
jest.mock('./cli-adapters/copilot-permission-bridge', () => ({
  CopilotPermissionBridge: jest.fn(() => ({})),
}));
jest.mock('./cli-adapters/cursor-cli.adapter', () => ({
  CursorCliAdapter: jest.fn(() => adapter('cursor')),
}));
jest.mock('./cli-adapters/antigravity-cli.adapter', () => ({
  AntigravityCliAdapter: jest.fn(() => adapter('antigravity')),
}));
jest.mock('./cli-adapters/opencode-cli.adapter', () => ({
  OpencodeCliAdapter: jest.fn(() => adapter('opencode')),
}));
jest.mock('./cli-adapters/pi-cli.adapter', () => ({
  PiCliAdapter: jest.fn(() => adapter('pi')),
}));
jest.mock('./cli-adapters/grok-cli.adapter', () => ({
  GrokCliAdapter: jest.fn(() => adapter('grok')),
}));

import { CliDetectionService } from './cli-detection.service';
import { ClaudeCliAdapter } from './cli-adapters/claude-cli.adapter';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';

const names: CliType[] = [
  'copilot', 'cursor', 'antigravity', 'opencode', 'pi', 'grok',
];

function makeAdapter(name: CliType, model: string): CliAdapter {
  return {
    name,
    displayName: name,
    roleChannel: name === 'codex' ? 'developer-instructions' : 'task-prompt',
    supportsMcp: true,
    capabilities: jest.fn(() => ({ steer: false, interrupt: false, continuation: true })),
    detect: jest.fn(async () => ({
      cli: name, installed: true, path: `/bin/${name}`, version: '1.0.0',
      messagingMode: 'queue' as const,
    })),
    listModels: jest.fn(async () => [{ id: model, name: model }]),
    parseOutput: jest.fn((raw: string) => raw),
    runSdk: jest.fn(async (): Promise<SdkHandle> => ({
      abort: new AbortController(), done: Promise.resolve(0), onOutput: () => undefined,
    })),
  };
}

function serviceWithDeps(factory: CodexAdapterFactory | null = null): {
  detector: CliDetectionService;
  logger: Logger;
  sentry: SentryService;
  secrets: AuthSecretsService;
} {
  const logger = Object.create(Logger.prototype) as Logger;
  for (const method of ['info', 'debug', 'warn', 'error'] as const) {
    Object.defineProperty(logger, method, { value: jest.fn() });
  }
  const sentry = Object.create(SentryService.prototype) as SentryService;
  Object.defineProperty(sentry, 'captureException', { value: jest.fn() });
  const secrets = Object.create(AuthSecretsService.prototype) as AuthSecretsService;
  Object.defineProperty(secrets, 'getProviderKey', {
    value: jest.fn(async () => undefined),
  });
  const detector = new CliDetectionService(
    logger, sentry, {} as IProcessSpawner, secrets, null, factory,
  );
  return { detector, logger, sentry, secrets };
}

function service(factory: CodexAdapterFactory | null = null): CliDetectionService {
  return serviceWithDeps(factory).detector;
}

describe('Codex adapter selection', () => {
  beforeEach(() => {
    mockAdapters.clear();
    jest.clearAllMocks();
    for (const name of names) mockAdapters.set(name, makeAdapter(name, `${name}-model`));
  });

  it('marks Codex unavailable when the native factory is absent or null', async () => {
    for (const detector of [service(), service(null)]) {
      expect(await detector.getDetection('codex')).toMatchObject({ installed: false });
      await expect(detector.getAdapter('codex')?.runSdk({
        task: 'work', workingDirectory: '/work',
      })).rejects.toThrow('Native Codex lane adapter factory is not registered');
    }
  });

  it('resolves an unregistered factory as unavailable and a host binding as native', async () => {
    const child = container.createChildContainer();
    const { logger, sentry, secrets } = serviceWithDeps();
    child.registerInstance<Logger>(TOKENS.LOGGER, logger);
    child.registerInstance<SentryService>(TOKENS.SENTRY_SERVICE, sentry);
    child.registerInstance<IProcessSpawner>(
      SDK_TOKENS.SDK_PROCESS_SPAWNER, {} as IProcessSpawner,
    );
    child.registerInstance<AuthSecretsService>(TOKENS.AUTH_SECRETS_SERVICE, secrets);
    child.registerInstance<ClaudeCliAdapter>(
      ClaudeCliAdapter, Object.create(ClaudeCliAdapter.prototype) as ClaudeCliAdapter,
    );
    expect(child.isRegistered(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, true)).toBe(false);
    expect(await child.resolve(CliDetectionService).getDetection('codex'))
      .toMatchObject({ installed: false });

    const native = makeAdapter('codex', 'native-model');
    child.register<CodexAdapterFactory>(CLI_AGENT_RUNTIME_TOKENS.CODEX_ADAPTER_FACTORY, {
      useValue: { create: () => native },
    });
    expect(child.resolve(CliDetectionService).getAdapter('codex')).toBe(native);
  });

  it('routes detection, models, capabilities, and runSdk to the selected native adapter', async () => {
    const native = makeAdapter('codex', 'native-model');
    const factory = { create: jest.fn(() => native) } satisfies CodexAdapterFactory;
    const detector = service(factory);
    const options: CliCommandOptions = { task: 'work', workingDirectory: '/work' };

    expect(factory.create).toHaveBeenCalledTimes(1);
    expect(detector.getAdapter('codex')).toBe(native);
    expect(detector.getAdapter('codex')?.capabilities()).toEqual(native.capabilities());
    expect(await detector.getDetection('codex')).toMatchObject({ path: '/bin/codex' });
    expect(await detector.listModelsForAll()).toMatchObject({
      codex: [{ id: 'native-model', name: 'native-model' }],
    });
    await detector.getAdapter('codex')?.runSdk(options);
    expect(native.runSdk).toHaveBeenCalledWith(options);
    expect(native.detect).toHaveBeenCalledTimes(1);
    expect(native.listModels).toHaveBeenCalledTimes(1);
  });

  it('surfaces a selected native runSdk failure', async () => {
    const native = makeAdapter('codex', 'native-model');
    const failure = new Error('native open failed');
    jest.spyOn(native, 'runSdk').mockRejectedValue(failure);
    const detector = service({ create: () => native });

    await expect(detector.getAdapter('codex')?.runSdk({
      task: 'work', workingDirectory: '/work',
    })).rejects.toBe(failure);
  });

  it('reports a selected native detect failure', async () => {
    const native = makeAdapter('codex', 'native-model');
    const failure = new Error('native detection failed');
    jest.spyOn(native, 'detect').mockRejectedValue(failure);
    const { detector, sentry } = serviceWithDeps({ create: () => native });

    expect(await detector.getDetection('codex')).toMatchObject({ installed: false });
    expect(sentry.captureException).toHaveBeenCalledWith(failure, {
      errorSource: 'CliDetectionService.doDetectAll',
    });
  });

  it('omits models after a selected native listModels failure', async () => {
    const native = makeAdapter('codex', 'native-model');
    const failure = new Error('native models failed');
    Object.defineProperty(native, 'listModels', {
      value: jest.fn(async () => { throw failure; }),
    });
    const { detector, sentry } = serviceWithDeps({ create: () => native });

    const models = await detector.listModelsForAll();
    expect(models).not.toHaveProperty('codex');
    expect(models).toHaveProperty('copilot');
    expect(sentry.captureException).toHaveBeenCalledWith(failure, {
      errorSource: 'CliDetectionService.listModelsForAll',
    });
  });

  it('keeps detection and model caches on the selected adapter and leaves peers unchanged', async () => {
    const native = makeAdapter('codex', 'native-model');
    const detector = service({ create: () => native });
    const copilot = adapter('copilot');
    expect(detector.getAdapter('copilot')).toBe(copilot);

    await detector.detectAll();
    await detector.listModelsForAll();
    await detector.detectAll();
    await detector.listModelsForAll();
    expect(native.detect).toHaveBeenCalledTimes(1);
    expect(native.listModels).toHaveBeenCalledTimes(1);
    expect(copilot.detect).toHaveBeenCalledTimes(1);
    expect(copilot.listModels).toHaveBeenCalledTimes(1);

    detector.invalidateCache();
    await detector.listModelsForAll();
    expect(native.detect).toHaveBeenCalledTimes(2);
    expect(native.listModels).toHaveBeenCalledTimes(2);
  });
});
