/**
 * SessionSpawnerService (TASK_2026_584, Task 5.4).
 *
 * Real: the child registry, the unattended policy registry and the three SDK
 * event registries (driven by hand). Fake: the agent adapter (pattern
 * `peer-session-messenger.service.spec.ts`), the host port, the provisioner,
 * the notifier, turn state, lifecycle, transcript reader, MCP status and the
 * root registrar.
 */
import 'reflect-metadata';
import { resolve } from 'path';
import { container as rootContainer, type DependencyContainer } from 'tsyringe';
import {
  SessionHandoverCoordinator,
  SdkAdapterEvents,
  SessionAdmissionRefusedError,
  SessionEndCallbackRegistry,
  SessionIdResolvedCallbackRegistry,
  UnattendedSessionPolicyRegistry,
  type PermissionPromptLifecycleEvent,
  type PermissionPromptLifecycleListener,
  type SdkAdapterTurnEndedEvent,
} from '@ptah-extension/agent-sdk';
import type {
  AgentProcessInfo,
  SessionHandoverState,
  SessionTurnPhase,
} from '@ptah-extension/shared';
import { resolveWorktreePath, type Logger } from '@ptah-extension/vscode-core';
import { createMockLogger } from '@ptah-extension/shared/testing';
import { SessionChildRegistry } from './session-child.registry';
import {
  SESSION_CHILD_GRACE_MS,
  SessionSpawnerService,
  resolveChildPaths,
} from './session-spawner.service';
import type {
  SessionChildCompletionDelivery,
  SessionChildCompletionEnvelope,
  SessionChildStartRequest,
} from './session-spawner.port';
import type { ChildChatSessionStartInput } from './child-chat-session-host.port';
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';

const PARENT = '11111111-2222-4333-8444-555555555555';
const PARENT_SDK = '22222222-3333-4444-8555-666666666666';
const PARENT_NEW_TAB = '33333333-4444-4555-8666-777777777777';
const OTHER = '44444444-5555-4666-8777-888888888888';
const CHILD_SDK = '55555555-6666-4777-8888-999999999999';
const ROOT = resolve('/repo');
const BRANCH = 'feat/child-1';
const WORKTREE = resolveWorktreePath(ROOT, BRANCH);
const SHA = 'b'.repeat(40);
const PROVISIONED_AT = Date.UTC(2026, 9, 1, 12, 0, 0);

function envelope(turn: number): SessionChildCompletionEnvelope {
  return {
    childSessionId: 'child',
    turn,
    verdict: 'unverified',
    text: `<agent-lane-completed turn="${turn}"/>`,
  };
}

function makeHarness(
  options: {
    config?: Record<string, unknown>;
    /** `null` builds the spawner with no recorder bound (VS Code). */
    recorder?: { recordAgentStartedSession: jest.Mock } | null;
    handoverCoordinator?: Pick<SessionHandoverCoordinator, 'begin' | 'admitOrHold' | 'setResourceLeaseProvider' | 'onStateChange'> | null;
  } = {},
) {
  const logger = createMockLogger() as unknown as Logger;
  const registry = new SessionChildRegistry();
  const policies = new UnattendedSessionPolicyRegistry();
  const adapterEvents = new SdkAdapterEvents(logger);
  const idResolved = new SessionIdResolvedCallbackRegistry(logger);
  const sessionEnd = new SessionEndCallbackRegistry(logger);
  const permissionListeners = new Set<PermissionPromptLifecycleListener>();
  const permissions = {
    onPromptLifecycle: (listener: PermissionPromptLifecycleListener) => {
      permissionListeners.add(listener);
      return () => permissionListeners.delete(listener);
    },
  };
  const active = new Set<string>([PARENT]);
  const adapter = {
    isSessionActive: jest.fn((id: string) => active.has(id)),
    sendMessageToSession: jest.fn().mockResolvedValue(undefined),
    interruptCurrentTurn: jest.fn().mockResolvedValue(true),
    interruptSession: jest.fn().mockResolvedValue(undefined),
  };
  const host = {
    startChildSession: jest.fn(async (input: ChildChatSessionStartInput) => {
      active.add(input.tabId);
      return { started: true as const, uiAnnounced: true };
    }),
  };
  const provisioner = {
    create: jest.fn(async (root: string, branch: string) => {
      jest.setSystemTime(PROVISIONED_AT);
      return {
        ok: true as const,
        worktree: {
          root,
          branch,
          worktreePath: resolveWorktreePath(root, branch),
          baseSha: SHA,
        },
      };
    }),
    rollback: jest.fn().mockResolvedValue([
      { step: 'remove-worktree', ok: true },
      { step: 'delete-branch', ok: true },
    ]),
  };
  const notifier = {
    signalSessionChild: jest.fn(
      async (_subject: unknown, settle: { turn: number }) =>
        ({
          delivered: true,
          parentSessionId: PARENT,
          envelope: envelope(settle.turn),
        }) as SessionChildCompletionDelivery,
    ),
  };
  const environment = {
    scopedWorkspaceRoot: jest.fn(() => ROOT as string | undefined),
  };
  const lanes: AgentProcessInfo[] = [];
  const agents = { listTrackedAgents: jest.fn(() => lanes) };
  const lifecycleIds = new Map<string, string>([[PARENT, PARENT_SDK]]);
  const lifecycle = {
    find: jest.fn((id: string) =>
      lifecycleIds.has(id)
        ? { realSessionId: lifecycleIds.get(id) }
        : undefined,
    ),
  };
  const phases = new Map<string, SessionTurnPhase>();
  const turnState = {
    get: jest.fn((id: string) => {
      const phase = phases.get(id);
      return phase ? { phase } : undefined;
    }),
  };
  const transcripts = { read: jest.fn().mockResolvedValue('') };
  const config = options.config ?? {};
  const workspace = {
    getConfiguration: jest.fn(
      <T>(_section: string, key: string, fallback?: T) =>
        (key in config ? config[key] : fallback) as T,
    ),
    getWorkspaceFolders: jest.fn(() => [ROOT]),
  };
  const lines: string[] = [];
  const output = { appendLine: jest.fn((line: string) => lines.push(line)) };
  const mcpStatus = { getPort: jest.fn((): number | null => 4321) };
  const registrar = {
    retainRoot: jest.fn().mockResolvedValue({ registered: true }),
    releaseRoot: jest.fn().mockResolvedValue(undefined),
  };
  const recorder =
    'recorder' in options
      ? (options.recorder ?? null)
      : { recordAgentStartedSession: jest.fn() };
  const sessionBudget = { release: jest.fn() };

  /** A real child container holding `hostValue` (none when `null`). */
  const containerWith = (hostValue: unknown): DependencyContainer => {
    const scope = rootContainer.createChildContainer();
    if (hostValue !== null) {
      scope.register(CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST, {
        useValue: hostValue,
      });
    }
    return scope;
  };

  const build = (
    overrides: {
      host?: unknown;
      mcpStatus?: unknown;
      container?: DependencyContainer | null;
      handoverCoordinator?: Pick<SessionHandoverCoordinator, 'begin' | 'admitOrHold' | 'setResourceLeaseProvider' | 'onStateChange'> | null;
    } = {},
  ) =>
    new SessionSpawnerService(
      registry,
      provisioner as never,
      notifier as never,
      environment as never,
      agents as never,
      policies,
      adapterEvents,
      idResolved,
      sessionEnd,
      permissions as never,
      lifecycle as never,
      turnState as never,
      transcripts,
      workspace as never,
      output as never,
      adapter as never,
      'container' in overrides
        ? (overrides.container ?? null)
        : containerWith('host' in overrides ? overrides.host : host),
      ('mcpStatus' in overrides ? overrides.mcpStatus : mcpStatus) as never,
      registrar,
      recorder as never,
      sessionBudget,
      ('handoverCoordinator' in overrides
        ? overrides.handoverCoordinator
        : options.handoverCoordinator) as never,
    );

  const spawner = build();

  const request = (
    overrides: Partial<SessionChildStartRequest> = {},
  ): SessionChildStartRequest => ({
    callerSessionId: PARENT,
    task: 'Fix the parser',
    branch: BRANCH,
    label: 'parser fix',
    ...overrides,
  });

  async function startChild(overrides: Partial<SessionChildStartRequest> = {}) {
    const result = await spawner.start(request(overrides));
    if (!result.ok)
      throw new Error(`start refused: ${result.refusal} ${result.detail}`);
    if (!('child' in result)) throw new Error('expected a child start');
    return result.child;
  }

  function turnEnded(
    sessionId: string,
    overrides: Partial<SdkAdapterTurnEndedEvent> = {},
  ): void {
    adapterEvents.emitTurnEnded({
      sessionId,
      cwd: WORKTREE,
      lastAssistantMessage: 'done',
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: null,
      timestamp: 1000,
      ...overrides,
    });
  }

  function emitPermission(event: PermissionPromptLifecycleEvent): void {
    for (const listener of permissionListeners) listener(event);
  }

  return {
    spawner,
    build,
    containerWith,
    registry,
    policies,
    adapterEvents,
    idResolved,
    sessionEnd,
    permissionListeners,
    active,
    adapter,
    host,
    provisioner,
    notifier,
    environment,
    lanes,
    agents,
    lifecycleIds,
    phases,
    transcripts,
    workspace,
    lines,
    mcpStatus,
    registrar,
    recorder,
    sessionBudget,
    request,
    startChild,
    turnEnded,
    emitPermission,
  };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

beforeEach(() => {
  jest.useFakeTimers({ now: Date.UTC(2026, 9, 1, 11, 0, 0) });
});

afterEach(() => {
  jest.useRealTimers();
});

describe('SessionSpawnerService.start — guards in order', () => {
  it('refuses chat-runtime-unavailable first, even for an unattributed caller', async () => {
    const h = makeHarness();
    const spawner = h.build({ host: null });

    const result = await spawner.start(
      h.request({ callerSessionId: undefined }),
    );

    expect(result).toMatchObject({
      ok: false,
      refusal: 'chat-runtime-unavailable',
    });
    expect(h.provisioner.create).not.toHaveBeenCalled();
  });

  describe('lazy chat host lookup (Task 6.6)', () => {
    it('reaches a host registered AFTER the spawner was constructed', async () => {
      const h = makeHarness();
      const scope = h.containerWith(null);
      const spawner = h.build({ container: scope });

      scope.register(CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST, {
        useValue: h.host,
      });
      const result = await spawner.start(h.request());

      expect(result.ok).toBe(true);
      expect(h.host.startChildSession).toHaveBeenCalledTimes(1);
    });

    it('refuses chat-runtime-unavailable while the host is still unregistered at start()', async () => {
      const h = makeHarness();
      const spawner = h.build({ container: h.containerWith(null) });

      const result = await spawner.start(h.request());

      expect(result).toMatchObject({
        ok: false,
        refusal: 'chat-runtime-unavailable',
      });
      expect(h.provisioner.create).not.toHaveBeenCalled();
    });

    it('refuses chat-runtime-unavailable without a container', async () => {
      const h = makeHarness();
      const spawner = h.build({ container: null });

      const result = await spawner.start(h.request());

      expect(result).toMatchObject({
        ok: false,
        refusal: 'chat-runtime-unavailable',
      });
    });

    it('refuses chat-runtime-unavailable and logs when the host fails to construct', async () => {
      const h = makeHarness();
      const scope = h.containerWith(null);
      scope.register(CLI_AGENT_RUNTIME_TOKENS.CHILD_CHAT_SESSION_HOST, {
        useFactory: () => {
          throw new Error('chat services half-registered');
        },
      });
      const spawner = h.build({ container: scope });

      const result = await spawner.start(h.request());

      expect(result).toMatchObject({
        ok: false,
        refusal: 'chat-runtime-unavailable',
      });
      expect(
        h.lines.some((line) => line.includes('chat services half-registered')),
      ).toBe(true);
    });
  });

  it.each([
    ['absent', undefined],
    ['not a UUID (gateway id)', 'gw-telegram-1'],
    ['not live', OTHER],
  ])('refuses an %s caller as unattributed-caller', async (_label, caller) => {
    const h = makeHarness();
    const result = await h.spawner.start(
      h.request({ callerSessionId: caller }),
    );
    expect(result).toMatchObject({ ok: false, refusal: 'unattributed-caller' });
  });

  it('refuses a child calling start as depth-exceeded', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    const result = await h.spawner.start(
      h.request({
        callerSessionId: child.childSessionId,
        branch: 'feat/grandchild',
      }),
    );

    expect(result).toMatchObject({ ok: false, refusal: 'depth-exceeded' });
  });

  it('lets a child start a successor but not another child', async () => {
    const begin = jest.fn().mockReturnValue({ accepted: true, state: {} });
    const h = makeHarness({
      handoverCoordinator: {
        begin,
        admitOrHold: jest.fn(() => ({ held: false })),
        setResourceLeaseProvider: jest.fn(() => () => undefined),
        onStateChange: jest.fn(() => () => undefined),
      },
    });
    const child = await h.startChild();

    await expect(h.spawner.start({
      callerSessionId: child.childSessionId,
      mode: 'successor',
      handoff: 'continue',
    })).resolves.toEqual({ ok: true, successor: true });
    expect(begin).toHaveBeenCalledWith(child.childSessionId, 'successor', false, 'continue');
    await expect(h.spawner.start(h.request({
      callerSessionId: child.childSessionId,
      branch: 'feat/grandchild',
    }))).resolves.toMatchObject({ ok: false, refusal: 'depth-exceeded' });
  });

  it('refuses mcp-unavailable when the server has no port, before reserving', async () => {
    const h = makeHarness({ config: { 'agentSessions.maxConcurrent': 1 } });
    h.mcpStatus.getPort.mockReturnValue(null);

    const result = await h.spawner.start(h.request());

    expect(result).toMatchObject({ ok: false, refusal: 'mcp-unavailable' });
    expect(h.registry.reserveSlot(1)).not.toBeNull();
  });

  it('reserves synchronously: two concurrent starts against cap 1 → one cap-reached', async () => {
    const h = makeHarness({ config: { 'agentSessions.maxConcurrent': 1 } });

    const [first, second] = await Promise.all([
      h.spawner.start(h.request()),
      h.spawner.start(h.request({ branch: 'feat/child-2' })),
    ]);

    expect(first.ok).toBe(true);
    expect(second).toMatchObject({ ok: false, refusal: 'cap-reached' });
    expect(h.provisioner.create).toHaveBeenCalledTimes(1);
  });

  it('names the caller own live children in the cap-reached detail', async () => {
    const h = makeHarness({ config: { 'agentSessions.maxConcurrent': 1 } });
    const child = await h.startChild();

    const result = await h.spawner.start(h.request({ branch: 'feat/child-2' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.refusal).toBe('cap-reached');
    expect(result.detail).toContain(`parser fix (${child.childSessionId})`);
  });

  it.each([
    ['no root', () => undefined],
    [
      'a resolver that names an unopened workspace',
      () => {
        throw new Error('workspace /other is not open');
      },
    ],
    ['a root outside the open folders', () => resolve('/elsewhere')],
  ])('refuses no-workspace for %s and frees the slot', async (_label, impl) => {
    const h = makeHarness({ config: { 'agentSessions.maxConcurrent': 1 } });
    h.environment.scopedWorkspaceRoot.mockImplementation(impl as () => string);

    const result = await h.spawner.start(h.request());

    expect(result).toMatchObject({ ok: false, refusal: 'no-workspace' });
    expect(h.provisioner.create).not.toHaveBeenCalled();
    expect(h.registry.reserveSlot(1)).not.toBeNull();
  });

  it.each([
    ['an escaping deliverable', { deliverables: ['../../etc/passwd'] }],
    ['an absolute task folder', { taskFolder: resolve('/tmp/x') }],
    ['an escaping task folder', { taskFolder: '../outside' }],
    ['an empty task', { task: '   ' }],
  ])(
    'refuses %s as invalid-arguments before any git work',
    async (_label, overrides) => {
      const h = makeHarness();
      const result = await h.spawner.start(h.request(overrides));
      expect(result).toMatchObject({ ok: false, refusal: 'invalid-arguments' });
      expect(h.provisioner.create).not.toHaveBeenCalled();
    },
  );

  it('passes a provisioner refusal through with its rollback and frees the slot', async () => {
    const h = makeHarness({ config: { 'agentSessions.maxConcurrent': 1 } });
    const rollback = [{ step: 'delete-branch', ok: true }];
    h.provisioner.create.mockResolvedValueOnce({
      ok: false,
      refusal: 'worktree-failed',
      detail: 'fatal: disk full',
      rollback,
    } as never);

    const result = await h.spawner.start(h.request());

    expect(result).toEqual({
      ok: false,
      refusal: 'worktree-failed',
      detail: 'fatal: disk full',
      rollback,
    });
    expect(h.registry.reserveSlot(1)).not.toBeNull();
  });
});

describe('SessionSpawnerService — successor lease transfer', () => {
  function withHandover() {
    let stateListener: (state: SessionHandoverState) => void = () => undefined;
    const coordinator = {
      begin: jest.fn(),
      admitOrHold: jest.fn(() => ({ held: false })),
      setResourceLeaseProvider: jest.fn(() => () => undefined),
      onStateChange: jest.fn((listener: (state: SessionHandoverState) => void) => {
        stateListener = listener;
        return () => undefined;
      }),
    };
    const h = makeHarness({ config: { 'agentSessions.maxRuntimeMinutes': 5 } });
    const spawner = h.build({ handoverCoordinator: coordinator as never });
    return { h, spawner, emit: (state: SessionHandoverState) => stateListener(state) };
  }

  it('moves a child lease only when its closing source ends', async () => {
    const { h, spawner, emit } = withHandover();
    const register = jest.spyOn(h.policies, 'register');
    const result = await spawner.start(h.request());
    if (!result.ok || !('child' in result)) throw new Error('expected child');
    const child = result.child;

    emit({ phase: 'closing', sourceSessionId: child.childSessionId, successorTabId: OTHER } as SessionHandoverState);
    expect(h.registry.get(child.childSessionId)).toBeDefined();
    expect(h.policies.get(child.childSessionId)).toBeDefined();

    h.sessionEnd.notifyAll({ sessionId: child.childSessionId, workspaceRoot: WORKTREE });

    expect(h.registry.get(child.childSessionId)).toBeUndefined();
    expect(h.registry.get(OTHER)).toBeDefined();
    expect(h.policies.get(child.childSessionId)).toBeUndefined();
    expect(h.policies.get(OTHER)).toBeDefined();
    expect(register).toHaveBeenLastCalledWith(OTHER, expect.any(Object));
    expect(h.registrar.releaseRoot).not.toHaveBeenCalled();
  });

  it('moves the lease when `closed` is published before the source end', async () => {
    const { h, spawner, emit } = withHandover();
    const result = await spawner.start(h.request());
    if (!result.ok || !('child' in result)) throw new Error('expected child');
    const source = result.child.childSessionId;

    emit({ phase: 'closing', sourceSessionId: source, successorTabId: OTHER } as SessionHandoverState);
    emit({ phase: 'closed', sourceSessionId: source, successorTabId: OTHER } as SessionHandoverState);
    h.sessionEnd.notifyAll({ sessionId: source, workspaceRoot: WORKTREE });

    expect(h.registry.get(source)).toBeUndefined();
    expect(h.registry.get(OTHER)).toBeDefined();
    expect(h.registrar.releaseRoot).not.toHaveBeenCalled();
  });

  it('binds the successor SDK id that resolved before the source ended', async () => {
    const { h, spawner, emit } = withHandover();
    const result = await spawner.start(h.request());
    if (!result.ok || !('child' in result)) throw new Error('expected child');
    h.lifecycleIds.set(OTHER, 'successor-sdk');

    emit({ phase: 'closing', sourceSessionId: result.child.childSessionId, successorTabId: OTHER } as SessionHandoverState);
    h.sessionEnd.notifyAll({ sessionId: result.child.childSessionId, workspaceRoot: WORKTREE });

    expect(h.registry.get('successor-sdk')?.childSessionId).toBe(OTHER);
  });

  it('clears a failed pending transfer so the source end releases normally', async () => {
    const { h, spawner, emit } = withHandover();
    const result = await spawner.start(h.request());
    if (!result.ok || !('child' in result)) throw new Error('expected child');
    const child = result.child;
    h.active.delete(child.childSessionId);

    emit({ phase: 'closing', sourceSessionId: child.childSessionId, successorTabId: OTHER } as SessionHandoverState);
    emit({ phase: 'failed', sourceSessionId: child.childSessionId } as SessionHandoverState);
    h.sessionEnd.notifyAll({ sessionId: child.childSessionId, workspaceRoot: WORKTREE });
    jest.advanceTimersByTime(SESSION_CHILD_GRACE_MS);

    expect(h.registry.get(child.childSessionId)?.terminalStatus).toBe('ended');
    expect(h.registrar.releaseRoot).toHaveBeenCalledWith(WORKTREE);
  });

  it('keeps the original runtime deadline when a lease moves to its successor', async () => {
    const { h, spawner, emit } = withHandover();
    const result = await spawner.start(h.request());
    if (!result.ok || !('child' in result)) throw new Error('expected child');
    const child = result.child;
    h.phases.set(OTHER, 'generating');

    jest.advanceTimersByTime(60_000);
    emit({ phase: 'closing', sourceSessionId: child.childSessionId, successorTabId: OTHER } as SessionHandoverState);
    h.sessionEnd.notifyAll({ sessionId: child.childSessionId, workspaceRoot: WORKTREE });
    jest.advanceTimersByTime(4 * 60_000);
    await flush();

    expect(h.registry.get(OTHER)).toMatchObject({ terminalStatus: 'timed-out' });
    expect(h.adapter.interruptSession).toHaveBeenCalledWith(OTHER);
  });
});

describe('SessionSpawnerService.start — success', () => {
  it('links, registers policy and MCP root, then starts on the host', async () => {
    const h = makeHarness({
      config: {
        'agentSessions.bashAllowlist': ['git status'],
        'agentSessions.permissionDenyWindowMs': 30_000,
      },
    });

    const child = await h.startChild({
      taskFolder: '.ptah/specs/TASK_2026_001',
      deliverables: ['report.md'],
      taskId: 'TASK_2026_001',
      baseRef: 'origin/main',
      model: 'claude-x',
    });

    expect(h.provisioner.create).toHaveBeenCalledWith(
      ROOT,
      BRANCH,
      'origin/main',
    );
    expect(child).toMatchObject({
      parentSessionId: PARENT,
      parentSdkSessionId: PARENT_SDK,
      label: 'parser fix',
      taskId: 'TASK_2026_001',
      branch: BRANCH,
      baseRef: SHA,
      workspaceRoot: ROOT,
      worktreePath: WORKTREE,
      taskFolder: resolve(WORKTREE, '.ptah/specs/TASK_2026_001'),
      deliverables: [
        resolve(WORKTREE, '.ptah/specs/TASK_2026_001', 'report.md'),
      ],
      status: 'starting',
      subagentPtahTools: 'available',
      startedAt: new Date(PROVISIONED_AT).toISOString(),
      turnsSettled: 0,
    });
    expect(h.policies.get(child.childSessionId)).toEqual({
      bashAllowlist: ['git status'],
      writableRoot: WORKTREE,
      denyWindowMs: 30_000,
      ownerLabel: 'child session parser fix',
    });
    expect(h.registrar.retainRoot).toHaveBeenCalledWith(WORKTREE);

    const input = h.host.startChildSession.mock.calls[0][0];
    expect(input).toMatchObject({
      tabId: child.childSessionId,
      workspaceRoot: ROOT,
      worktreePath: WORKTREE,
      sessionName: 'parser fix',
      model: 'claude-x',
    });
    expect(input.prompt).toMatch(/^<ptah-session-contract>/);
    expect(input.prompt).toMatch(/Fix the parser$/);
    expect(input.descriptor).toEqual({
      tabId: child.childSessionId,
      sessionId: null,
      parentTabId: PARENT,
      parentSessionId: PARENT_SDK,
      workspaceRoot: ROOT,
      worktreePath: WORKTREE,
      branch: BRANCH,
      label: 'parser fix',
      taskId: 'TASK_2026_001',
      displayPrompt: 'Fix the parser',
      startedAt: PROVISIONED_AT,
    });
  });

  it('keeps a slash-command task first in the prompt', async () => {
    const h = makeHarness();
    await h.startChild({ task: '/orchestrate TASK_2026_001' });
    expect(h.host.startChildSession.mock.calls[0][0].prompt).toMatch(
      /^\/orchestrate TASK_2026_001\n\n<ptah-session-contract>/,
    );
  });

  it('starts with subagent Ptah tools unavailable when the registrar declines', async () => {
    const h = makeHarness();
    h.registrar.retainRoot.mockResolvedValueOnce({
      registered: false,
      reason: 'busy',
    });
    const child = await h.startChild();
    expect(child.subagentPtahTools).toBe('unavailable');
  });
});

describe('SessionSpawnerService.start — host failure rollback', () => {
  it.each([
    [
      'returns started: false',
      async () => ({ started: false, error: 'sdk down' }),
    ],
    [
      'throws',
      async () => {
        throw new Error('sdk down');
      },
    ],
  ])('rolls back in reverse when the host %s', async (_label, impl) => {
    const h = makeHarness({ config: { 'agentSessions.maxConcurrent': 1 } });
    h.host.startChildSession.mockImplementationOnce(impl as never);

    const result = await h.spawner.start(h.request());

    expect(result).toEqual({
      ok: false,
      refusal: 'session-start-failed',
      detail: 'sdk down',
      rollback: [
        { step: 'release-mcp-root', ok: true },
        { step: 'release-policy', ok: true },
        { step: 'remove-link', ok: true },
        { step: 'remove-worktree', ok: true },
        { step: 'delete-branch', ok: true },
      ],
    });
    const tabId = h.host.startChildSession.mock.calls[0][0].tabId;
    // The exact string retained is the exact string released.
    expect(h.registrar.releaseRoot).toHaveBeenCalledWith(
      h.registrar.retainRoot.mock.calls[0][0],
    );
    expect(h.policies.get(tabId)).toBeUndefined();
    expect(h.registry.get(tabId)).toBeUndefined();
    expect(h.provisioner.rollback).toHaveBeenCalledWith(
      expect.objectContaining({ worktreePath: WORKTREE, branch: BRANCH }),
    );
    expect(h.registry.reserveSlot(1)).not.toBeNull();
  });
});

describe('SessionSpawnerService — settle and completion push', () => {
  it('binds the SDK id from the resolved callback and pushes one completion per settled turn', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.idResolved.notifyAll({
      tabId: child.childSessionId,
      realSessionId: CHILD_SDK,
      timestamp: 1,
    });
    h.phases.set(CHILD_SDK, 'idle');

    h.turnEnded(CHILD_SDK);
    await flush();

    expect(h.notifier.signalSessionChild).toHaveBeenCalledTimes(1);
    const [subject, settle] = h.notifier.signalSessionChild.mock.calls[0] as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(subject).toMatchObject({
      childSessionId: child.childSessionId,
      label: 'parser fix',
      parentSessionIds: [PARENT, PARENT_SDK],
      task: 'Fix the parser',
      worktreePath: WORKTREE,
      branch: BRANCH,
      startedAt: new Date(PROVISIONED_AT).toISOString(),
      lastRecap: 'done',
    });
    expect(settle).toEqual({
      turn: 1,
      status: 'completed',
      completedAt: new Date(1000).toISOString(),
    });
    const status = h.spawner.status({ callerSessionId: PARENT });
    expect(status).toMatchObject({
      ok: true,
      children: [
        {
          sdkSessionId: CHILD_SDK,
          status: 'idle',
          turnsSettled: 1,
          lastCompletion: { turn: 1, verdict: 'unverified', delivered: true },
        },
      ],
    });
  });

  it('dedupes a repeated event timestamp', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.turnEnded(child.childSessionId, { timestamp: 7 });
    h.turnEnded(child.childSessionId, { timestamp: 7 });
    await flush();
    expect(h.notifier.signalSessionChild).toHaveBeenCalledTimes(1);
  });

  it('does not push while background tasks run; status reads waiting', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.phases.set(child.childSessionId, 'awaiting-background');

    h.turnEnded(child.childSessionId, {
      backgroundTasks: [{ taskId: 't1' }] as never,
    });
    await flush();

    expect(h.notifier.signalSessionChild).not.toHaveBeenCalled();
    expect(h.spawner.status({ callerSessionId: PARENT })).toMatchObject({
      children: [{ status: 'waiting' }],
    });
  });

  it('does not push while a CLI lane the child spawned is running', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.phases.set(child.childSessionId, 'idle');
    h.lanes.push({
      agentId: 'lane-1',
      status: 'running',
      parentSessionId: child.childSessionId,
    } as AgentProcessInfo);

    h.turnEnded(child.childSessionId);
    await flush();

    expect(h.notifier.signalSessionChild).not.toHaveBeenCalled();
    expect(h.spawner.status({ callerSessionId: PARENT })).toMatchObject({
      children: [{ status: 'waiting' }],
    });
  });

  it('pushes failed for a failed turn', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.adapterEvents.emitTurnFailed({
      sessionId: child.childSessionId,
      cwd: WORKTREE,
      lastAssistantMessage: null,
      error: 'unknown' as never,
      errorDetails: null,
      terminalReason: null,
      timestamp: 5,
    });
    await flush();
    expect(h.notifier.signalSessionChild.mock.calls[0][1]).toMatchObject({
      turn: 1,
      status: 'failed',
    });
  });

  it('binds the SDK id by cwd when the turn event arrives first', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    h.turnEnded(CHILD_SDK, { cwd: `${WORKTREE}/` });
    await flush();

    expect(h.registry.get(CHILD_SDK)?.childSessionId).toBe(
      child.childSessionId,
    );
    expect(h.notifier.signalSessionChild).toHaveBeenCalledTimes(1);
  });

  it('ignores a turn of another session in the same worktree once the child is bound', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.registry.bindSdkSessionId(child.childSessionId, CHILD_SDK);

    h.turnEnded(OTHER);
    await flush();

    expect(h.notifier.signalSessionChild).not.toHaveBeenCalled();
  });
});

describe('SessionSpawnerService — parent not live: held completions', () => {
  function refusedWith(turn: number): SessionChildCompletionDelivery {
    return {
      delivered: false,
      reason: 'parent-session-not-active',
      envelope: envelope(turn),
    };
  }

  it('holds the latest completion, replaced by a newer one, returned once', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.notifier.signalSessionChild
      .mockResolvedValueOnce(refusedWith(1))
      .mockResolvedValueOnce(refusedWith(2));

    h.turnEnded(child.childSessionId, { timestamp: 1 });
    await flush();
    h.turnEnded(child.childSessionId, { timestamp: 2 });
    await flush();

    expect(h.spawner.status({ callerSessionId: PARENT })).toMatchObject({
      children: [
        {
          heldCompletion: { turn: 2, verdict: 'unverified' },
          lastCompletion: {
            turn: 2,
            delivered: false,
            refusal: 'parent-session-not-active',
          },
        },
      ],
    });

    expect(h.spawner.takeHeldCompletions(PARENT)).toEqual([envelope(2)]);
    expect(h.spawner.takeHeldCompletions(PARENT)).toEqual([]);
    expect(h.spawner.status({ callerSessionId: PARENT })).toMatchObject({
      children: [{ lastCompletion: { turn: 2, delivered: true } }],
    });
  });

  it('lets a parent resumed under a new tab id own, read and collect from its children', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.notifier.signalSessionChild.mockResolvedValueOnce(refusedWith(1));
    h.turnEnded(child.childSessionId);
    await flush();

    h.lifecycleIds.set(PARENT_NEW_TAB, PARENT_SDK);

    expect(h.spawner.status({ callerSessionId: PARENT_NEW_TAB })).toMatchObject(
      {
        ok: true,
        children: [{ childSessionId: child.childSessionId }],
      },
    );
    expect(h.spawner.takeHeldCompletions(PARENT_NEW_TAB)).toEqual([
      envelope(1),
    ]);
  });

  it('never stops children when the parent ends', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    h.active.delete(PARENT);
    h.sessionEnd.notifyAll({ sessionId: PARENT, workspaceRoot: ROOT });
    jest.advanceTimersByTime(SESSION_CHILD_GRACE_MS * 10);

    expect(
      h.registry.get(child.childSessionId)?.terminalStatus,
    ).toBeUndefined();
    expect(h.adapter.interruptSession).not.toHaveBeenCalled();
  });
});

describe('SessionSpawnerService — session organization record (TASK_2026_580 R-TL8)', () => {
  function resolveChild(
    h: ReturnType<typeof makeHarness>,
    childSessionId: string,
  ): void {
    h.idResolved.notifyAll({
      tabId: childSessionId,
      realSessionId: CHILD_SDK,
      timestamp: 1,
    });
  }

  /** The harness's default recorder; fails loudly if a test lost it. */
  function recordCalls(h: ReturnType<typeof makeHarness>): jest.Mock {
    if (!h.recorder) throw new Error('harness built without a recorder');
    return h.recorder.recordAgentStartedSession;
  }

  it('records the child under its SDK id with the parent SDK id, worktree, branch and task', async () => {
    const h = makeHarness();
    const child = await h.startChild({ taskId: 'TASK_2026_001' });
    expect(recordCalls(h)).not.toHaveBeenCalled();

    resolveChild(h, child.childSessionId);
    await flush();

    expect(recordCalls(h)).toHaveBeenCalledTimes(1);
    expect(recordCalls(h)).toHaveBeenCalledWith({
      sessionId: CHILD_SDK,
      workspaceRoot: ROOT,
      parentSessionId: PARENT_SDK,
      worktreePath: WORKTREE,
      branch: BRANCH,
      taskId: 'TASK_2026_001',
    });
  });

  it('omits the task id when the child was started without one', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    resolveChild(h, child.childSessionId);
    await flush();

    const input = recordCalls(h).mock.calls[0][0];
    expect(input).not.toHaveProperty('taskId');
  });

  it('falls back to the parent tab live SDK id when none was captured at start', async () => {
    const h = makeHarness();
    h.lifecycleIds.delete(PARENT);
    const child = await h.startChild();
    expect(child.parentSdkSessionId).toBeUndefined();

    h.lifecycleIds.set(PARENT, PARENT_SDK);
    resolveChild(h, child.childSessionId);
    await flush();

    expect(recordCalls(h)).toHaveBeenCalledWith(
      expect.objectContaining({ parentSessionId: PARENT_SDK }),
    );
  });

  it('omits the parent when its SDK id is unknown, never passing the parent tab id', async () => {
    const h = makeHarness();
    h.lifecycleIds.delete(PARENT);
    const child = await h.startChild();

    resolveChild(h, child.childSessionId);
    await flush();

    const input = recordCalls(h).mock.calls[0][0];
    expect(input).not.toHaveProperty('parentSessionId');
    expect(Object.values(input)).not.toContain(PARENT);
  });

  it('records the same input again when the same child resolves twice (the store upserts)', async () => {
    const h = makeHarness();
    const child = await h.startChild({ taskId: 'TASK_2026_001' });

    resolveChild(h, child.childSessionId);
    resolveChild(h, child.childSessionId);
    await flush();

    expect(recordCalls(h)).toHaveBeenCalledTimes(2);
    expect(recordCalls(h).mock.calls[1][0]).toEqual(
      recordCalls(h).mock.calls[0][0],
    );
    expect(h.registry.get(child.childSessionId)?.sdkSessionId).toBe(CHILD_SDK);
  });

  it('records nothing for a resolve that is not one of its children', async () => {
    const h = makeHarness();
    await h.startChild();

    h.idResolved.notifyAll({
      tabId: OTHER,
      realSessionId: CHILD_SDK,
      timestamp: 1,
    });
    await flush();

    expect(recordCalls(h)).not.toHaveBeenCalled();
  });

  it('binds the child without a recorder bound', async () => {
    const h = makeHarness({ recorder: null });
    const child = await h.startChild();

    expect(() => resolveChild(h, child.childSessionId)).not.toThrow();
    await flush();

    expect(h.registry.get(child.childSessionId)?.sdkSessionId).toBe(CHILD_SDK);
  });

  it('keeps the bind and logs when the recorder throws', async () => {
    const recorder = {
      recordAgentStartedSession: jest.fn(() => {
        throw new Error('db closed');
      }),
    };
    const h = makeHarness({ recorder });
    const child = await h.startChild();

    expect(() => resolveChild(h, child.childSessionId)).not.toThrow();
    await flush();

    expect(recorder.recordAgentStartedSession).toHaveBeenCalledTimes(1);
    expect(h.registry.get(child.childSessionId)?.sdkSessionId).toBe(CHILD_SDK);
    expect(
      h.lines.some((line) =>
        line.includes(
          `${child.childSessionId} organization not recorded: db closed`,
        ),
      ),
    ).toBe(true);
  });
});

describe('SessionSpawnerService.send', () => {
  async function started() {
    const h = makeHarness();
    const child = await h.startChild();
    return { h, child };
  }

  it('queue on an idle child starts a turn with the parent as peer origin', async () => {
    const { h, child } = await started();

    const result = await h.spawner.send({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
      message: 'also update the docs',
      mode: 'queue',
    });

    expect(result).toEqual({ delivered: true, effect: 'started-turn' });
    expect(h.adapter.sendMessageToSession).toHaveBeenCalledWith(
      child.childSessionId,
      'also update the docs',
      {
        origin: {
          kind: 'peer',
          from: `ptah-session:${PARENT}`,
          name: 'parent session',
        },
      },
    );
  });

  it('queue on a working child is held until the turn ends', async () => {
    const { h, child } = await started();
    h.phases.set(child.childSessionId, 'generating');
    await expect(
      h.spawner.send({
        callerSessionId: PARENT,
        childSessionId: child.childSessionId,
        message: 'm',
        mode: 'queue',
      }),
    ).resolves.toEqual({ delivered: true, effect: 'held-until-turn-end' });
  });

  it('if-idle passes require-idle and maps SessionAdmissionRefusedError(busy)', async () => {
    const { h, child } = await started();
    h.adapter.sendMessageToSession.mockRejectedValueOnce(
      new SessionAdmissionRefusedError('busy', child.childSessionId),
    );

    const result = await h.spawner.send({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
      message: 'm',
      mode: 'if-idle',
    });

    expect(result).toMatchObject({ delivered: false, reason: 'busy' });
    expect(h.adapter.sendMessageToSession.mock.calls[0][2]).toMatchObject({
      admission: 'require-idle',
    });
  });

  it('steer on a working child interrupts first; a failed interrupt sends nothing', async () => {
    const { h, child } = await started();
    h.phases.set(child.childSessionId, 'generating');
    h.adapter.interruptCurrentTurn.mockResolvedValueOnce(false);

    const refused = await h.spawner.send({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
      message: 'stop that',
      mode: 'steer',
    });
    expect(refused).toMatchObject({
      delivered: false,
      reason: 'interrupt-failed',
    });
    expect(h.adapter.sendMessageToSession).not.toHaveBeenCalled();

    const steered = await h.spawner.send({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
      message: 'stop that',
      mode: 'steer',
    });
    expect(steered).toEqual({
      delivered: true,
      effect: 'interrupted-and-started',
    });
  });

  it.each([
    ['unattributed-caller', undefined, 'self'],
    ['not-a-child-of-caller', OTHER, 'self'],
    ['unknown-child', PARENT, OTHER],
  ])('refuses %s and sends nothing', async (reason, caller, target) => {
    const { h, child } = await started();
    const result = await h.spawner.send({
      callerSessionId: caller,
      childSessionId: target === 'self' ? child.childSessionId : target,
      message: 'm',
      mode: 'queue',
    });
    expect(result).toMatchObject({ delivered: false, reason });
    expect(h.adapter.sendMessageToSession).not.toHaveBeenCalled();
  });

  it('refuses session-ended for a stopped child', async () => {
    const { h, child } = await started();
    await h.spawner.stop({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
    });
    await expect(
      h.spawner.send({
        callerSessionId: PARENT,
        childSessionId: child.childSessionId,
        message: 'm',
        mode: 'queue',
      }),
    ).resolves.toMatchObject({ delivered: false, reason: 'session-ended' });
  });
});

describe('SessionSpawnerService.stop', () => {
  it('interrupts, ends as stopped, releases policy and MCP root, keeps the worktree, no push', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    const result = await h.spawner.stop({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
    });

    expect(result).toMatchObject({
      ok: true,
      child: { status: 'stopped', endReason: 'stopped-by-parent' },
    });
    expect(h.adapter.interruptSession).toHaveBeenCalledWith(
      child.childSessionId,
    );
    expect(h.policies.get(child.childSessionId)).toBeUndefined();
    expect(h.registrar.releaseRoot).toHaveBeenCalledWith(WORKTREE);
    expect(h.provisioner.rollback).not.toHaveBeenCalled();

    h.adapterEvents.emitTurnFailed({
      sessionId: child.childSessionId,
      cwd: WORKTREE,
      lastAssistantMessage: null,
      error: 'unknown' as never,
      errorDetails: null,
      terminalReason: null,
      timestamp: 9,
    });
    await flush();
    expect(h.notifier.signalSessionChild).not.toHaveBeenCalled();

    await expect(
      h.spawner.stop({
        callerSessionId: PARENT,
        childSessionId: child.childSessionId,
      }),
    ).resolves.toMatchObject({ ok: true, child: { status: 'stopped' } });
    expect(h.adapter.interruptSession).toHaveBeenCalledTimes(1);
  });

  it('F.1 M7: releases the child budget under its tab and SDK ids, after the interrupt', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.idResolved.notifyAll({
      tabId: child.childSessionId,
      realSessionId: CHILD_SDK,
      timestamp: 2,
    });
    let releasedBeforeInterruptSettled = false;
    h.adapter.interruptSession.mockImplementationOnce(async () => {
      releasedBeforeInterruptSettled =
        h.sessionBudget.release.mock.calls.length > 0;
    });

    await h.spawner.stop({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
    });

    expect(releasedBeforeInterruptSettled).toBe(false);
    expect(h.sessionBudget.release).toHaveBeenCalledWith(child.childSessionId);
    expect(h.sessionBudget.release).toHaveBeenCalledWith(CHILD_SDK);
    expect(h.sessionBudget.release).toHaveBeenCalledTimes(2);
  });

  it('F.1 M7: an already ended child releases nothing again', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    await h.spawner.stop({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
    });
    h.sessionBudget.release.mockClear();

    await h.spawner.stop({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
    });

    expect(h.sessionBudget.release).not.toHaveBeenCalled();
  });

  it('records an interrupt failure in the end reason and still stops', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.adapter.interruptSession.mockRejectedValueOnce(new Error('gone'));

    await expect(
      h.spawner.stop({
        callerSessionId: PARENT,
        childSessionId: child.childSessionId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      child: {
        status: 'stopped',
        endReason: 'stopped-by-parent (interrupt failed: gone)',
      },
    });
  });
});

describe('SessionSpawnerService — child session end grace', () => {
  it('ends the child when its session stays inactive for the grace period', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.active.delete(child.childSessionId);

    h.sessionEnd.notifyAll({
      sessionId: child.childSessionId,
      workspaceRoot: WORKTREE,
    });
    jest.advanceTimersByTime(SESSION_CHILD_GRACE_MS - 1);
    expect(
      h.registry.get(child.childSessionId)?.terminalStatus,
    ).toBeUndefined();
    jest.advanceTimersByTime(1);

    expect(h.registry.get(child.childSessionId)).toMatchObject({
      terminalStatus: 'ended',
      endReason: 'ended outside the spawner: stop button, error or teardown',
    });
    expect(h.policies.get(child.childSessionId)).toBeUndefined();
    expect(h.registrar.releaseRoot).toHaveBeenCalledWith(WORKTREE);
    // F.1 M7: a true end (the Stop button's interrupt keeps the budget).
    expect(h.sessionBudget.release).toHaveBeenCalledWith(child.childSessionId);
  });

  it('F.1 M7: a session end within the grace releases no budget', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    h.sessionEnd.notifyAll({
      sessionId: child.childSessionId,
      workspaceRoot: WORKTREE,
    });
    jest.advanceTimersByTime(SESSION_CHILD_GRACE_MS);

    expect(h.sessionBudget.release).not.toHaveBeenCalled();
  });

  it('pushes failed when the session ended mid-turn', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.phases.set(child.childSessionId, 'generating');
    h.active.delete(child.childSessionId);

    h.sessionEnd.notifyAll({
      sessionId: child.childSessionId,
      workspaceRoot: WORKTREE,
    });
    jest.advanceTimersByTime(SESSION_CHILD_GRACE_MS);
    await flush();

    expect(h.notifier.signalSessionChild.mock.calls[0][1]).toMatchObject({
      status: 'failed',
    });
  });

  it('a re-registration within the grace cancels it', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    h.sessionEnd.notifyAll({
      sessionId: child.childSessionId,
      workspaceRoot: WORKTREE,
    });
    h.idResolved.notifyAll({
      tabId: child.childSessionId,
      realSessionId: CHILD_SDK,
      timestamp: 2,
    });
    h.active.delete(child.childSessionId);
    jest.advanceTimersByTime(SESSION_CHILD_GRACE_MS * 2);

    expect(
      h.registry.get(child.childSessionId)?.terminalStatus,
    ).toBeUndefined();
  });

  it('a child live again at expiry is left alone', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    h.sessionEnd.notifyAll({
      sessionId: child.childSessionId,
      workspaceRoot: WORKTREE,
    });
    jest.advanceTimersByTime(SESSION_CHILD_GRACE_MS);

    expect(
      h.registry.get(child.childSessionId)?.terminalStatus,
    ).toBeUndefined();
  });
});

describe('SessionSpawnerService — runtime cap', () => {
  it('times the child out after maxRuntimeMinutes and interrupts it', async () => {
    const h = makeHarness({ config: { 'agentSessions.maxRuntimeMinutes': 5 } });
    const child = await h.startChild();
    h.phases.set(child.childSessionId, 'generating');

    jest.advanceTimersByTime(5 * 60_000);
    await flush();

    expect(h.registry.get(child.childSessionId)).toMatchObject({
      terminalStatus: 'timed-out',
    });
    expect(h.notifier.signalSessionChild.mock.calls[0][1]).toMatchObject({
      status: 'timeout',
    });
    expect(h.adapter.interruptSession).toHaveBeenCalledWith(
      child.childSessionId,
    );
  });

  it('F.1 M7: releases the budget only once the background interrupt settled', async () => {
    const h = makeHarness({ config: { 'agentSessions.maxRuntimeMinutes': 5 } });
    const child = await h.startChild();
    let settle: () => void = () => undefined;
    h.adapter.interruptSession.mockImplementationOnce(
      () => new Promise<void>((resolve) => (settle = resolve)),
    );

    jest.advanceTimersByTime(5 * 60_000);
    await flush();
    expect(h.sessionBudget.release).not.toHaveBeenCalled();

    settle();
    await flush();
    expect(h.sessionBudget.release).toHaveBeenCalledWith(child.childSessionId);
  });
});

describe('SessionSpawnerService — permission prompts', () => {
  it('reports awaiting-permission with the deny time, cleared on resolution', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    h.emitPermission({
      phase: 'requested',
      requestId: 'r1',
      routingHint: child.childSessionId,
      toolName: 'Bash',
      description: 'curl example.com',
      routable: true,
      timeoutMs: 60_000,
    });
    expect(h.spawner.status({ callerSessionId: PARENT })).toMatchObject({
      children: [
        {
          status: 'awaiting-permission',
          pendingPermission: {
            toolName: 'Bash',
            deniesAt: new Date(Date.now() + 60_000).toISOString(),
          },
        },
      ],
    });

    h.emitPermission({
      phase: 'resolved',
      requestId: 'r1',
      routingHint: child.childSessionId,
      toolName: 'Bash',
      outcome: 'timed-out',
    });
    const after = h.spawner.status({ callerSessionId: PARENT });
    if (!after.ok) throw new Error('status refused');
    expect(after.children[0].status).toBe('starting');
    expect(after.children[0].pendingPermission).toBeUndefined();
  });
});

describe('SessionSpawnerService.read', () => {
  it('reports no transcript before the SDK id is known', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    const result = await h.spawner.read({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
    });
    expect(result).toMatchObject({ ok: true, result: { available: false } });
    expect(h.transcripts.read).not.toHaveBeenCalled();
  });

  it('reads the JSONL by SDK id and worktree path, clamped to tailKiB', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.registry.bindSdkSessionId(child.childSessionId, CHILD_SDK);
    h.transcripts.read.mockResolvedValueOnce('x'.repeat(3000));

    const result = await h.spawner.read({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
      tailKiB: 2,
    });

    expect(h.transcripts.read).toHaveBeenCalledWith(CHILD_SDK, WORKTREE, {
      tailBytes: 2 * 4096,
    });
    expect(result).toMatchObject({
      ok: true,
      result: { available: true, truncated: true },
    });
    if (result.ok) expect(result.result.transcript).toHaveLength(2048);
  });

  it('uses 32 KiB by default and caps at 256', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    h.registry.bindSdkSessionId(child.childSessionId, CHILD_SDK);
    h.transcripts.read.mockResolvedValue('USER: hi');

    await h.spawner.read({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
    });
    await h.spawner.read({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
      tailKiB: 9999,
    });

    expect(h.transcripts.read.mock.calls[0][2]).toEqual({
      tailBytes: 32 * 4096,
    });
    expect(h.transcripts.read.mock.calls[1][2]).toEqual({
      tailBytes: 256 * 4096,
    });
  });
});

describe('SessionSpawnerService.listUiDescriptors', () => {
  it('lists live children, optionally for one workspace root', async () => {
    const h = makeHarness();
    const child = await h.startChild();

    expect(h.spawner.listUiDescriptors()).toHaveLength(1);
    expect(h.spawner.listUiDescriptors(`${ROOT}/`)).toEqual([
      expect.objectContaining({ tabId: child.childSessionId, sessionId: null }),
    ]);
    expect(h.spawner.listUiDescriptors(resolve('/other'))).toEqual([]);

    await h.spawner.stop({
      callerSessionId: PARENT,
      childSessionId: child.childSessionId,
    });
    expect(h.spawner.listUiDescriptors()).toEqual([]);
  });
});

describe('SessionSpawnerService.dispose', () => {
  it('releases every listener, stops live children without a push, and is idempotent', async () => {
    const h = makeHarness();
    const child = await h.startChild();
    const listenersBefore = h.idResolved.size + h.sessionEnd.size;

    h.spawner.dispose();
    h.spawner.dispose();

    expect(h.idResolved.size + h.sessionEnd.size).toBe(listenersBefore - 2);
    expect(h.permissionListeners.size).toBe(0);
    expect(h.registry.get(child.childSessionId)).toMatchObject({
      terminalStatus: 'stopped',
      endReason: 'host-shutdown',
    });
    expect(h.adapter.interruptSession).toHaveBeenCalledTimes(1);
    expect(h.policies.get(child.childSessionId)).toBeUndefined();

    h.turnEnded(child.childSessionId);
    await flush();
    expect(h.notifier.signalSessionChild).not.toHaveBeenCalled();
    await expect(
      h.spawner.start(h.request({ branch: 'feat/late' })),
    ).resolves.toMatchObject({
      ok: false,
      refusal: 'chat-runtime-unavailable',
    });
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('resolveChildPaths', () => {
  it('resolves relative deliverables against the task folder, absolute ones as given', () => {
    const inside = resolve(WORKTREE, 'out', 'a.md');
    expect(
      resolveChildPaths(WORKTREE, {
        taskFolder: 'specs',
        deliverables: ['r.md', inside],
      }),
    ).toEqual({
      ok: true,
      taskFolder: resolve(WORKTREE, 'specs'),
      deliverables: [resolve(WORKTREE, 'specs', 'r.md'), inside],
    });
  });
});
