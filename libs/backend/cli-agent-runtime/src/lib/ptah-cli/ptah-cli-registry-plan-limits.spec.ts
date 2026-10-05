/**
 * PtahCliRegistry.spawnAgent — lane owner and plan-limit wiring
 * (TASK_2026_596, Component 10; Batch 11 carry-forward 1).
 *
 * Drives the REAL spawnAgent() for a `claude-cli` lane and proves:
 *   - after the system init, the lane's own `accountInfo()` is read once and
 *     the owner reaches `AgentProcessManager.recordQuotaOwner` for the agent id
 *     the manager gave the run — BEFORE the turn is released to the manager,
 *     so the exit is classified and persisted with that owner;
 *   - a failed `accountInfo()` leaves the owner unknown, does not throw, and
 *     still releases the turn;
 *   - the lane's success reaches the ledger under the recorded owner.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/ptah-cli/ptah-cli-registry.ts
 */

import 'reflect-metadata';

import { createMockLogger } from '@ptah-extension/shared/testing';
import { TOKENS } from '@ptah-extension/vscode-core';
import type { Logger, IAuthSecretsService } from '@ptah-extension/vscode-core';
import type {
  SdkModuleLoader,
  SdkMessageTransformer,
  SdkPermissionHandler,
  SDKMessage,
} from '@ptah-extension/agent-sdk';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  AUTH_PROVIDERS_TOKENS,
  type ProviderModelsService,
} from '@ptah-extension/auth-providers';
import type {
  EffectiveCapabilitySet,
  PtahCliConfig,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import type { DependencyContainer } from 'tsyringe';
import { PtahCliRegistry } from './ptah-cli-registry';
import { createFakeSdkProcessSpawner } from './testing/fake-sdk-process-spawner';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import { LaneOwnerResolver } from '../cli-agents/limits/lane-owner.resolver';

jest.mock('@ptah-extension/agent-sdk', () => {
  const actual = jest.requireActual('@ptah-extension/agent-sdk');
  return {
    ...actual,
    getAnthropicProvider: jest.fn(() => ({
      id: 'claude-cli',
      name: 'Claude (Subscription)',
      baseUrl: '',
      authEnvVar: 'ANTHROPIC_API_KEY',
      authType: 'none',
      nativeAuth: true,
      keyPrefix: '',
      helpUrl: '',
      description: '',
      keyPlaceholder: '',
      maskedKeyDisplay: '',
      defaultTiers: {
        opus: 'claude-opus-4-8',
        sonnet: 'claude-sonnet-4-6',
        haiku: 'claude-haiku-4-5',
      },
    })),
    getProviderAuthEnvVar: jest.fn(() => 'ANTHROPIC_API_KEY'),
    seedStaticModelPricing: jest.fn(),
    buildSafeEnv: jest.fn((env: unknown) => env),
  };
});

const SESSION_ID = '550e8400-e29b-41d4-a716-446655440000';

const claudeAccount: QuotaOwnerRef = {
  providerId: 'anthropic',
  identityKind: 'account',
  key: 'anthropic#account:0123456789abcdef',
  label: 'Claude account',
};

const CONFIG: PtahCliConfig = {
  id: 'pc-claude-001',
  name: 'Claude Lane',
  providerId: 'claude-cli',
  enabled: true,
  tierMappings: undefined,
  updatedAt: 0,
};

const MESSAGES: SDKMessage[] = [
  {
    type: 'system',
    subtype: 'init',
    session_id: SESSION_ID,
    model: 'claude-sonnet-4-6',
  } as unknown as SDKMessage,
  {
    type: 'stream_event',
    parent_tool_use_id: null,
    event: { type: 'message_start', message: { model: 'claude-sonnet-4-6' } },
  } as unknown as SDKMessage,
  {
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', rateLimitType: 'five_hour' },
  } as unknown as SDKMessage,
  { type: 'result', subtype: 'success', num_turns: 1 } as unknown as SDKMessage,
];

interface Harness {
  registry: PtahCliRegistry;
  accountInfo: jest.Mock;
  recordQuotaOwner: jest.Mock;
  ownerForClaudeAccount: jest.Mock;
  recordSuccess: jest.Mock;
}

function buildHarness(accountInfo: jest.Mock): Harness {
  const logger = createMockLogger();
  const queryFn = jest.fn(() => {
    async function* stream(): AsyncGenerator<SDKMessage, void, unknown> {
      for (const message of MESSAGES) yield message;
    }
    return Object.assign(stream(), { accountInfo });
  });

  const policy: EffectiveCapabilitySet = {
    physicalRoot: '/test/dir',
    policyKey: '/test/dir',
    status: 'verified',
    reasons: [],
    ptahEnabled: true,
    deniedMcpServers: [],
    approvedProjectMcpServers: [],
    deniedSkillNames: [],
    disabledPluginIds: [],
    harnessFingerprint: 'fp-test',
  };
  const recordQuotaOwner = jest.fn(() => true);
  const ownerForClaudeAccount = jest.fn(() => claudeAccount);
  const recordSuccess = jest.fn();
  const services = new Map<symbol, unknown>([
    [
      SDK_TOKENS.SDK_CAPABILITY_RESOLVER,
      { resolve: jest.fn().mockResolvedValue(policy) },
    ],
    [
      CLI_AGENT_RUNTIME_TOKENS.LANE_OWNER_RESOLVER,
      new LaneOwnerResolver(logger as unknown as Logger, {
        ownerForClaudeAccount,
        ownerForPtahCli: jest.fn(),
        ownerForCodexHome: jest.fn(),
        ownerForCliStore: jest.fn(),
      }),
    ],
    [
      AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER,
      {
        recordWindowEvidence: jest.fn(),
        recordOwnerEvidence: jest.fn(),
        recordCooldown: jest.fn(),
        recordSuccess,
      },
    ],
    [TOKENS.AGENT_PROCESS_MANAGER, { recordQuotaOwner }],
  ]);
  const container = {
    isRegistered: (token: symbol) => services.has(token),
    resolve: (token: symbol) => services.get(token),
  } as unknown as DependencyContainer;

  const registry = new PtahCliRegistry(
    logger as unknown as Logger,
    {
      getProviderKey: jest.fn().mockResolvedValue(undefined),
    } as unknown as IAuthSecretsService,
    {
      getQueryFunction: jest.fn().mockResolvedValue(queryFn),
      getCliJsPath: jest.fn().mockResolvedValue(undefined),
    } as unknown as SdkModuleLoader,
    {
      createIsolated: jest.fn().mockReturnValue({
        transform: jest.fn().mockReturnValue([]),
      }),
    } as unknown as SdkMessageTransformer,
    {
      getPermissionLevel: jest.fn().mockReturnValue('yolo'),
      createCallback: jest.fn(),
    } as unknown as SdkPermissionHandler,
    null as never, // subagentHookHandler
    null as never, // compactionHookHandler
    null as never, // compactionConfigProvider
    {
      getModelTiers: jest
        .fn()
        .mockReturnValue({ sonnet: null, opus: null, haiku: null }),
    } as unknown as ProviderModelsService,
    { loadConfigs: jest.fn().mockReturnValue([CONFIG]) } as unknown as never,
    {
      assembleSpawnOptions: jest.fn().mockResolvedValue({
        mcpServers: {},
        hooks: undefined,
        autoCompact: {},
        systemPromptMode: 'append',
        systemPromptContent: undefined,
      }),
    } as unknown as never,
    null as never, // modelResolver
    { get: jest.fn(() => undefined) } as unknown as never, // configManager
    createFakeSdkProcessSpawner(),
    null, // harnessPreflight
    container,
  );
  return {
    registry,
    accountInfo,
    recordQuotaOwner,
    ownerForClaudeAccount,
    recordSuccess,
  };
}

async function spawnLane(harness: Harness) {
  const result = await harness.registry.spawnAgent(CONFIG.id, 'do work', {
    agentId: 'agent-claude-1',
  });
  if ('status' in result) throw new Error(result.message);
  // What `AgentProcessManager.trackSdkHandle` does once it tracks the run.
  result.handle.setAgentId?.('agent-claude-1');
  return result.handle;
}

async function flush(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

describe('PtahCliRegistry.spawnAgent — lane owner and plan limits', () => {
  it('records the lane owner from accountInfo() before the turn is released', async () => {
    let releaseAccount!: (account: { email: string }) => void;
    const accountInfo = jest.fn(
      () =>
        new Promise<{ email: string }>((resolve) => {
          releaseAccount = resolve;
        }),
    );
    const harness = buildHarness(accountInfo);
    const handle = await spawnLane(harness);
    let turnReleased = false;
    const done = handle.done.then((exitCode) => {
      turnReleased = true;
      return exitCode;
    });

    await flush();
    expect(accountInfo).toHaveBeenCalledTimes(1);
    // The result is already in, but the owner read has not settled.
    expect(turnReleased).toBe(false);

    releaseAccount({ email: 'dev@example.test' });
    await expect(done).resolves.toBe(0);

    expect(harness.ownerForClaudeAccount).toHaveBeenCalledWith(
      { email: 'dev@example.test' },
      'run:agent-claude-1',
    );
    expect(harness.recordQuotaOwner).toHaveBeenCalledWith(
      'agent-claude-1',
      claudeAccount,
    );
    await flush();
    expect(harness.recordSuccess).toHaveBeenCalledWith({
      ownerKey: claudeAccount.key,
      modelScopes: ['sonnet'],
      billing: 'plan',
      observedAt: expect.any(Number),
    });
  });

  it('leaves the owner unknown and still releases the turn when accountInfo() fails', async () => {
    const accountInfo = jest.fn().mockRejectedValue(new Error('no login'));
    const harness = buildHarness(accountInfo);
    const handle = await spawnLane(harness);

    await expect(handle.done).resolves.toBe(0);
    await flush();

    expect(accountInfo).toHaveBeenCalledTimes(1);
    expect(harness.recordQuotaOwner).not.toHaveBeenCalled();
    expect(harness.recordSuccess).not.toHaveBeenCalled();
  });
});
