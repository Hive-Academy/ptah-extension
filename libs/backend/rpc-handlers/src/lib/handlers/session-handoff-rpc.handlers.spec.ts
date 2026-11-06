/**
 * SessionHandoffChainRpcHandlers specs (TASK_2026_876, plan component 5).
 */
import 'reflect-metadata';

// The real package pulls an ESM-only wasm module (workspace-intelligence)
// that Jest cannot load as CommonJS; the handler only needs the token.
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SESSION_HANDOFF_CHAIN: Symbol.for('SessionHandoffChain'),
  },
}));

import { container } from 'tsyringe';
import { TOKENS } from '@ptah-extension/vscode-core';
import {
  createMockRpcHandler,
  type MockRpcHandler,
} from '@ptah-extension/vscode-core/testing';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  type ISessionHandoffChain,
} from '@ptah-extension/cli-agent-runtime';
import type { SessionHandoffChainResult } from '@ptah-extension/shared';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';
import { SessionHandoffChainRpcHandlers } from './session-handoff-rpc.handlers';

const WORKSPACE = '/fake/workspace';
const SESSION_A = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const SESSION_B = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002';
const SESSION_C = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003';
const METHOD = 'session:handoffChain';

interface Fakes {
  logger: MockLogger;
  rpcHandler: MockRpcHandler;
  chain: jest.Mocked<ISessionHandoffChain>;
  metadataStore: { get: jest.Mock };
}

function makeFakes(): Fakes {
  return {
    logger: createMockLogger(),
    rpcHandler: createMockRpcHandler(),
    chain: {
      append: jest.fn().mockResolvedValue(undefined),
      read: jest.fn().mockResolvedValue([]),
      onLinkWritten: jest.fn().mockReturnValue(() => undefined),
    },
    metadataStore: { get: jest.fn().mockResolvedValue(null) },
  };
}

function build(
  fakes: Fakes,
  opts: { withChain?: boolean; withMetadata?: boolean } = {},
): void {
  const child = container.createChildContainer();
  child.registerInstance(TOKENS.LOGGER, fakes.logger);
  child.registerInstance(TOKENS.RPC_HANDLER, fakes.rpcHandler);
  if (opts.withChain ?? true) {
    child.registerInstance(
      CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF_CHAIN,
      fakes.chain,
    );
  }
  if (opts.withMetadata ?? true) {
    child.registerInstance(
      SDK_TOKENS.SDK_SESSION_METADATA_STORE,
      fakes.metadataStore,
    );
  }
  child.register(SessionHandoffChainRpcHandlers, {
    useClass: SessionHandoffChainRpcHandlers,
  });
  child.resolve(SessionHandoffChainRpcHandlers).register();
}

function callRaw(fakes: Fakes, params: unknown) {
  return fakes.rpcHandler.handleMessage({
    method: METHOD,
    params: params as Record<string, unknown>,
    correlationId: 'corr-handoff-chain',
  });
}

async function call(
  fakes: Fakes,
  params: unknown,
): Promise<SessionHandoffChainResult> {
  const response = await callRaw(fakes, params);
  if (!response.success) {
    throw new Error(`RPC ${METHOD} failed: ${response.error}`);
  }
  return response.data as SessionHandoffChainResult;
}

function metadata(name: string) {
  return { sessionId: 'x', name, workspaceId: WORKSPACE };
}

describe('SessionHandoffChainRpcHandlers', () => {
  it('owns exactly session:handoffChain', () => {
    expect([...SessionHandoffChainRpcHandlers.METHODS]).toEqual([METHOD]);
  });

  it.each([
    ['a non-UUID id', { sessionId: 'not-a-uuid' }],
    ['a missing id', {}],
    ['null params', null],
  ])('rejects %s with INVALID_PARAMS and reads nothing', async (_l, params) => {
    const fakes = makeFakes();
    build(fakes);

    const response = await callRaw(fakes, params);

    expect(response.success).toBe(false);
    expect(response.errorCode).toBe('INVALID_PARAMS');
    expect(fakes.chain.read).not.toHaveBeenCalled();
  });

  it('answers an empty list for a session with no handoff', async () => {
    const fakes = makeFakes();
    build(fakes);

    await expect(call(fakes, { sessionId: SESSION_A })).resolves.toEqual({
      sessions: [],
    });
  });

  it('returns A→B→C root first with metadata labels, read in the session workspace', async () => {
    const fakes = makeFakes();
    fakes.chain.read.mockResolvedValue([SESSION_A, SESSION_B, SESSION_C]);
    const names: Record<string, string> = {
      [SESSION_A]: 'Plan',
      [SESSION_B]: 'Build',
      [SESSION_C]: 'Review',
    };
    fakes.metadataStore.get.mockImplementation(async (id: string) =>
      metadata(names[id]),
    );
    build(fakes);

    const result = await call(fakes, { sessionId: SESSION_B });

    expect(fakes.chain.read).toHaveBeenCalledTimes(1);
    expect(fakes.chain.read).toHaveBeenCalledWith(SESSION_B, WORKSPACE);
    expect(result.sessions).toEqual([
      { sessionId: SESSION_A, label: 'Plan' },
      { sessionId: SESSION_B, label: 'Build' },
      { sessionId: SESSION_C, label: 'Review' },
    ]);
  });

  it('uses the single-store read and null labels when metadata is missing', async () => {
    const fakes = makeFakes();
    fakes.chain.read.mockResolvedValue([SESSION_A, SESSION_B]);
    build(fakes);

    const result = await call(fakes, { sessionId: SESSION_A });

    expect(fakes.chain.read).toHaveBeenCalledWith(SESSION_A, undefined);
    expect(result.sessions).toEqual([
      { sessionId: SESSION_A, label: null },
      { sessionId: SESSION_B, label: null },
    ]);
  });

  it('logs a metadata read failure and keeps the rest of the chain', async () => {
    const fakes = makeFakes();
    fakes.chain.read.mockResolvedValue([SESSION_A, SESSION_B]);
    fakes.metadataStore.get.mockImplementation(async (id: string) => {
      if (id === SESSION_B) throw new Error('disk gone');
      return metadata('Plan');
    });
    build(fakes);

    const result = await call(fakes, { sessionId: SESSION_A });

    expect(result.sessions).toEqual([
      { sessionId: SESSION_A, label: 'Plan' },
      { sessionId: SESSION_B, label: null },
    ]);
    expect(fakes.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('metadata read failed'),
      expect.any(Error),
    );
  });

  it('answers an empty list when the chain port is not registered', async () => {
    const fakes = makeFakes();
    build(fakes, { withChain: false });

    await expect(call(fakes, { sessionId: SESSION_A })).resolves.toEqual({
      sessions: [],
    });
  });

  it('answers an empty list when the chain read throws', async () => {
    const fakes = makeFakes();
    fakes.chain.read.mockRejectedValue(new Error('broken'));
    build(fakes);

    await expect(call(fakes, { sessionId: SESSION_A })).resolves.toEqual({
      sessions: [],
    });
    expect(fakes.logger.error).toHaveBeenCalledWith(
      expect.stringContaining('chain read failed'),
      expect.any(Error),
    );
  });

  it('works without a metadata store (null labels)', async () => {
    const fakes = makeFakes();
    fakes.chain.read.mockResolvedValue([SESSION_A, SESSION_B]);
    build(fakes, { withMetadata: false });

    const result = await call(fakes, { sessionId: SESSION_B });

    expect(fakes.chain.read).toHaveBeenCalledWith(SESSION_B, undefined);
    expect(result.sessions.map((s) => s.label)).toEqual([null, null]);
  });
});
