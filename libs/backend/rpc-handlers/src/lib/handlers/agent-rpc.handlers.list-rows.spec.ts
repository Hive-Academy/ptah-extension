import 'reflect-metadata';

jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SDK_PTAH_CLI_REGISTRY: Symbol.for('PtahCliRegistry'),
  },
  PTAH_CLI_ROLE_DELIVERY: {
    roleDelivery: 'native',
    roleChannel: 'agent-selection',
  },
  AgentContinueError: class AgentContinueError extends Error {},
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: {
    SDK_SESSION_METADATA_STORE: Symbol.for('SessionMetadataStore'),
  },
}));

jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: { SDK_CODEX_AUTH: Symbol.for('CodexAuthService') },
}));

import type {
  IAuthSecretsService,
  Logger,
  RpcHandler,
} from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type {
  IWorkspaceProvider,
  IStateStorage,
  IModelDiscovery,
} from '@ptah-extension/platform-core';
import {
  PTAH_CLI_ROLE_DELIVERY,
  type CliDetectionService,
  type AgentProcessManager,
  type PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { CodexAuthService } from '@ptah-extension/auth-providers';
import type { CliDetectionResult } from '@ptah-extension/shared';
import type { DependencyContainer } from 'tsyringe';

import { AgentRpcHandlers } from './agent-rpc.handlers';

const CODEX_ROW: CliDetectionResult = {
  cli: 'codex',
  installed: true,
  messagingMode: 'queue',
  roleDelivery: 'preamble',
  roleChannel: 'developer-instructions',
};

interface Harness {
  rpcHandler: MockRpcHandler;
  registry: { listAgents: jest.Mock };
}

function makeHarness(): Harness {
  const rpcHandler = createMockRpcHandler();
  const registry = { listAgents: jest.fn().mockResolvedValue([]) };
  const cliDetection = {
    getAdapter: jest.fn().mockReturnValue(undefined),
    invalidateCache: jest.fn(),
    detectAll: jest.fn().mockResolvedValue([CODEX_ROW]),
  };
  const workspace = {
    getWorkspaceRoot: jest.fn().mockReturnValue('D:/ws'),
    getConfiguration: jest.fn((_s: string, _k: string, d: unknown) => d),
  };
  const stateStorage = {
    get: jest.fn((key: string) =>
      key === 'agentOrchestration.migratedToFileSettings' ? true : undefined,
    ),
    update: jest.fn(),
  };

  const handlers = new AgentRpcHandlers(
    createMockLogger() as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    cliDetection as unknown as CliDetectionService,
    registry as unknown as PtahCliRegistry,
    {} as unknown as AgentProcessManager,
    {} as unknown as SessionMetadataStore,
    workspace as unknown as IWorkspaceProvider,
    stateStorage as unknown as IStateStorage,
    {} as unknown as IModelDiscovery,
    {} as unknown as CodexAuthService,
    {
      isRegistered: jest.fn().mockReturnValue(false),
      resolve: jest.fn(),
    } as unknown as DependencyContainer,
    {
      hasProviderKey: jest.fn().mockResolvedValue(false),
    } as unknown as IAuthSecretsService,
  );
  handlers.register();

  return { rpcHandler, registry };
}

async function detectClis(h: Harness): Promise<CliDetectionResult[]> {
  const response = await h.rpcHandler.handleMessage({
    method: 'agent:detectClis',
    params: undefined,
    correlationId: 'corr-detect',
  });
  return (response.data as { clis: CliDetectionResult[] }).clis;
}

describe('AgentRpcHandlers — ptah-cli list rows', () => {
  it('stamps PTAH_CLI_ROLE_DELIVERY on every ptah-cli row', async () => {
    const h = makeHarness();
    h.registry.listAgents.mockResolvedValue([
      {
        id: 'pc-1',
        name: 'GLM',
        enabled: true,
        hasApiKey: true,
        providerName: 'Z.AI',
        providerId: 'z-ai',
      },
      {
        id: 'pc-2',
        name: 'Kimi',
        enabled: true,
        hasApiKey: true,
        providerName: 'Moonshot',
        providerId: 'moonshot',
      },
    ]);

    const clis = await detectClis(h);
    const ptahRows = clis.filter((c) => c.cli === 'ptah-cli');

    expect(ptahRows).toHaveLength(2);
    for (const row of ptahRows) {
      expect(row.roleDelivery).toBe(PTAH_CLI_ROLE_DELIVERY.roleDelivery);
      expect(row.roleChannel).toBe(PTAH_CLI_ROLE_DELIVERY.roleChannel);
      expect(row).toMatchObject({
        roleDelivery: 'native',
        roleChannel: 'agent-selection',
      });
    }
    expect(ptahRows[0]).toMatchObject({
      ptahCliId: 'pc-1',
      ptahCliName: 'GLM',
      providerName: 'Z.AI',
      providerId: 'z-ai',
    });
  });

  it('leaves the detected system-CLI rows exactly as detection produced them', async () => {
    const h = makeHarness();
    h.registry.listAgents.mockResolvedValue([
      { id: 'pc-1', name: 'GLM', enabled: true, hasApiKey: true },
    ]);

    const clis = await detectClis(h);

    expect(clis[0]).toEqual(CODEX_ROW);
  });

  it('omits disabled and keyless ptah-cli agents from the rows', async () => {
    const h = makeHarness();
    h.registry.listAgents.mockResolvedValue([
      { id: 'off', name: 'A', enabled: false, hasApiKey: true },
      { id: 'no-key', name: 'B', enabled: true, hasApiKey: false },
    ]);

    const clis = await detectClis(h);

    expect(clis.filter((c) => c.cli === 'ptah-cli')).toHaveLength(0);
  });
});
