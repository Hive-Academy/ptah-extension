import 'reflect-metadata';
import type {
  AgentRoleChannel,
  CliDetectionResult,
  CliType,
} from '@ptah-extension/shared';
import type { Logger, SentryService } from '@ptah-extension/vscode-core';
import type { IProcessSpawner } from '@ptah-extension/platform-core';

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
jest.mock('./cli-adapters/cursor-cli.adapter', () => ({
  CursorCliAdapter: jest.fn(() => mockAdapterFor('cursor')),
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

import { CliDetectionService } from './cli-detection.service';

const CHANNELS: ReadonlyArray<[CliType, AgentRoleChannel]> = [
  ['codex', 'developer-instructions'],
  ['copilot', 'task-prompt'],
  ['cursor', 'task-prompt'],
  ['antigravity', 'task-prompt'],
  ['opencode', 'task-prompt'],
  ['pi', 'task-prompt'],
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

function createService(): {
  service: CliDetectionService;
  sentry: { captureException: jest.Mock };
} {
  const logger = {
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
  const sentry = { captureException: jest.fn() };
  const service = new CliDetectionService(
    logger,
    sentry as unknown as SentryService,
    {} as IProcessSpawner,
  );
  return { service, sentry };
}

describe('CliDetectionService role stamp', () => {
  beforeEach(() => {
    mockAdapters.clear();
    for (const [name, channel] of CHANNELS) {
      mockAdapters.set(name, createAdapter(name, channel));
    }
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
