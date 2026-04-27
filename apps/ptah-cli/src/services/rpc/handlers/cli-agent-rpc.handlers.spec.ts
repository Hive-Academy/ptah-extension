/**
 * Parity test for the CLI Agent RPC Handlers — TASK_2026_104 B7.
 *
 * Asserts that `CliAgentRpcHandlers` re-registers the same seven `agent:*`
 * methods as the Electron `AgentRpcHandlers`, in the same registration order.
 * Drift between the two apps would silently regress orchestration parity, so
 * this spec is intentionally narrow but mandatory.
 *
 * The `static METHODS` deep-equal check is the primary contract. Per-method
 * dispatch parity is exercised by feeding identical input through both
 * handlers' registered callbacks against identical mocked dependencies, then
 * asserting the resolved values match.
 */

import 'reflect-metadata';
import { container } from 'tsyringe';

import { CliAgentRpcHandlers } from './cli-agent-rpc.handlers.js';
// Cross-app parity import: the Electron `AgentRpcHandlers` is the source of
// truth for the agent RPC surface. Importing it here ensures any drift in
// either tuple fails this test before the apps diverge in production. The
// `@nx/enforce-module-boundaries` rule normally rejects cross-app imports,
// but parity guards are the documented exception (TASK_2026_104 B7).
// eslint-disable-next-line @nx/enforce-module-boundaries
import { AgentRpcHandlers } from '../../../../../ptah-electron/src/services/rpc/handlers/agent-rpc.handlers.js';

interface RegisteredMethod {
  method: string;
  handler: (params: unknown) => unknown;
}

class StubRpcHandler {
  readonly registered: RegisteredMethod[] = [];
  registerMethod<TParams, TResult>(
    method: string,
    handler: (params: TParams) => TResult | Promise<TResult>,
  ): void {
    this.registered.push({
      method,
      handler: handler as (params: unknown) => unknown,
    });
  }
}

class StubLogger {
  debug = jest.fn();
  info = jest.fn();
  warn = jest.fn();
  error = jest.fn();
}

const buildCliDetectionStub = () => ({
  detectAll: jest.fn().mockResolvedValue([]),
  invalidateCache: jest.fn(),
  listModelsForAll: jest.fn().mockResolvedValue({
    gemini: [],
    codex: [],
    copilot: [],
  }),
  getAdapter: jest.fn().mockReturnValue(undefined),
});

const buildPtahCliRegistryStub = () => ({
  listAgents: jest.fn().mockResolvedValue([]),
  spawnAgent: jest.fn(),
});

const buildAgentProcessManagerStub = () => ({
  stop: jest.fn().mockResolvedValue({ status: 'stopped' }),
  spawn: jest.fn().mockResolvedValue({ agentId: 'agent-1' }),
  spawnFromSdkHandle: jest.fn().mockResolvedValue({ agentId: 'agent-1' }),
});

const buildSessionMetadataStoreStub = () => ({
  createChild: jest.fn().mockResolvedValue(undefined),
});

const buildWorkspaceProviderStub = () => ({
  getWorkspaceRoot: jest.fn().mockReturnValue(undefined),
  getConfiguration: jest.fn().mockReturnValue(false),
  setConfiguration: jest.fn().mockResolvedValue(undefined),
});

const buildStateStorageStub = () => {
  const store = new Map<string, unknown>();
  return {
    get: jest.fn(<T>(key: string, defaultValue?: T): T | undefined => {
      const v = store.get(key);
      return v === undefined ? defaultValue : (v as T);
    }),
    update: jest.fn(async (key: string, value: unknown): Promise<void> => {
      store.set(key, value);
    }),
    keys: jest.fn(() => Array.from(store.keys())),
  };
};

function buildHandler<T extends new (...args: never[]) => unknown>(
  Ctor: T,
): {
  instance: InstanceType<T>;
  rpc: StubRpcHandler;
  detection: ReturnType<typeof buildCliDetectionStub>;
  registry: ReturnType<typeof buildPtahCliRegistryStub>;
  processManager: ReturnType<typeof buildAgentProcessManagerStub>;
  sessionMetadata: ReturnType<typeof buildSessionMetadataStoreStub>;
  workspace: ReturnType<typeof buildWorkspaceProviderStub>;
  storage: ReturnType<typeof buildStateStorageStub>;
} {
  const rpc = new StubRpcHandler();
  const detection = buildCliDetectionStub();
  const registry = buildPtahCliRegistryStub();
  const processManager = buildAgentProcessManagerStub();
  const sessionMetadata = buildSessionMetadataStoreStub();
  const workspace = buildWorkspaceProviderStub();
  const storage = buildStateStorageStub();

  const instance = new (Ctor as unknown as new (
    logger: unknown,
    rpc: unknown,
    detection: unknown,
    registry: unknown,
    processManager: unknown,
    sessionMetadata: unknown,
    workspace: unknown,
    storage: unknown,
  ) => InstanceType<T>)(
    new StubLogger(),
    rpc,
    detection,
    registry,
    processManager,
    sessionMetadata,
    workspace,
    storage,
  );

  return {
    instance,
    rpc,
    detection,
    registry,
    processManager,
    sessionMetadata,
    workspace,
    storage,
  };
}

describe('CliAgentRpcHandlers — parity surface', () => {
  afterEach(() => {
    container.clearInstances();
  });

  it('exposes the seven agent:* method names in registration order', () => {
    expect([...CliAgentRpcHandlers.METHODS]).toEqual([
      'agent:getConfig',
      'agent:setConfig',
      'agent:detectClis',
      'agent:listCliModels',
      'agent:permissionResponse',
      'agent:stop',
      'agent:resumeCliSession',
    ]);
  });

  it('registers exactly the METHODS tuple when register() is invoked', () => {
    const harness = buildHandler(
      CliAgentRpcHandlers as unknown as new (
        ...args: never[]
      ) => CliAgentRpcHandlers,
    );
    (harness.instance as unknown as { register(): void }).register();
    const registeredNames = harness.rpc.registered.map((r) => r.method);
    expect(registeredNames).toEqual([...CliAgentRpcHandlers.METHODS]);
  });

  it('METHODS tuple is deep-equal to the Electron AgentRpcHandlers tuple', () => {
    expect([...CliAgentRpcHandlers.METHODS]).toEqual([
      ...AgentRpcHandlers.METHODS,
    ]);
  });
});

describe('CliAgentRpcHandlers — per-method dispatch parity', () => {
  afterEach(() => {
    container.clearInstances();
  });

  function findHandler(rpc: StubRpcHandler, method: string) {
    const entry = rpc.registered.find((r) => r.method === method);
    if (!entry) throw new Error(`method not registered: ${method}`);
    return entry.handler;
  }

  it('agent:getConfig — returns identical defaults from both handlers', async () => {
    const cli = buildHandler(
      CliAgentRpcHandlers as unknown as new (
        ...args: never[]
      ) => CliAgentRpcHandlers,
    );
    const ele = buildHandler(
      AgentRpcHandlers as unknown as new (...args: never[]) => AgentRpcHandlers,
    );
    (cli.instance as unknown as { register(): void }).register();
    (ele.instance as unknown as { register(): void }).register();

    const cliResult = await findHandler(cli.rpc, 'agent:getConfig')(undefined);
    const eleResult = await findHandler(ele.rpc, 'agent:getConfig')(undefined);
    expect(cliResult).toEqual(eleResult);
  });

  it('agent:setConfig — clamps maxConcurrentAgents identically', async () => {
    const cli = buildHandler(
      CliAgentRpcHandlers as unknown as new (
        ...args: never[]
      ) => CliAgentRpcHandlers,
    );
    const ele = buildHandler(
      AgentRpcHandlers as unknown as new (...args: never[]) => AgentRpcHandlers,
    );
    (cli.instance as unknown as { register(): void }).register();
    (ele.instance as unknown as { register(): void }).register();

    const params = { maxConcurrentAgents: 99, mcpPort: 70000 };
    const cliResult = await findHandler(cli.rpc, 'agent:setConfig')(params);
    const eleResult = await findHandler(ele.rpc, 'agent:setConfig')(params);
    expect(cliResult).toEqual(eleResult);
    // Both should have clamped to 10 / 65535.
    expect(cli.storage.update).toHaveBeenCalledWith(
      'agentOrchestration.maxConcurrentAgents',
      10,
    );
    expect(ele.storage.update).toHaveBeenCalledWith(
      'agentOrchestration.maxConcurrentAgents',
      10,
    );
    expect(cli.storage.update).toHaveBeenCalledWith(
      'agentOrchestration.mcpPort',
      65535,
    );
    expect(ele.storage.update).toHaveBeenCalledWith(
      'agentOrchestration.mcpPort',
      65535,
    );
  });

  it('agent:detectClis — returns identical empty payload', async () => {
    const cli = buildHandler(
      CliAgentRpcHandlers as unknown as new (
        ...args: never[]
      ) => CliAgentRpcHandlers,
    );
    const ele = buildHandler(
      AgentRpcHandlers as unknown as new (...args: never[]) => AgentRpcHandlers,
    );
    (cli.instance as unknown as { register(): void }).register();
    (ele.instance as unknown as { register(): void }).register();

    const cliResult = await findHandler(cli.rpc, 'agent:detectClis')(undefined);
    const eleResult = await findHandler(ele.rpc, 'agent:detectClis')(undefined);
    expect(cliResult).toEqual(eleResult);
  });

  it('agent:listCliModels — both return the curated empty lists', async () => {
    const cli = buildHandler(
      CliAgentRpcHandlers as unknown as new (
        ...args: never[]
      ) => CliAgentRpcHandlers,
    );
    const ele = buildHandler(
      AgentRpcHandlers as unknown as new (...args: never[]) => AgentRpcHandlers,
    );
    (cli.instance as unknown as { register(): void }).register();
    (ele.instance as unknown as { register(): void }).register();

    const cliResult = await findHandler(
      cli.rpc,
      'agent:listCliModels',
    )(undefined);
    const eleResult = await findHandler(
      ele.rpc,
      'agent:listCliModels',
    )(undefined);
    expect(cliResult).toEqual(eleResult);
    expect(cliResult).toEqual({ gemini: [], codex: [], copilot: [] });
  });

  it('agent:permissionResponse — both return error when no handler present', async () => {
    const cli = buildHandler(
      CliAgentRpcHandlers as unknown as new (
        ...args: never[]
      ) => CliAgentRpcHandlers,
    );
    const ele = buildHandler(
      AgentRpcHandlers as unknown as new (...args: never[]) => AgentRpcHandlers,
    );
    (cli.instance as unknown as { register(): void }).register();
    (ele.instance as unknown as { register(): void }).register();

    const params = {
      requestId: 'req-1',
      decision: 'allow' as const,
    };
    const cliResult = await findHandler(
      cli.rpc,
      'agent:permissionResponse',
    )(params);
    const eleResult = await findHandler(
      ele.rpc,
      'agent:permissionResponse',
    )(params);
    expect(cliResult).toEqual(eleResult);
    expect(cliResult).toEqual({
      success: false,
      error: 'No permission handler available (neither SDK nor Copilot)',
    });
  });

  it('agent:stop — both delegate to AgentProcessManager.stop', async () => {
    const cli = buildHandler(
      CliAgentRpcHandlers as unknown as new (
        ...args: never[]
      ) => CliAgentRpcHandlers,
    );
    const ele = buildHandler(
      AgentRpcHandlers as unknown as new (...args: never[]) => AgentRpcHandlers,
    );
    (cli.instance as unknown as { register(): void }).register();
    (ele.instance as unknown as { register(): void }).register();

    const params = { agentId: 'fake-agent' };
    const cliResult = await findHandler(cli.rpc, 'agent:stop')(params);
    const eleResult = await findHandler(ele.rpc, 'agent:stop')(params);
    expect(cliResult).toEqual(eleResult);
    expect(cli.processManager.stop).toHaveBeenCalledWith('fake-agent');
    expect(ele.processManager.stop).toHaveBeenCalledWith('fake-agent');
  });

  it('agent:resumeCliSession — non-ptah-cli path produces matching errors', async () => {
    const cli = buildHandler(
      CliAgentRpcHandlers as unknown as new (
        ...args: never[]
      ) => CliAgentRpcHandlers,
    );
    const ele = buildHandler(
      AgentRpcHandlers as unknown as new (...args: never[]) => AgentRpcHandlers,
    );
    (cli.instance as unknown as { register(): void }).register();
    (ele.instance as unknown as { register(): void }).register();

    const params = {
      cliSessionId: 'sess-1',
      cli: 'gemini' as const,
      task: 'do something',
    };
    const cliResult = await findHandler(
      cli.rpc,
      'agent:resumeCliSession',
    )(params);
    const eleResult = await findHandler(
      ele.rpc,
      'agent:resumeCliSession',
    )(params);
    expect(cliResult).toEqual(eleResult);
    // Both delegate to agentProcessManager.spawn for non-ptah-cli path.
    expect(cli.processManager.spawn).toHaveBeenCalled();
    expect(ele.processManager.spawn).toHaveBeenCalled();
  });
});
