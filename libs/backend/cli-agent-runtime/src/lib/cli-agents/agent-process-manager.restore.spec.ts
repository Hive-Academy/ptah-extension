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
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type {
  AgentId,
  AgentProcessInfo,
  CliSessionReference,
} from '@ptah-extension/shared';
import { AgentProcessManager } from './agent-process-manager.service';

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
}): AgentProcessManager {
  const logger = {
    info: jest.fn(),
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
  return new AgentProcessManager(
    logger as unknown as Args[0],
    { getAdapter: jest.fn() } as unknown as Args[1],
    {
      getRunningBySession: jest.fn().mockReturnValue([]),
    } as unknown as Args[2],
    workspaceProvider as unknown as Args[3],
    { captureException: jest.fn() } as unknown as Args[4],
    { effort: { get: jest.fn(() => '') } } as unknown as Args[5],
    null,
    null,
    options.resolver ?? null,
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
  it('readOutput returns the persisted stdout for a restored record', () => {
    const manager = makeManager({ providerRoot: ROOT_A });

    const count = manager.restoreAgents(
      [makeRef({ stdout: 'line one\nline two\n' })],
      ROOT_A,
    );

    expect(count).toBe(1);
    const output = manager.readOutput(RESTORED_ID);
    expect(output.stdout).toBe('line one\nline two\n');
    expect(output.stderr).toBe('');
    expect(output.lineCount).toBe(2);
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

  it("normalizes a ref persisted as 'running' to 'stopped' — its process died with the host", () => {
    const manager = makeManager({ providerRoot: ROOT_A });

    manager.restoreAgents([makeRef({ status: 'running' })], ROOT_A);

    expect((manager.getStatus(RESTORED_ID) as AgentProcessInfo).status).toBe(
      'stopped',
    );
  });

  it.each(['completed', 'failed', 'timeout', 'stopped'] as const)(
    'carries the terminal status %s through unchanged',
    (status) => {
      const manager = makeManager({ providerRoot: ROOT_A });
      manager.restoreAgents([makeRef({ status })], ROOT_A);
      expect((manager.getStatus(RESTORED_ID) as AgentProcessInfo).status).toBe(
        status,
      );
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

  it('refuses steer on a restored record, naming the real condition', () => {
    const manager = makeManager({ providerRoot: ROOT_A });
    manager.restoreAgents([makeRef({ cliSessionId: 'session-abc' })], ROOT_A);

    expect(() => manager.steer(RESTORED_ID, 'do it differently')).toThrow(
      /restored from a previous run of this host/,
    );
    expect(() => manager.steer(RESTORED_ID, 'do it differently')).toThrow(
      /resume_session_id: session-abc/,
    );
    // Not the old "is not running (status: …)" wording, which says nothing
    // about why or what to do next.
    expect(() => manager.steer(RESTORED_ID, 'do it differently')).not.toThrow(
      /is not running/,
    );
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
