/**
 * AgentProcessManager — restoring read-only records from persisted session
 * state.
 *
 * The map is in-memory, so an `electron:serve` restart empties it while the
 * output survives in the session metadata store. A resumed chat then replayed
 * agent cards whose ids `ptah_agent_read` answered `Agent not found` for, and
 * the model read that as "the agent died". `restoreAgents` closes the gap.
 *
 * The invariant these tests exist for: a LIVE agent is never clobbered by a
 * stale persisted snapshot.
 */
import 'reflect-metadata';
import type {
  ICallerWorkspaceResolver,
  IOutputChannel,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  AgentId,
  AgentProcessInfo,
  CliSessionReference,
} from '@ptah-extension/shared';
import { AgentProcessManager } from './agent-process-manager.service';
import { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import { createMockStateStorage } from '@ptah-extension/platform-core/testing';
import { AgentMessageRouter } from './agent-message-router.service';
import { AgentSpawnEnvironment } from './agent-spawn-environment.service';
import { AgentOutputBuffer } from './agent-output-buffer.service';
import { manifestFixture } from './testing/manifest.fixture';
import {
  LaneResumeGate,
  type LaneResumeGateInput,
} from './lane-resume-gate';

// `readOutput` runs the id through `AgentId.from`, which validates the UUID
// shape — spec ids have to be real v4-shaped strings, not readable labels.
const RESTORED_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000001';
const IN_SCOPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000002';
const OUT_OF_SCOPE_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-000000000003';
const UNKNOWN_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-00000000dead';

const ROOT_A = 'D:\\projects\\workspace-a';
const ROOT_B = 'D:\\projects\\workspace-b';

function makeManager(options: {
  providerRoot: string | undefined;
  resolver?: ICallerWorkspaceResolver | null;
  rememberLaneOwner?: jest.Mock;
  evaluateResume?: jest.Mock;
  info?: jest.Mock;
}): AgentProcessManager {
  const logger = {
    info: options.info ?? jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const workspaceProvider = {
    getWorkspaceRoot: jest.fn().mockReturnValue(options.providerRoot),
    getWorkspaceFolders: jest
      .fn()
      .mockReturnValue(options.providerRoot ? [options.providerRoot] : []),
    getConfiguration: jest.fn(
      (_section: string, _key: string, dflt?: unknown) => dflt,
    ),
    setConfiguration: jest.fn(),
    onDidChangeConfiguration: jest.fn(),
    onDidChangeWorkspaceFolders: jest.fn(),
  } as unknown as IWorkspaceProvider;

  type Args = ConstructorParameters<typeof AgentProcessManager>;
  type EnvironmentArgs = ConstructorParameters<typeof AgentSpawnEnvironment>;
  const cliDetection = { getAdapter: jest.fn() } as unknown as Args[1];
  const sentryService = { captureException: jest.fn() };
  return new AgentProcessManager(
    logger as unknown as Args[0],
    cliDetection,
    {
      getRunningBySession: jest.fn().mockReturnValue([]),
    } as unknown as Args[2],
    sentryService as unknown as Args[3],
    new AgentMessageRouter(logger as unknown as Args[0], cliDetection),
    new AgentSpawnEnvironment(
      logger as unknown as Args[0],
      cliDetection,
      workspaceProvider,
      { effort: { get: jest.fn(() => '') } } as unknown as EnvironmentArgs[3],
      sentryService as unknown as EnvironmentArgs[4],
      null,
      null,
      options.resolver ?? null,
    ),
    new AgentOutputBuffer(logger as unknown as Args[0]),
    // No completion signal in these tests: the notifier's own spec covers the
    // signal, and a stub keeps a lane teardown here from reaching for a chat
    // session (TASK_2026_515).
    {
      signal: jest.fn(async () => ({
        delivered: false,
        reason: 'chat-runtime-unavailable',
      })),
    } as unknown as Args[7],
    // The default is never consulted: these tests make no resume spawn.
    { evaluate: options.evaluateResume ?? jest.fn() } as unknown as Args[8],
    // No quota owner and no ledger: plan limits are pinned by the manager spec.
    {
      ownerForLane: jest.fn(() => undefined),
      rememberLaneOwner: options.rememberLaneOwner ?? jest.fn(),
    } as unknown as Args[9],
    {
      recordWindowEvidence: jest.fn(),
      recordOwnerEvidence: jest.fn(),
      recordSuccess: jest.fn(),
    } as unknown as Args[10],
  );
}

function makeRef(overrides: Partial<CliSessionReference> = {}) {
  const ref: CliSessionReference = {
    cliSessionId: 'cli-session-1',
    cli: 'codex',
    agentId: RESTORED_ID as AgentId,
    task: 'refactor the reconciler',
    startedAt: '2026-09-01T10:00:00.000Z',
    status: 'completed',
    ...overrides,
  };
  return ref;
}

/** The manager's private map, read directly the way the sibling scope spec does. */
function agentsOf(manager: AgentProcessManager): Map<
  string,
  {
    info: AgentProcessInfo;
    stdoutBuffer: string;
    stderrBuffer: string;
    restored?: true;
    timeoutHandle?: NodeJS.Timeout;
  }
> {
  return (
    manager as unknown as {
      agents: Map<
        string,
        {
          info: AgentProcessInfo;
          stdoutBuffer: string;
          stderrBuffer: string;
          restored?: true;
          timeoutHandle?: NodeJS.Timeout;
        }
      >;
    }
  ).agents;
}

describe('AgentProcessManager.restoreAgents', () => {
  it('preserves a persisted turn sequence', () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    manager.restoreAgents([makeRef({ turnSeq: 3 })], ROOT_A);
    expect((manager.getStatus(RESTORED_ID) as AgentProcessInfo).turnSeq).toBe(
      3,
    );
  });
  it('readOutput returns an empty stdout buffer for a lean restored reference', () => {
    const manager = makeManager({ providerRoot: ROOT_A });

    const count = manager.restoreAgents([makeRef()], ROOT_A);

    expect(count).toBe(1);
    const output = manager.readOutput(RESTORED_ID);
    expect(output.stdout).toBe('');
    expect(output.stderr).toBe('');
    expect(output.lineCount).toBe(0);
    expect(output.truncated).toBe(false);
  });

  it('carries the ref segments, stream events, session id and ptahCliId', () => {
    const manager = makeManager({ providerRoot: ROOT_A });

    manager.restoreAgents(
      [
        makeRef({
          cliSessionId: 'session-abc',
          ptahCliId: 'ptah-cli-7',
          segments: [{ type: 'text', content: 'hello' }],
        }),
      ],
      ROOT_A,
    );

    const info = manager.getStatus(RESTORED_ID) as AgentProcessInfo;
    expect(info.cliSessionId).toBe('session-abc');
    expect(info.ptahCliId).toBe('ptah-cli-7');
    expect(info.task).toBe('refactor the reconciler');
    expect(info.startedAt).toBe('2026-09-01T10:00:00.000Z');
    expect(
      manager.readOutputForPersistence(RESTORED_ID)?.segments,
    ).toHaveLength(1);
  });

  it('restores identity beside lifecycle without overriding lifecycle fields', () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    const manifest = manifestFixture();

    manager.restoreAgents(
      [
        makeRef({
          status: 'stopped',
          stopReason: 'host-restart',
          completedAt: '2026-09-01T10:01:00.000Z',
          lastActivityAt: '2026-09-01T10:00:30.000Z',
          ptahCliId: 'ptah-cli-7',
          workspaceKey: 'd:/projects/workspace-a',
          potentialCapabilities: manifest,
        }),
      ],
      ROOT_A,
      'parent-session',
    );

    expect(manager.getStatus(RESTORED_ID)).toMatchObject({
      parentSessionId: 'parent-session',
      ptahCliId: 'ptah-cli-7',
      workspaceKey: 'd:/projects/workspace-a',
      potentialCapabilities: manifest,
      status: 'stopped',
      stopReason: 'host-restart',
      completedAt: '2026-09-01T10:01:00.000Z',
      lastActivityAt: '2026-09-01T10:00:30.000Z',
    });
  });

  it('logs one redacted restart line per host-restart ref and none for other terminal refs', () => {
    const info = jest.fn();
    const manager = makeManager({ providerRoot: ROOT_A, info });
    // The store normalizes an interrupted lane to stopped / host-restart
    // before restore; a `running` ref is a live lane of another host.
    manager.restoreAgents(
      [
        makeRef({ status: 'stopped', stopReason: 'host-restart' }),
        makeRef({
          agentId: IN_SCOPE_ID as AgentId,
          status: 'stopped',
          stopReason: 'host-restart',
          cliSessionId: '',
        }),
        makeRef({ agentId: OUT_OF_SCOPE_ID as AgentId, status: 'completed' }),
      ],
      ROOT_A,
    );
    const lines = info.mock.calls.filter(
      ([message]) =>
        message === '[AgentProcessManager] Lane interrupted by host restart',
    );
    expect(lines).toHaveLength(2);
    expect(lines[0][1]).toEqual({
      agentId: RESTORED_ID,
      cli: 'codex',
      startedAt: '2026-09-01T10:00:00.000Z',
      cliSessionIdPresent: true,
    });
    expect(lines[1][1]).toEqual({
      agentId: IN_SCOPE_ID,
      cli: 'codex',
      startedAt: '2026-09-01T10:00:00.000Z',
      cliSessionIdPresent: false,
    });
  });

  it('does NOT overwrite a live tracked agent with the same id', () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    const live: AgentProcessInfo = {
      agentId: RESTORED_ID as AgentId,
      cli: 'codex',
      task: 'the run happening right now',
      workingDirectory: `${ROOT_A}\\sub`,
      status: 'running',
      startedAt: '2026-09-02T09:00:00.000Z',
    };
    agentsOf(manager).set(RESTORED_ID, {
      info: live,
      stdoutBuffer: 'live output',
      stderrBuffer: '',
    });

    const count = manager.restoreAgents(
      [makeRef({ stdout: 'STALE SNAPSHOT', status: 'completed' })],
      ROOT_A,
    );

    expect(count).toBe(0);
    const tracked = agentsOf(manager).get(RESTORED_ID);
    expect(tracked?.info.status).toBe('running');
    expect(tracked?.info.task).toBe('the run happening right now');
    expect(tracked?.restored).toBeUndefined();
    expect(manager.readOutput(RESTORED_ID).stdout).toBe('live output');
  });

  it('does not install a live foreign running ref or mark it interrupted', async () => {
    const evaluateResume = jest.fn().mockResolvedValue({
      decision: 'fresh',
      reason: 'no local record',
      contextTokens: null,
      source: 'estimate',
      idleMs: 0,
    });
    const manager = makeManager({ providerRoot: ROOT_A, evaluateResume });

    const count = manager.restoreAgents(
      [makeRef({ status: 'running' })],
      ROOT_A,
    );

    expect(count).toBe(0);
    expect(manager.findAgentInfo(RESTORED_ID)).toBeUndefined();
    // The tools learn the lane belongs to a live host, not to spawn a duplicate.
    expect(() => manager.readOutput(RESTORED_ID)).toThrow(
      /^Agent not found: .*running under another live Ptah host/,
    );
    expect(() => manager.readOutput(RESTORED_ID)).not.toThrow(/spawn a new agent/);
    await manager['gateResume']('Continue', 'cli-session-1', 'codex');
    expect(evaluateResume).toHaveBeenCalledWith(
      expect.not.objectContaining({ interruptedByHostRestart: true }),
    );
  });

  it('restores a foreign lane only after its host lease becomes stale', async () => {
    jest.useFakeTimers();
    try {
      const now = Date.parse('2026-10-17T12:00:00.000Z');
      jest.setSystemTime(now);
      const evaluateResume = jest.fn().mockResolvedValue({
        decision: 'resume',
        reason: 'test gate',
        contextTokens: null,
        source: 'estimate',
        idleMs: 0,
      });
      const manager = makeManager({ providerRoot: ROOT_A, evaluateResume });
      const storage = createMockStateStorage();
      const hostB = new SessionMetadataStore(storage, manager['logger']);
      await hostB.create('sess-1', ROOT_A, 'parent');
      const metadata = await hostB.get('sess-1');
      if (!metadata) throw new Error('Expected seeded session metadata');
      const lastActivityAt = new Date(now - 30_000).toISOString();
      await hostB.save({
        ...metadata,
        cliSessions: [
          makeRef({
            status: 'running',
            hostRunId: 'host-run-a',
            lastActivityAt,
          }),
        ],
      });
      await storage.update('ptah.hostRunLease.host-run-a', now);

      const [live] = await hostB.getCliSessionsForRestore('sess-1');
      expect(live).toMatchObject({ status: 'running', lastActivityAt });
      expect(live).not.toHaveProperty('hostRunId');
      expect(manager.restoreAgents([live], ROOT_A)).toBe(0);
      expect(manager.findAgentInfo(RESTORED_ID)).toBeUndefined();
      await manager['gateResume']('Continue', 'cli-session-1', 'codex');
      expect(evaluateResume).toHaveBeenNthCalledWith(
        1,
        expect.not.objectContaining({ interruptedByHostRestart: true }),
      );

      // Host A crashed: its key remains, but no beat arrives for over 90 s.
      jest.setSystemTime(now + 91_000);
      const [interrupted] = await hostB.getCliSessionsForRestore('sess-1');
      expect(interrupted).toMatchObject({
        status: 'stopped',
        stopReason: 'host-restart',
        completedAt: lastActivityAt,
        lastActivityAt,
      });
      expect(manager.restoreAgents([interrupted], ROOT_A)).toBe(1);
      await manager['gateResume']('Continue', 'cli-session-1', 'codex');
      expect(evaluateResume).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          interruptedByHostRestart: true,
          lastActivityAt: Date.parse(lastActivityAt),
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('restores a store-normalized host interruption without an exit code', () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    const lastActivityAt = '2026-09-01T10:59:30.000Z';

    manager.restoreAgents(
      [
        makeRef({
          status: 'stopped',
          stopReason: 'host-restart',
          completedAt: lastActivityAt,
          lastActivityAt,
        }),
      ],
      ROOT_A,
    );

    const info = manager.getStatus(RESTORED_ID) as AgentProcessInfo;
    expect(info).toMatchObject({
      status: 'stopped',
      stopReason: 'host-restart',
      completedAt: lastActivityAt,
      lastActivityAt,
    });
    expect(info.exitCode).toBeUndefined();
  });

  it('keeps the interruption instant supplied by the store without prior activity', () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    const interruptedAt = new Date().toISOString();

    manager.restoreAgents(
      [
        makeRef({
          status: 'stopped',
          stopReason: 'host-restart',
          completedAt: interruptedAt,
          lastActivityAt: interruptedAt,
        }),
      ],
      ROOT_A,
    );

    const info = manager.getStatus(RESTORED_ID) as AgentProcessInfo;
    expect(info.status).toBe('stopped');
    expect(info.stopReason).toBe('host-restart');
    expect(info.completedAt).toBe(interruptedAt);
    expect(info.lastActivityAt).toBe(interruptedAt);
  });

  it('resumes an interrupted long-running lane from last activity, not spawn', async () => {
    const evaluateResume = jest.fn().mockResolvedValue({
      decision: 'resume',
      reason: 'within the context and idle limits',
      contextTokens: null,
      source: 'estimate',
      idleMs: 30_000,
    });
    const manager = makeManager({ providerRoot: ROOT_A, evaluateResume });
    const now = Date.now();
    const lastActivityAt = new Date(now - 30_000).toISOString();
    manager.restoreAgents(
      [
        makeRef({
          status: 'stopped',
          stopReason: 'host-restart',
          startedAt: new Date(now - 3_600_000).toISOString(),
          lastActivityAt,
          completedAt: lastActivityAt,
        }),
      ],
      ROOT_A,
    );

    const gated = await manager['gateResume'](
      'Continue the work',
      'cli-session-1',
      'codex',
    );

    expect(evaluateResume).toHaveBeenCalledWith(
      expect.objectContaining({
        cliSessionId: 'cli-session-1',
        lastActivityAt: Date.parse(lastActivityAt),
        interruptedByHostRestart: true,
      }),
    );
    expect(gated.resumeDecision).toEqual({
      decision: 'resumed',
      reason: 'within the context and idle limits',
      sessionKnown: true,
    });
  });

  it('resumes an interrupted lane through the real gate past the idle limit', async () => {
    const now = Date.now();
    const output: IOutputChannel = {
      name: 'Ptah',
      appendLine: jest.fn(),
      append: jest.fn(),
      clear: jest.fn(),
      show: jest.fn(),
      dispose: jest.fn(),
    };
    const gate = new LaneResumeGate(
      output,
      jest.fn(async () => null),
      () => now,
    );
    const evaluateResume = jest.fn((input: LaneResumeGateInput) =>
      gate.evaluate(input),
    );
    const manager = makeManager({ providerRoot: ROOT_A, evaluateResume });
    manager.restoreAgents(
      [
        makeRef({
          cli: 'copilot',
          status: 'stopped',
          stopReason: 'host-restart',
          startedAt: new Date(now - 3_600_000).toISOString(),
          lastActivityAt: new Date(now - 601_000).toISOString(),
          completedAt: new Date(now - 601_000).toISOString(),
        }),
      ],
      ROOT_A,
    );

    const gated = await manager['gateResume'](
      'Continue the work',
      'cli-session-1',
      'copilot',
    );

    expect(gated.resumeDecision).toEqual({
      decision: 'resumed',
      reason: 'host restart interrupted the lane; resuming its CLI session',
      sessionKnown: true,
    });
  });

  it('clamps a future checkpoint before the real resume idle gate', async () => {
    jest.useFakeTimers();
    try {
      const now = Date.parse('2026-10-17T12:00:00.000Z');
      jest.setSystemTime(now);
      const output: IOutputChannel = {
        name: 'Ptah',
        appendLine: jest.fn(),
        append: jest.fn(),
        clear: jest.fn(),
        show: jest.fn(),
        dispose: jest.fn(),
      };
      const gate = new LaneResumeGate(
        output,
        jest.fn(async () => null),
        () => Date.now(),
      );
      const manager = makeManager({
        providerRoot: ROOT_A,
        evaluateResume: jest.fn((input: LaneResumeGateInput) =>
          gate.evaluate(input),
        ),
      });
      manager.restoreAgents(
        [
          makeRef({
            cli: 'copilot',
            status: 'stopped',
            stopReason: 'host-restart',
            startedAt: new Date(now - 3_600_000).toISOString(),
            lastActivityAt: new Date(now + 3_600_000).toISOString(),
            completedAt: new Date(now).toISOString(),
          }),
        ],
        ROOT_A,
      );

      jest.setSystemTime(now + 601_000);
      const gated = await manager['gateResume'](
        'Continue the work',
        'cli-session-1',
        'copilot',
      );

      expect(manager.findAgentInfo(RESTORED_ID)?.lastActivityAt).toBe(
        new Date(now).toISOString(),
      );
      expect(gated.resumeDecision).toEqual({
        decision: 'resumed',
        reason: 'host restart interrupted the lane; resuming its CLI session',
        sessionKnown: true,
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('passes an interrupted legacy lane restore time to the resume gate', async () => {
    const evaluateResume = jest.fn().mockResolvedValue({
      decision: 'resume',
      reason: 'within the context and idle limits',
      contextTokens: null,
      source: 'estimate',
      idleMs: 0,
    });
    const manager = makeManager({ providerRoot: ROOT_A, evaluateResume });
    const beforeRestore = Date.now();
    manager.restoreAgents(
      [
        makeRef({
          status: 'stopped',
          stopReason: 'host-restart',
          startedAt: new Date(beforeRestore - 3_600_000).toISOString(),
          lastActivityAt: new Date(beforeRestore).toISOString(),
          completedAt: new Date(beforeRestore).toISOString(),
        }),
      ],
      ROOT_A,
    );

    await manager['gateResume']('Continue', 'cli-session-1', 'codex');

    const input = evaluateResume.mock.calls[0][0] as { lastActivityAt: number };
    expect(input.lastActivityAt).toBeGreaterThanOrEqual(beforeRestore);
    expect(input.lastActivityAt).toBeLessThanOrEqual(Date.now());
  });

  it.each(['completed', 'failed', 'timeout', 'stopped'] as const)(
    'carries the terminal status %s through unchanged',
    (status) => {
      const manager = makeManager({ providerRoot: ROOT_A });
      manager.restoreAgents(
        [makeRef({ status, completedAt: '2026-09-01T10:05:00.000Z' })],
        ROOT_A,
      );
      const info = manager.getStatus(RESTORED_ID) as AgentProcessInfo;
      expect(info.status).toBe(status);
      expect(info.completedAt).toBe('2026-09-01T10:05:00.000Z');
      expect(info.stopReason).toBeUndefined();
    },
  );

  it('scopes a restored agent by the workingDirectory the caller passed in', () => {
    const manager = makeManager({
      providerRoot: ROOT_B,
      resolver: { resolveCallerWorkspaceRoot: () => ROOT_A },
    });

    manager.restoreAgents(
      [makeRef({ agentId: IN_SCOPE_ID as AgentId })],
      ROOT_A,
    );
    manager.restoreAgents(
      [makeRef({ agentId: OUT_OF_SCOPE_ID as AgentId })],
      ROOT_B,
    );

    const list = manager.getStatus() as AgentProcessInfo[];
    expect(list.map((a) => String(a.agentId))).toEqual([IN_SCOPE_ID]);
    expect((manager.getStatus(IN_SCOPE_ID) as AgentProcessInfo).status).toBe(
      'completed',
    );
    expect(() => manager.getStatus(OUT_OF_SCOPE_ID)).toThrow(
      /belongs to another workspace/,
    );
  });

  it('carries the quota owner the run recorded, and none when it recorded none (G3)', () => {
    const rememberLaneOwner = jest.fn();
    const manager = makeManager({ providerRoot: ROOT_A, rememberLaneOwner });
    const owner = {
      providerId: 'openai-codex',
      identityKind: 'account' as const,
      key: 'openai-codex#account:0123456789abcdef',
      label: 'Codex account',
    };

    manager.restoreAgents(
      [
        makeRef({ quotaOwner: owner }),
        makeRef({ agentId: IN_SCOPE_ID as AgentId }),
      ],
      ROOT_A,
    );

    expect(manager.findAgentInfo(RESTORED_ID)?.quotaOwner).toEqual(owner);
    expect(manager.findAgentInfo(IN_SCOPE_ID)).not.toHaveProperty('quotaOwner');
    // The recorded owner seeds the lane's remembered owner for limit lookups.
    expect(rememberLaneOwner).toHaveBeenCalledTimes(1);
    expect(rememberLaneOwner).toHaveBeenCalledWith(
      { cli: 'codex', ptahCliId: undefined },
      owner,
    );
    // A restored record is read-only: a later owner never replaces it.
    expect(
      manager.recordQuotaOwner(RESTORED_ID, { ...owner, key: 'other' }),
    ).toBe(false);
  });

  it('refuses sendToAgent on a restored record, naming the real condition', async () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    manager.restoreAgents([makeRef({ cliSessionId: 'session-abc' })], ROOT_A);

    const error = await manager
      .sendToAgent(RESTORED_ID, 'do it differently')
      .then(
        () => null,
        (err: unknown) => err as { code?: string; message: string },
      );

    expect(error?.code).toBe('restored');
    expect(error?.message).toMatch(/restored from a previous run of this host/);
    expect(error?.message).toMatch(/resume_session_id: session-abc/);
    // Not the old "is not running (status: …)" wording, which says nothing
    // about why or what to do next.
    expect(error?.message).not.toMatch(/is not running/);
  });

  it('does not emit a subprocess release for a restored record on cold resume', async () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    manager.restoreAgents([makeRef()], ROOT_A);
    const released = jest.fn();
    manager.events.on('agent:released', released);
    await manager.releaseIdleForResume(RESTORED_ID);
    expect(released).not.toHaveBeenCalled();
  });

  it('refuses stop on a restored record instead of reporting a no-op release as success', async () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    manager.restoreAgents([makeRef()], ROOT_A);

    await expect(manager.stop(RESTORED_ID)).rejects.toThrow(
      /restored from a previous run of this host/,
    );
  });

  it("refuses continueConversation with code 'released', not 'unsupported'", async () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    manager.restoreAgents([makeRef({ cliSessionId: 'session-abc' })], ROOT_A);

    const error = await manager
      .continueConversation(RESTORED_ID, 'carry on')
      .catch((e: unknown) => e);

    expect(error).toMatchObject({ code: 'released' });
    expect((error as Error).message).toMatch(
      /restored from a previous run of this host/,
    );
  });

  it('arms no timeout watchdog for a restored record, and disposeAll tolerates its absence', async () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    manager.restoreAgents([makeRef()], ROOT_A);

    expect(agentsOf(manager).get(RESTORED_ID)?.timeoutHandle).toBeUndefined();
    await expect(manager.disposeAll()).resolves.toBeUndefined();
    expect(agentsOf(manager).size).toBe(0);
  });

  it('never emits a persisting lifecycle event for a restored record, so its empty output is never written back', async () => {
    jest.useFakeTimers();
    try {
      const manager = makeManager({ providerRoot: ROOT_A });
      const emitted: string[] = [];
      for (const name of [
        'agent:spawned',
        'agent:exited',
        'agent:released',
        'agent:expired',
      ]) {
        manager.events.on(name, () => emitted.push(name));
      }
      manager.restoreAgents([makeRef({ cliSessionId: 'session-abc' })], ROOT_A);

      // Lean restore refs leave the persistence accumulators empty...
      expect(manager.readOutputForPersistence(RESTORED_ID)).toMatchObject({
        segments: [],
        streamEvents: [],
      });
      // ...but every path that could re-persist is closed. `agent:spawned` and
      // `agent:exited` are the only triggers for `persistCliSessionReference`.
      await expect(
        manager.sendToAgent(RESTORED_ID, 'again'),
      ).rejects.toMatchObject({ code: 'restored' });
      await expect(manager.stop(RESTORED_ID)).rejects.toThrow();
      await expect(
        manager.continueConversation(RESTORED_ID, 'again'),
      ).rejects.toMatchObject({ code: 'released' });
      // No parent id, so the sdk-callbacks session-id remap never selects it.
      expect(
        (manager.getStatus(RESTORED_ID) as AgentProcessInfo).parentSessionId,
      ).toBeUndefined();
      jest.runOnlyPendingTimers();
      await Promise.resolve();

      expect(emitted).toEqual(['agent:expired']);
    } finally {
      jest.useRealTimers();
    }
  });

  it('an unknown id says no record exists in this host at all, keeping the "Agent not found" prefix', () => {
    const manager = makeManager({ providerRoot: ROOT_A });

    for (const read of [
      () => manager.readOutput(UNKNOWN_ID),
      () => manager.getStatus(UNKNOWN_ID),
    ]) {
      expect(read).toThrow(new RegExp(`^Agent not found: ${UNKNOWN_ID}\\.`));
      expect(read).toThrow(/nor one restored from persisted session state/);
      expect(read).toThrow(/spawn a new agent/);
    }
  });
});
