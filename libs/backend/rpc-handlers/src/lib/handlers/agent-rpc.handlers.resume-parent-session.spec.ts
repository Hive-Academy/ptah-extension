/**
 * AgentRpcHandlers — parent-session threading on `agent:resumeCliSession`
 * (TASK_2026_295).
 *
 * The Ptah CLI resume path spawns in two halves: `PtahCliRegistry.spawnAgent`
 * creates the SDK-side agent, and `AgentProcessManager.spawnFromSdkHandle`
 * records the process. The second half received `parentSessionId`; the first
 * did not. A resumed agent therefore ran with no parent — its nested subagents
 * registered against nothing and its CLI session reference was dropped on
 * persist.
 *
 * These specs pin that BOTH halves receive the same parent.
 *
 * TASK_2026_296 added the Zod boundary this method never had
 * (`agent-rpc.schema.ts`), so an empty id no longer reaches the normalization
 * at all — it is now REJECTED at the boundary. The second block below pins
 * that boundary: which params are refused, and — the half that gives the
 * refusals meaning — which legitimate params still get through.
 */

import 'reflect-metadata';

jest.mock('fs/promises', () => ({
  readdir: jest.fn(),
  access: jest.fn(),
}));

// The cli-agent-runtime barrel transitively reaches workspace-intelligence's
// tree-sitter loader, which uses `import.meta` and cannot load under CJS jest.
// Only the DI token registry and the error class are needed here — the
// handler is constructed directly, so tsyringe never resolves these.
jest.mock('@ptah-extension/cli-agent-runtime', () => ({
  CLI_AGENT_RUNTIME_TOKENS: {
    SDK_PTAH_CLI_REGISTRY: Symbol.for('PtahCliRegistry'),
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

import * as fs from 'fs/promises';

import type { Logger, RpcHandler } from '@ptah-extension/vscode-core';
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
import type {
  CliDetectionService,
  AgentProcessManager,
  PtahCliRegistry,
} from '@ptah-extension/cli-agent-runtime';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { CodexAuthService } from '@ptah-extension/auth-providers';
import type { DependencyContainer } from 'tsyringe';

import { AgentRpcHandlers } from './agent-rpc.handlers';

const mockReaddir = fs.readdir as unknown as jest.Mock;
const mockAccess = fs.access as unknown as jest.Mock;

const WORKSPACE = 'D:/ws';
const PTAH_CLI_ID = 'pc-agent-1';
const CLI_SESSION_ID = 'cli-session-uuid';

interface Harness {
  handlers: AgentRpcHandlers;
  rpcHandler: MockRpcHandler;
  registry: { spawnAgent: jest.Mock; listAgents: jest.Mock };
  processManager: { spawnFromSdkHandle: jest.Mock; spawn: jest.Mock };
}

function makeHarness(): Harness {
  const rpcHandler = createMockRpcHandler();

  const registry = {
    spawnAgent: jest.fn().mockResolvedValue({
      handle: { onSessionResolved: undefined },
      agentName: 'Test CLI Agent',
      setAgentId: jest.fn(),
    }),
    listAgents: jest.fn().mockResolvedValue([]),
  };

  const processManager = {
    spawnFromSdkHandle: jest.fn().mockResolvedValue({ agentId: 'a-1' }),
    spawn: jest.fn().mockResolvedValue({ agentId: 'a-1' }),
  };

  const workspace = {
    getWorkspaceRoot: jest.fn().mockReturnValue(WORKSPACE),
    // getAgentCfg falls back to the supplied default.
    getConfiguration: jest.fn((_s: string, _k: string, d: unknown) => d),
  };

  const stateStorage = {
    // Short-circuits migrateAgentOrchestrationSettings().
    get: jest.fn((key: string) =>
      key === 'agentOrchestration.migratedToFileSettings' ? true : undefined,
    ),
    update: jest.fn(),
  };

  const cliDetection = { getAdapter: jest.fn().mockReturnValue(undefined) };

  const handlers = new AgentRpcHandlers(
    createMockLogger() as unknown as Logger,
    rpcHandler as unknown as RpcHandler,
    cliDetection as unknown as CliDetectionService,
    registry as unknown as PtahCliRegistry,
    processManager as unknown as AgentProcessManager,
    { createChild: jest.fn() } as unknown as SessionMetadataStore,
    workspace as unknown as IWorkspaceProvider,
    stateStorage as unknown as IStateStorage,
    {} as unknown as IModelDiscovery,
    {} as unknown as CodexAuthService,
    {
      isRegistered: jest.fn().mockReturnValue(false),
      resolve: jest.fn(),
    } as unknown as DependencyContainer,
  );
  handlers.register();

  return { handlers, rpcHandler, registry, processManager };
}

type ResumeResult = { success: boolean; error?: string };

/** Post an arbitrary param bag at the method — used to probe the boundary. */
async function resumeRaw(
  h: Harness,
  params: Record<string, unknown>,
): Promise<ResumeResult> {
  const response = await h.rpcHandler.handleMessage({
    method: 'agent:resumeCliSession',
    params,
    correlationId: 'corr-resume',
  });
  return response.data as ResumeResult;
}

async function resume(
  h: Harness,
  parentSessionId?: string,
): Promise<ResumeResult> {
  return resumeRaw(h, {
    cliSessionId: CLI_SESSION_ID,
    cli: 'ptah-cli',
    task: 'continue the work',
    ptahCliId: PTAH_CLI_ID,
    ...(parentSessionId !== undefined ? { parentSessionId } : {}),
  });
}

describe('AgentRpcHandlers — agent:resumeCliSession parent session', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockAccess.mockReset();
    // The workspace resolves to a project dir and the CLI session file exists.
    mockReaddir.mockResolvedValue(['D-ws']);
    mockAccess.mockResolvedValue(undefined);
  });

  it('threads parentSessionId into PtahCliRegistry.spawnAgent, not just the process manager', async () => {
    const h = makeHarness();

    const result = await resume(h, 'chat-session-uuid');

    expect(result.success).toBe(true);
    expect(h.registry.spawnAgent).toHaveBeenCalledTimes(1);
    const options = h.registry.spawnAgent.mock.calls[0][2];
    expect(options.parentSessionId).toBe('chat-session-uuid');
    // Both halves must agree on the parent.
    expect(
      h.processManager.spawnFromSdkHandle.mock.calls[0][1].parentSessionId,
    ).toBe('chat-session-uuid');
  });

  it('still threads the parent when the CLI session file is missing (fresh start)', async () => {
    const h = makeHarness();
    mockAccess.mockRejectedValue(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
    );

    await resume(h, 'chat-session-uuid');

    const options = h.registry.spawnAgent.mock.calls[0][2];
    // resumeSessionId is correctly dropped — parentSessionId must not be.
    expect(options.resumeSessionId).toBeUndefined();
    expect(options.parentSessionId).toBe('chat-session-uuid');
  });

  // TASK_2026_296 inverted this case. It used to assert that an empty
  // parentSessionId was NORMALIZED to undefined and the resume proceeded. With
  // a schema at the boundary the empty id never gets that far: it is refused,
  // and neither half spawns. The in-handler normalization
  // (`agent-rpc.handlers.ts`, resumePtahCliSession) stays as defence in depth
  // for callers that do not come through this method — `?: string` widens the
  // type without forbidding `''`.
  it('refuses an empty parentSessionId at the boundary instead of normalizing it', async () => {
    const h = makeHarness();

    const result = await resume(h, '');

    expect(result.success).toBe(false);
    expect(result.error).toContain('parentSessionId');
    expect(h.registry.spawnAgent).not.toHaveBeenCalled();
    expect(h.processManager.spawnFromSdkHandle).not.toHaveBeenCalled();
  });

  it('passes undefined when no parentSessionId is supplied at all', async () => {
    const h = makeHarness();

    await resume(h);

    expect(
      h.registry.spawnAgent.mock.calls[0][2].parentSessionId,
    ).toBeUndefined();
  });
});

describe('AgentRpcHandlers — agent:resumeCliSession param validation', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockAccess.mockReset();
    // `sessionFileExists` escapes the workspace root with /[:\\/]/g → '-', so
    // 'D:/ws' becomes 'D--ws'. Matching it exactly is what lets the spec below
    // observe `cliSessionId` reaching the spawn as `resumeSessionId`.
    mockReaddir.mockResolvedValue(['D--ws']);
    mockAccess.mockResolvedValue(undefined);
  });

  // The door an empty session id came through. `cliSessionId: ''` satisfied
  // the inline TypeScript param type — `''` is a `string` — and the handler
  // went on to spawn a process against a session no id names.
  it('rejects an empty cliSessionId and spawns nothing', async () => {
    const h = makeHarness();

    const result = await resumeRaw(h, {
      cliSessionId: '',
      cli: 'codex',
      task: 'continue the work',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cliSessionId');
    expect(h.processManager.spawn).not.toHaveBeenCalled();
    expect(h.registry.spawnAgent).not.toHaveBeenCalled();
  });

  // Paired isolation: the refusal above only means something if the same
  // shape with a real id still spawns.
  it('accepts a non-empty cliSessionId and spawns', async () => {
    const h = makeHarness();

    const result = await resumeRaw(h, {
      cliSessionId: CLI_SESSION_ID,
      cli: 'codex',
      task: 'continue the work',
    });

    expect(result.success).toBe(true);
    expect(h.processManager.spawn).toHaveBeenCalledTimes(1);
    expect(h.processManager.spawn.mock.calls[0][0].resumeSessionId).toBe(
      CLI_SESSION_ID,
    );
  });

  it('rejects a missing cliSessionId', async () => {
    const h = makeHarness();

    const result = await resumeRaw(h, {
      cli: 'codex',
      task: 'continue the work',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('cliSessionId');
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('rejects a wrong-typed cliSessionId without throwing out of the handler', async () => {
    const h = makeHarness();

    const result = await resumeRaw(h, {
      cliSessionId: 123,
      cli: 'codex',
      task: 'continue the work',
    });

    expect(result.success).toBe(false);
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('rejects an unknown cli', async () => {
    const h = makeHarness();

    const result = await resumeRaw(h, {
      cliSessionId: CLI_SESSION_ID,
      cli: 'not-a-cli',
      task: 'continue the work',
    });

    expect(result.success).toBe(false);
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('rejects an empty task', async () => {
    const h = makeHarness();

    const result = await resumeRaw(h, {
      cliSessionId: CLI_SESSION_ID,
      cli: 'codex',
      task: '',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('task');
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  // `.passthrough()`, not `.strict()`: an outdated webview that sends one
  // extra field must not have its whole call rejected.
  it('accepts an unknown extra field rather than rejecting the whole call', async () => {
    const h = makeHarness();

    const result = await resumeRaw(h, {
      cliSessionId: CLI_SESSION_ID,
      cli: 'codex',
      task: 'continue the work',
      someFutureField: 'from a newer webview',
    });

    expect(result.success).toBe(true);
    expect(h.processManager.spawn).toHaveBeenCalledTimes(1);
  });
});

/**
 * The payload `ptah agent-cli resume --cli glm --task "..."` actually sends,
 * run against the real handler (TASK_2026_297).
 *
 * Every case above pins a payload that names its provider explicitly
 * (`ptahCliId: PTAH_CLI_ID`). The CLI deliberately sends NO `ptahCliId` — it
 * has no provider list to resolve against — so it lands on the
 * `resolveDefaultPtahCliId()` branch, which until now no test exercised. That
 * is the branch the fixed command depends on, and "the CLI builds a
 * schema-valid payload" is only half a proof if the half that routes it is
 * unpinned.
 *
 * The payloads here are written literally rather than imported: `libs` cannot
 * import from `apps`, and a literal is what makes the coupling visible if
 * either side drifts. `agent-cli.spec.ts` pins the CLI end of the same bytes.
 */
describe('AgentRpcHandlers — agent:resumeCliSession from ptah agent-cli resume', () => {
  beforeEach(() => {
    mockReaddir.mockReset();
    mockAccess.mockReset();
    mockReaddir.mockResolvedValue(['D-ws']);
    mockAccess.mockResolvedValue(undefined);
  });

  /** Exactly what `buildResumeCliSessionParams` emits with no --ptah-cli-id. */
  const CLI_PAYLOAD = {
    cliSessionId: CLI_SESSION_ID,
    cli: 'ptah-cli',
    task: 'continue the work',
  } as const;

  it('resolves the default provider and reaches resumePtahCliSession', async () => {
    const h = makeHarness();
    h.registry.listAgents.mockResolvedValue([
      { id: PTAH_CLI_ID, name: 'GLM', enabled: true, hasApiKey: true },
    ]);

    const result = await resumeRaw(h, { ...CLI_PAYLOAD });

    expect(result.success).toBe(true);
    // resumePtahCliSession's two halves — this is the path the old
    // `cli: 'glm'` payload could never reach, because it fell through to the
    // system-CLI branch and threw "glm CLI is not installed".
    expect(h.registry.spawnAgent).toHaveBeenCalledTimes(1);
    expect(h.registry.spawnAgent.mock.calls[0][0]).toBe(PTAH_CLI_ID);
    expect(h.registry.spawnAgent.mock.calls[0][1]).toBe('continue the work');
    expect(h.processManager.spawnFromSdkHandle).toHaveBeenCalledTimes(1);
    // The system-CLI spawn path is NOT taken.
    expect(h.processManager.spawn).not.toHaveBeenCalled();
  });

  it('skips providers that are disabled or have no key when resolving the default', async () => {
    const h = makeHarness();
    h.registry.listAgents.mockResolvedValue([
      { id: 'disabled', name: 'A', enabled: false, hasApiKey: true },
      { id: 'no-key', name: 'B', enabled: true, hasApiKey: false },
      { id: PTAH_CLI_ID, name: 'GLM', enabled: true, hasApiKey: true },
    ]);

    const result = await resumeRaw(h, { ...CLI_PAYLOAD });

    expect(result.success).toBe(true);
    expect(h.registry.spawnAgent.mock.calls[0][0]).toBe(PTAH_CLI_ID);
  });

  it('honours an explicit --ptah-cli-id over the default', async () => {
    const h = makeHarness();
    h.registry.listAgents.mockResolvedValue([
      { id: 'default-one', name: 'A', enabled: true, hasApiKey: true },
    ]);

    const result = await resumeRaw(h, {
      ...CLI_PAYLOAD,
      ptahCliId: 'pinned-one',
    });

    expect(result.success).toBe(true);
    expect(h.registry.spawnAgent.mock.calls[0][0]).toBe('pinned-one');
  });

  it('fails with the actionable configuration error when no provider is configured', async () => {
    const h = makeHarness();
    h.registry.listAgents.mockResolvedValue([]);

    const result = await resumeRaw(h, { ...CLI_PAYLOAD });

    // This is the CORRECT failure for an unconfigured machine, and the whole
    // reason the CLI must not invent a ptahCliId of its own: the user is told
    // what to do instead of being told a CLI is not installed.
    expect(result.success).toBe(false);
    expect(result.error).toContain('No Ptah CLI agents configured');
    expect(h.registry.spawnAgent).not.toHaveBeenCalled();
  });
});
