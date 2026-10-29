/**
 * AgentRpcHandlers — TASK_2026_614 Batch 25.
 *
 * - G.6 (decision G-D): `agent:resumeCliSession` returns the resume gate's
 *   decision and logs it, on the system-CLI and the Ptah CLI path.
 * - `agent:setConfig` runs one call at a time, so two overlapping writes to
 *   the lane guard pair cannot both pass validation against the same stored
 *   values and leave stop <= steer.
 */

import 'reflect-metadata';

// The cli-agent-runtime barrel transitively reaches workspace-intelligence's
// tree-sitter loader, which uses `import.meta` and cannot load under CJS jest.
// The handler is constructed directly, so only tokens and constants are needed.
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SDK_PTAH_CLI_REGISTRY: Symbol.for('PtahCliRegistry'),
  },
  AgentContinueError: class AgentContinueError extends Error {},
  // Same shape as the real class (`lane-resume-gate.ts`): a fixed message
  // and the refusal code. The handler matches it with `instanceof`.
  LaneAccountResumeError: class LaneAccountResumeError extends Error {
    constructor(readonly code: string) {
      super(`Claude lane account resume refused (${code}).`);
      this.name = 'LaneAccountResumeError';
    }
  },
  MIN_CONCURRENT_AGENTS: 1,
  MAX_CONCURRENT_AGENTS: 10,
}));

jest.mock('@ptah-extension/agent-sdk', () => ({
  SDK_TOKENS: {
    SDK_SESSION_METADATA_STORE: Symbol.for('SessionMetadataStore'),
  },
}));

jest.mock('@ptah-extension/auth-providers', () => ({
  AUTH_PROVIDERS_TOKENS: { SDK_CODEX_AUTH: Symbol.for('CodexAuthService') },
  // Class token only: the handler resolves the account service lazily.
  ProviderAccountService: class ProviderAccountService {},
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
} from '@ptah-extension/platform-core';
import { createMockSecretStorage } from '@ptah-extension/platform-core/testing';
import { DecisionModelKeys } from '@ptah-extension/lane-routing';
import type {
  CliDetectionService,
  AgentProcessManager,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import { LaneAccountResumeError } from '@ptah-extension/cli-agent-runtime';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { AgentResumeOutcome } from '@ptah-extension/shared';
import type { CliModelListService } from '../services/cli-model-list.service';
import type { DependencyContainer } from 'tsyringe';

import { ProviderAccountService } from '@ptah-extension/auth-providers';

import { AgentRpcHandlers } from './agent-rpc.handlers';

const WORKSPACE = 'D:/ws';
const PTAH_CLI_ID = 'pc-agent-1';
const CLI_SESSION_ID = 'cli-session-uuid';

const FRESH: AgentResumeOutcome = {
  decision: 'fresh',
  reason: 'the prompt cache has expired',
  sessionKnown: true,
};

interface Harness {
  rpcHandler: MockRpcHandler;
  logger: ReturnType<typeof createMockLogger>;
  processManager: {
    spawn: jest.Mock;
    spawnFromSdkHandle: jest.Mock;
    reserveAgentId: jest.Mock;
    prepareSdkHandleSpawn: jest.Mock;
    continueConversation: jest.Mock;
  };
  /** Stored `ptah` settings, keyed by the full key (`agentOrchestration.x`). */
  settings: Map<string, unknown>;
  setConfiguration: jest.Mock;
  /** `ProviderAccountService.lookupBySdkSession`, when the service is registered. */
  accountLookup: jest.Mock | undefined;
}

interface HarnessOptions {
  /** Registers a fake account service whose lookup is this mock. */
  readonly accountLookup?: jest.Mock;
}

function makeHarness(options: HarnessOptions = {}): Harness {
  const { accountLookup } = options;
  const rpcHandler = createMockRpcHandler();
  const logger = createMockLogger();
  const settings = new Map<string, unknown>();

  const registry = {
    spawnAgent: jest.fn().mockResolvedValue({
      handle: { onSessionResolved: undefined },
      agentName: 'Test CLI Agent',
      setAgentId: jest.fn(),
    }),
    listAgents: jest.fn().mockResolvedValue([]),
    getMcpPort: jest.fn().mockReturnValue(undefined),
  };

  const processManager = {
    spawn: jest.fn().mockResolvedValue({ agentId: 'a-1' }),
    spawnFromSdkHandle: jest.fn().mockResolvedValue({ agentId: 'a-2' }),
    reserveAgentId: jest.fn().mockReturnValue('reserved-agent-id'),
    prepareSdkHandleSpawn: jest.fn(
      async (input: { task: string; resumeSessionId?: string }) => ({
        task: input.task,
        resumeSessionId: input.resumeSessionId,
      }),
    ),
    continueConversation: jest.fn().mockResolvedValue(undefined),
  };

  // Each write yields to the event loop before it lands, the way the file
  // settings store does, so two unserialised calls would interleave.
  const setConfiguration = jest.fn(
    async (_section: string, key: string, value: unknown) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      settings.set(key, value);
    },
  );

  const workspace = {
    getWorkspaceRoot: jest.fn().mockReturnValue(WORKSPACE),
    getConfiguration: jest.fn((_s: string, key: string, fallback: unknown) =>
      settings.has(key) ? settings.get(key) : fallback,
    ),
    setConfiguration,
  };

  const stateStorage = {
    // Short-circuits migrateAgentOrchestrationSettings().
    get: jest.fn((key: string) =>
      key === 'agentOrchestration.migratedToFileSettings' ? true : undefined,
    ),
    update: jest.fn(),
  };

  const handlers = new AgentRpcHandlers(
    logger as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    {
      getAdapter: jest.fn().mockReturnValue(undefined),
      detectAll: jest.fn().mockResolvedValue([]),
    } as unknown as CliDetectionService,
    registry as unknown as PtahCliRegistry,
    processManager as unknown as AgentProcessManager,
    {
      createChild: jest.fn().mockResolvedValue(undefined),
    } as unknown as SessionMetadataStore,
    workspace as unknown as IWorkspaceProvider,
    stateStorage as unknown as IStateStorage,
    {} as unknown as CliModelListService,
    {
      isRegistered: jest.fn(
        (token: unknown) =>
          accountLookup !== undefined && token === ProviderAccountService,
      ),
      resolve: jest.fn((token: unknown) =>
        token === ProviderAccountService
          ? { lookupBySdkSession: accountLookup }
          : undefined,
      ),
    } as unknown as DependencyContainer,
    {
      hasProviderKey: jest.fn().mockResolvedValue(false),
    } as unknown as IAuthSecretsService,
    { exists: jest.fn().mockResolvedValue(true) } as never,
    { type: 'electron', extensionPath: '/ptah-app' } as never,
    {
      getStatus: () =>
        Promise.resolve({
          selection: { kind: 'unset' as const },
          locality: null,
          reportsConfidence: false,
          state: 'unset' as const,
          detail: null,
        }),
      getSelection: () => ({ kind: 'unset' as const }),
      localityOf: () => null,
      setSelection: () => Promise.resolve({ kind: 'unset' as const }),
      keys: new DecisionModelKeys(
        createMockSecretStorage(),
        createMockLogger(),
      ),
    },
  );
  handlers.register();

  return {
    rpcHandler,
    logger,
    processManager,
    settings,
    setConfiguration,
    accountLookup,
  };
}

async function call<T>(
  h: Harness,
  method: string,
  params: Record<string, unknown>,
): Promise<T> {
  const response = await h.rpcHandler.handleMessage({
    method,
    params,
    correlationId: `corr-${method}`,
  });
  return response.data as T;
}

type ResumeResult = {
  success: boolean;
  agentId?: string;
  error?: string;
  resumeDecision?: AgentResumeOutcome;
};

type SetConfigResult = { success: boolean; error?: string };

function successLogPayload(h: Harness): Record<string, unknown> | undefined {
  const entry = (h.logger.info as jest.Mock).mock.calls.find(
    ([message]) => message === 'RPC: agent:resumeCliSession success',
  );
  return entry?.[1] as Record<string, unknown> | undefined;
}

describe('AgentRpcHandlers — agent:resumeCliSession resume decision (G.6)', () => {
  it('returns and logs the decision on the system-CLI path', async () => {
    const h = makeHarness();
    h.processManager.spawn.mockResolvedValueOnce({
      agentId: 'a-1',
      resumeDecision: FRESH,
    });

    const result = await call<ResumeResult>(h, 'agent:resumeCliSession', {
      cliSessionId: CLI_SESSION_ID,
      cli: 'codex',
      task: 'continue the work',
    });

    expect(result).toEqual({
      success: true,
      agentId: 'a-1',
      resumeDecision: FRESH,
    });
    expect(successLogPayload(h)).toEqual(
      expect.objectContaining({ agentId: 'a-1', resumeDecision: FRESH }),
    );
  });

  it('returns and logs the decision on the Ptah CLI path', async () => {
    const h = makeHarness();
    h.processManager.prepareSdkHandleSpawn.mockResolvedValueOnce({
      task: 'HANDOFF BRIEF',
      resumeDecision: FRESH,
    });
    h.processManager.spawnFromSdkHandle.mockResolvedValueOnce({
      agentId: 'a-2',
      resumeDecision: FRESH,
    });

    const result = await call<ResumeResult>(h, 'agent:resumeCliSession', {
      cliSessionId: CLI_SESSION_ID,
      cli: 'ptah-cli',
      task: 'continue the work',
      ptahCliId: PTAH_CLI_ID,
    });

    expect(
      h.processManager.spawnFromSdkHandle.mock.calls[0][1].resumeDecision,
    ).toEqual(FRESH);
    expect(result).toEqual({
      success: true,
      agentId: 'a-2',
      resumeDecision: FRESH,
    });
    expect(successLogPayload(h)).toEqual(
      expect.objectContaining({ agentId: 'a-2', resumeDecision: FRESH }),
    );
  });

  it('omits the field when the spawn reports no decision', async () => {
    const h = makeHarness();

    const result = await call<ResumeResult>(h, 'agent:resumeCliSession', {
      cliSessionId: CLI_SESSION_ID,
      cli: 'codex',
      task: 'continue the work',
    });

    expect(result).toEqual({ success: true, agentId: 'a-1' });
    expect(successLogPayload(h)).not.toHaveProperty('resumeDecision');
  });
});

describe('AgentRpcHandlers — agent:setConfig serialisation', () => {
  it('starts a call only after the previous one has finished writing', async () => {
    const h = makeHarness();
    const order: string[] = [];
    h.setConfiguration.mockImplementation(
      async (_section: string, key: string, value: unknown) => {
        order.push(`start ${key}`);
        await new Promise<void>((resolve) => setImmediate(resolve));
        h.settings.set(key, value);
        order.push(`end ${key}`);
      },
    );

    await Promise.all([
      call<SetConfigResult>(h, 'agent:setConfig', {
        codexModel: 'gpt-5',
        piModel: 'pi-1',
      }),
      call<SetConfigResult>(h, 'agent:setConfig', { cursorModel: 'c-1' }),
    ]);

    expect(order).toEqual([
      'start agentOrchestration.codexModel',
      'end agentOrchestration.codexModel',
      'start agentOrchestration.piModel',
      'end agentOrchestration.piModel',
      'start agentOrchestration.cursorModel',
      'end agentOrchestration.cursorModel',
    ]);
  });

  it('keeps serving calls after one fails to write', async () => {
    const h = makeHarness();
    h.setConfiguration.mockRejectedValueOnce(new Error('disk full'));

    const [failed, next] = await Promise.all([
      call<SetConfigResult>(h, 'agent:setConfig', { codexModel: 'gpt-5' }),
      call<SetConfigResult>(h, 'agent:setConfig', { piModel: 'pi-1' }),
    ]);

    expect(failed).toEqual({
      success: false,
      error: 'Could not save the orchestration settings.',
    });
    expect(next).toEqual({ success: true });
    expect(h.settings.get('agentOrchestration.piModel')).toBe('pi-1');
  });
});

/**
 * D28: a `claude` lane whose named account the runtime refuses throws
 * `LaneAccountResumeError`. The handler matches it with `instanceof` and
 * replies with the dedicated code and fixed text; the thrown text and the
 * refusal code stay in the host log.
 */
const LANE_ACCOUNT_REFUSED_ERROR =
  'The Claude account for this agent was refused. The agent did not run on another account.';

/** A refusal whose message carries what must never reach the caller. */
function laneAccountResumeError(code: string): Error {
  const error = new LaneAccountResumeError(code);
  error.message =
    'EACCES C:/Users/someone/.claude-profiles/work/.credentials.json user@example.com';
  return error;
}

function expectNoLeak(result: unknown): void {
  const wire = JSON.stringify(result);
  for (const leak of ['credentials', 'claude-profiles', 'C:/', '@example.com']) {
    expect(wire).not.toContain(leak);
  }
}

type ContinueResult = { success: boolean; error?: string; code?: string };

describe('AgentRpcHandlers — agent:continue account refusal (D28)', () => {
  it('maps LaneAccountResumeError to account_refused with fixed text', async () => {
    const h = makeHarness();
    h.processManager.continueConversation.mockRejectedValueOnce(
      laneAccountResumeError('unavailable-storage'),
    );

    const result = await call<ContinueResult>(h, 'agent:continue', {
      agentId: 'a-1',
      message: 'next step',
    });

    expect(result).toEqual({
      success: false,
      code: 'account_refused',
      error: LANE_ACCOUNT_REFUSED_ERROR,
    });
    expectNoLeak(result);
    expect(h.logger.warn).toHaveBeenCalledWith(
      'RPC: agent:continue account refused',
      { agentId: 'a-1', code: 'unavailable-storage' },
    );
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('keeps the specific refusal code in the log, not the reply', async () => {
    const h = makeHarness();
    h.processManager.continueConversation.mockRejectedValueOnce(
      laneAccountResumeError('identity-unproved'),
    );

    const result = await call<ContinueResult>(h, 'agent:continue', {
      agentId: 'a-1',
      message: 'next step',
    });

    expect(result).toEqual({
      success: false,
      code: 'account_refused',
      error: LANE_ACCOUNT_REFUSED_ERROR,
    });
    expect(h.logger.warn).toHaveBeenCalledWith(
      'RPC: agent:continue account refused',
      { agentId: 'a-1', code: 'identity-unproved' },
    );
  });

  it('logs a non-whitelisted code as unavailable-storage', async () => {
    const h = makeHarness();
    h.processManager.continueConversation.mockRejectedValueOnce(
      laneAccountResumeError('C:/secret/path'),
    );

    const result = await call<ContinueResult>(h, 'agent:continue', {
      agentId: 'a-1',
      message: 'next step',
    });

    expect(result.code).toBe('account_refused');
    expect(JSON.stringify((h.logger.warn as jest.Mock).mock.calls)).not.toContain(
      'secret',
    );
    expect(h.logger.warn).toHaveBeenCalledWith(
      'RPC: agent:continue account refused',
      { agentId: 'a-1', code: 'unavailable-storage' },
    );
  });

  it('treats an error only named LaneAccountResumeError as an ordinary failure', async () => {
    const h = makeHarness();
    const impostor = Object.assign(new Error('C:/secret/path'), {
      code: 'identity-unproved',
    });
    impostor.name = 'LaneAccountResumeError';
    h.processManager.continueConversation.mockRejectedValueOnce(impostor);

    const result = await call<ContinueResult>(h, 'agent:continue', {
      agentId: 'a-1',
      message: 'next step',
    });

    expect(result).toEqual({
      success: false,
      code: 'unknown',
      error: 'Failed to continue agent conversation',
    });
  });

  it('leaves an ambient (unbound) continue unchanged', async () => {
    const h = makeHarness();

    const result = await call<ContinueResult>(h, 'agent:continue', {
      agentId: 'a-1',
      message: 'next step',
    });

    expect(result).toEqual({ success: true });
    expect(h.processManager.continueConversation).toHaveBeenCalledWith(
      'a-1',
      'next step',
    );
  });
});

/**
 * TASK_2026_712 Batch 28a: Claude system-lane config keys. Before this batch
 * `agent:setConfig` passed them through the schema and dropped them.
 */
describe('AgentRpcHandlers — Claude lane config keys', () => {
  it('writes claudeModel trimmed and claudeReasoningEffort as sent', async () => {
    const h = makeHarness();

    const result = await call<SetConfigResult>(h, 'agent:setConfig', {
      claudeModel: '  claude-opus-4-1  ',
      claudeReasoningEffort: 'xhigh',
    });

    expect(result).toEqual({ success: true });
    expect(h.settings.get('agentOrchestration.claudeModel')).toBe(
      'claude-opus-4-1',
    );
    expect(h.settings.get('agentOrchestration.claudeReasoningEffort')).toBe(
      'xhigh',
    );
  });

  it.each(['minimal', 'turbo', 5])(
    'refuses claudeReasoningEffort %p before any write',
    async (value) => {
      const h = makeHarness();

      const result = await call<SetConfigResult>(h, 'agent:setConfig', {
        claudeModel: 'claude-opus-4-1',
        claudeReasoningEffort: value,
      });

      expect(result).toEqual({
        success: false,
        error: 'Unsupported claudeReasoningEffort value',
      });
      expect(h.setConfiguration).not.toHaveBeenCalled();
    },
  );

  it('refuses a non-string claudeModel before any write', async () => {
    const h = makeHarness();

    const result = await call<SetConfigResult>(h, 'agent:setConfig', {
      claudeModel: 42,
    });

    expect(result).toEqual({
      success: false,
      error: 'Unsupported claudeModel value',
    });
    expect(h.setConfiguration).not.toHaveBeenCalled();
  });

  it('reads both keys back on agent:getConfig', async () => {
    const h = makeHarness();
    h.settings.set('agentOrchestration.claudeModel', 'claude-sonnet-4-5');
    h.settings.set('agentOrchestration.claudeReasoningEffort', 'inherit');

    const config = await call<Record<string, unknown>>(
      h,
      'agent:getConfig',
      {},
    );

    expect(config).toEqual(
      expect.objectContaining({
        claudeModel: 'claude-sonnet-4-5',
        claudeReasoningEffort: 'inherit',
      }),
    );
  });

  it('reads the SDK default when nothing is stored', async () => {
    const h = makeHarness();

    const config = await call<Record<string, unknown>>(
      h,
      'agent:getConfig',
      {},
    );

    expect(config).toEqual(
      expect.objectContaining({ claudeModel: '', claudeReasoningEffort: '' }),
    );
  });
});

const PROFILE_ID = 'profile-aaaa1111';

const STORED_BINDING = {
  version: 1,
  provider: 'claude',
  profileId: PROFILE_ID,
  routeRevision: 0,
  routeFingerprint: 'f'.repeat(32),
  authEpoch: 0,
  runId: 'run-00000001',
  identity: { kind: 'unknown' },
} as const;

function resumeParams(
  cli: string,
  accountSelection?: unknown,
): Record<string, unknown> {
  return {
    cliSessionId: CLI_SESSION_ID,
    cli,
    task: 'continue the work',
    ...(accountSelection === undefined ? {} : { accountSelection }),
  };
}

/**
 * TASK_2026_712 plan 237: a resume never switches accounts. A supplied
 * selection is compared with the stored binding before spawn.
 */
describe('AgentRpcHandlers — agent:resumeCliSession account selection', () => {
  it('needs no account argument and reads no account store', async () => {
    const lookup = jest.fn();
    const h = makeHarness({ accountLookup: lookup });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude'),
    );

    expect(result).toEqual({ success: true, agentId: 'a-1' });
    expect(lookup).not.toHaveBeenCalled();
    // Batch 34d: an absent selection stays absent on the spawn request.
    expect(h.processManager.spawn).toHaveBeenCalledTimes(1);
    expect(h.processManager.spawn.mock.calls[0][0]).not.toHaveProperty(
      'accountSelection',
    );
  });

  it('treats an omitted selection as no selection', async () => {
    const lookup = jest.fn();
    const h = makeHarness({ accountLookup: lookup });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'omitted' }),
    );

    expect(result.success).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
    expect(h.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({ accountSelection: { kind: 'omitted' } }),
    );
  });

  it('resumes an ambient session that restates ambient', async () => {
    const lookup = jest.fn().mockResolvedValue({ status: 'absent' });
    const h = makeHarness({ accountLookup: lookup });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'ambient' }),
    );

    expect(result.success).toBe(true);
    expect(lookup).toHaveBeenCalledWith({
      provider: 'claude',
      sdkSessionId: CLI_SESSION_ID,
    });
    // Batch 34d: the validated ambient selection reaches the spawn request.
    expect(h.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cli: 'claude',
        resumeSessionId: CLI_SESSION_ID,
        accountSelection: { kind: 'ambient' },
      }),
    );
  });

  it('refuses ambient on a bound session before spawn', async () => {
    const h = makeHarness({
      accountLookup: jest
        .fn()
        .mockResolvedValue({ status: 'bound', binding: STORED_BINDING }),
    });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'ambient' }),
    );

    expect(result).toEqual({
      success: false,
      error: 'Agent resume account refused (conflict).',
    });
    expect(h.processManager.spawn).not.toHaveBeenCalled();
    expect(h.logger.warn).toHaveBeenCalledWith(
      'RPC: agent:resumeCliSession account refused',
      { cli: 'claude', code: 'conflict' },
    );
  });

  it('refuses a different named account before spawn', async () => {
    const h = makeHarness({
      accountLookup: jest
        .fn()
        .mockResolvedValue({ status: 'bound', binding: STORED_BINDING }),
    });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'named', profileId: 'profile-bbbb2222' }),
    );

    expect(result.error).toBe('Agent resume account refused (conflict).');
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('refuses a named account on an ambient session before spawn', async () => {
    const h = makeHarness({
      accountLookup: jest.fn().mockResolvedValue({ status: 'absent' }),
    });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'named', profileId: PROFILE_ID }),
    );

    expect(result.error).toBe('Agent resume account refused (conflict).');
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('forwards a restated named selection to the runtime for claude', async () => {
    const h = makeHarness({
      accountLookup: jest
        .fn()
        .mockResolvedValue({ status: 'bound', binding: STORED_BINDING }),
    });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'named', profileId: PROFILE_ID }),
    );

    expect(result).toEqual({ success: true, agentId: 'a-1' });
    expect(h.processManager.spawn).toHaveBeenCalledTimes(1);
    expect(h.processManager.spawn).toHaveBeenCalledWith(
      expect.objectContaining({
        cli: 'claude',
        resumeSessionId: CLI_SESSION_ID,
        accountSelection: { kind: 'named', profileId: PROFILE_ID },
      }),
    );
  });

  it('maps a runtime LaneAccountResumeError to the fixed refusal text', async () => {
    const h = makeHarness({
      accountLookup: jest
        .fn()
        .mockResolvedValue({ status: 'bound', binding: STORED_BINDING }),
    });
    h.processManager.spawn.mockRejectedValueOnce(
      laneAccountResumeError('identity-unproved'),
    );

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'named', profileId: PROFILE_ID }),
    );

    expect(result).toEqual({
      success: false,
      code: 'account_refused',
      error: LANE_ACCOUNT_REFUSED_ERROR,
    });
    expectNoLeak(result);
    expect(h.logger.warn).toHaveBeenCalledWith(
      'RPC: agent:resumeCliSession account refused',
      { cli: 'claude', code: 'identity-unproved' },
    );
    expect(h.logger.error).not.toHaveBeenCalled();
  });

  it('refuses an unreadable stored binding as invalid-bound', async () => {
    const h = makeHarness({
      accountLookup: jest.fn().mockResolvedValue({ status: 'invalid-bound' }),
    });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'ambient' }),
    );

    expect(result.error).toBe('Agent resume account refused (invalid-bound).');
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('refuses a stored binding that fails validation as invalid-bound', async () => {
    const h = makeHarness({
      accountLookup: jest.fn().mockResolvedValue({
        status: 'bound',
        binding: { ...STORED_BINDING, runId: 'C:/not/an/id' },
      }),
    });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'named', profileId: PROFILE_ID }),
    );

    expect(result.error).toBe('Agent resume account refused (invalid-bound).');
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('fails closed when no account service is registered', async () => {
    const h = makeHarness();

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'ambient' }),
    );

    expect(result.error).toBe(
      'Agent resume account refused (unavailable-storage).',
    );
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('fails closed, path-free, when the lookup throws', async () => {
    const h = makeHarness({
      accountLookup: jest
        .fn()
        .mockRejectedValue(new Error('EACCES C:/Users/someone/.claude.json')),
    });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', { kind: 'ambient' }),
    );

    expect(result.error).toBe(
      'Agent resume account refused (unavailable-storage).',
    );
    expect(JSON.stringify((h.logger.warn as jest.Mock).mock.calls)).not.toContain(
      'EACCES',
    );
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('refuses a named account on a CLI without account bindings', async () => {
    const lookup = jest.fn();
    const h = makeHarness({ accountLookup: lookup });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('codex', { kind: 'named', profileId: PROFILE_ID }),
    );

    expect(result.error).toBe('Agent resume account refused (conflict).');
    expect(lookup).not.toHaveBeenCalled();
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('resumes a CLI without account bindings on ambient', async () => {
    const h = makeHarness();

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('codex', { kind: 'ambient' }),
    );

    expect(result).toEqual({ success: true, agentId: 'a-1' });
    // Only `claude` lanes carry a selection on the spawn request.
    expect(h.processManager.spawn.mock.calls[0][0]).not.toHaveProperty(
      'accountSelection',
    );
  });

  it.each([
    { kind: 'named', profileId: PROFILE_ID, path: 'C:/Users/someone/.claude' },
    { kind: 'named', profileId: PROFILE_ID, env: { CLAUDE_CONFIG_DIR: 'x' } },
    { kind: 'ambient', token: 'sk-secret' },
    { kind: 'named', profileId: PROFILE_ID, ownerKey: 'o'.repeat(32) },
    { kind: 'named', profileId: 'x' },
    { kind: 'default' },
    'ambient',
  ])('rejects malformed selection %p before spawn', async (selection) => {
    const lookup = jest.fn();
    const h = makeHarness({ accountLookup: lookup });

    const result = await call<ResumeResult>(
      h,
      'agent:resumeCliSession',
      resumeParams('claude', selection),
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('invalid params');
    expect(lookup).not.toHaveBeenCalled();
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });
});
