import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { AgentMonitorStore } from '@ptah-extension/chat-streaming';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { TribunalProgressService } from './tribunal-progress.service';
import { TribunalStateService } from './tribunal-state.service';
import { DEFAULT_CRUCIBLE_ROUND_CAP } from './tribunal-run.service';
import type { TribunalProgress, VendorLane } from '../types/tribunal-ui.types';

// ---------------------------------------------------------------------------
// Fixtures
//
// Filename literals are legal in a spec file (contract guard, Duty 1: tests are
// exempt as a category) and this is exactly where they belong — the production
// code composes every name from the shared contract, and these literals are the
// independent check that it composed the RIGHT one.
// ---------------------------------------------------------------------------

const TASK_ID = 'TASK_2026_900';

const RELAY_LANES: readonly VendorLane[] = [
  {
    laneId: 'codex#0',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    role: 'plan',
  },
  {
    laneId: 'codex#1',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    role: 'architect',
  },
  {
    laneId: 'copilot#2',
    family: 'copilot',
    displayName: 'Copilot',
    cli: 'copilot',
    role: 'implement',
  },
  {
    laneId: 'cursor#3',
    family: 'cursor',
    displayName: 'Cursor',
    cli: 'cursor',
    role: 'review',
  },
];

const CRUCIBLE_LANES: readonly VendorLane[] = [
  {
    laneId: 'codex#0',
    family: 'codex',
    displayName: 'Codex',
    cli: 'codex',
    role: 'executor',
  },
  {
    laneId: 'copilot#1',
    family: 'copilot',
    displayName: 'Copilot',
    cli: 'copilot',
    role: 'judge',
  },
];

function makeAgent(overrides: Partial<MonitoredAgent> = {}): MonitoredAgent {
  return {
    agentId: 'agent-1',
    cli: 'codex',
    task: '[tribunal:codex#0] do the thing',
    status: 'running',
    startedAt: 0,
    stdout: '',
    stderr: '',
    expanded: false,
    segments: [],
    streamEvents: [],
    streamRevision: 0,
    ...overrides,
  } as MonitoredAgent;
}

/** Minimal `RpcResult` shape — the three members this service reads. */
function rpcOk(data: unknown): unknown {
  return { isSuccess: () => true, data, error: undefined };
}

function rpcFailed(message: string): unknown {
  return { isSuccess: () => false, data: undefined, error: message };
}

/** Drain the microtask queue an effect-driven derivation runs through. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function judgeReport(verdict: string, defects: readonly string[] = []): string {
  return [
    '## VERDICT',
    '',
    verdict,
    '',
    '## DEFECTS',
    '',
    ...defects,
    '',
    '## MENTOR NOTE',
    '',
    'Tighten the boundary.',
  ].join('\n');
}

describe('TribunalProgressService', () => {
  let service: TribunalProgressService;
  let mockRpc: { call: jest.Mock };
  let mockState: {
    move: jest.Mock;
    lanes: jest.Mock;
    specTaskId: jest.Mock;
    correlationId: jest.Mock;
    roundCap: jest.Mock;
    laneBindings: jest.Mock;
    tribunalSessionId: jest.Mock;
    setProgress: jest.Mock;
  };
  let agents: ReturnType<typeof signal<readonly MonitoredAgent[]>>;
  let sessionAgents: MonitoredAgent[];

  /** Artifacts `tasks:get` reports, and the judge markdown per round. */
  let artifacts: string[];
  let judges: Record<number, string | null>;

  beforeEach(() => {
    artifacts = [];
    judges = {};
    sessionAgents = [];
    agents = signal<readonly MonitoredAgent[]>([]);

    mockState = {
      move: jest.fn().mockReturnValue('relay'),
      lanes: jest.fn().mockReturnValue(RELAY_LANES),
      specTaskId: jest.fn().mockReturnValue(TASK_ID),
      correlationId: jest.fn().mockReturnValue('conductor-tab-1'),
      roundCap: jest.fn().mockReturnValue(2),
      laneBindings: jest.fn().mockReturnValue(new Map()),
      tribunalSessionId: jest.fn().mockReturnValue('session-1'),
      setProgress: jest.fn(),
    };

    mockRpc = {
      call: jest.fn(async (method: string, params: { round?: number }) => {
        if (method === 'tasks:get') {
          return rpcOk({ task: { artifacts: [...artifacts] } });
        }
        if (method === 'tasks:getRoundJudge') {
          const round = params.round ?? 0;
          return rpcOk({ round, content: judges[round] ?? null });
        }
        throw new Error(`unexpected rpc method: ${method}`);
      }),
    };

    TestBed.configureTestingModule({
      providers: [
        TribunalProgressService,
        { provide: ClaudeRpcService, useValue: mockRpc },
        { provide: TribunalStateService, useValue: mockState },
        {
          provide: AgentMonitorStore,
          useValue: {
            agents,
            agentsForSession: () => sessionAgents,
          },
        },
        {
          provide: TabManagerService,
          useValue: { activeWorkspacePath: '/repo' },
        },
      ],
    });

    service = TestBed.inject(TribunalProgressService);
  });

  /** The progress most recently published onto the run slice. */
  function lastProgress(): TribunalProgress {
    const calls = mockState.setProgress.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1][0] as TribunalProgress;
  }

  function relayProgress(): Extract<TribunalProgress, { kind: 'relay' }> {
    const progress = lastProgress();
    if (progress.kind !== 'relay') {
      throw new Error(`expected relay progress, got ${progress.kind}`);
    }
    return progress;
  }

  function crucibleProgress(): Extract<TribunalProgress, { kind: 'crucible' }> {
    const progress = lastProgress();
    if (progress.kind !== 'crucible') {
      throw new Error(`expected crucible progress, got ${progress.kind}`);
    }
    return progress;
  }

  function unavailableProgress(): Extract<
    TribunalProgress,
    { kind: 'unavailable' }
  > {
    const progress = lastProgress();
    if (progress.kind !== 'unavailable') {
      throw new Error(`expected unavailable progress, got ${progress.kind}`);
    }
    return progress;
  }

  function bind(bindings: Record<string, MonitoredAgent | null>): void {
    mockState.laneBindings.mockReturnValue(new Map(Object.entries(bindings)));
  }

  // -------------------------------------------------------------------------
  // Flat moves — no progress model, and no RPC traffic at all
  // -------------------------------------------------------------------------

  describe('flat moves', () => {
    it.each(['council', 'forge', 'race'])(
      'publishes { kind: none } for %s without reading the spec folder',
      async (move) => {
        mockState.move.mockReturnValue(move);
        mockState.lanes.mockReturnValue([]);

        await service.refresh();

        expect(lastProgress()).toEqual({ kind: 'none' });
        expect(mockRpc.call).not.toHaveBeenCalled();
      },
    );
  });

  // -------------------------------------------------------------------------
  // AC-4.5 / R1 — "we cannot tell" is LABELLED, never rendered as pending
  // -------------------------------------------------------------------------

  describe('unavailable (AC-4.5)', () => {
    it('reports unavailable — not an all-pending pipeline — with no spec folder', async () => {
      mockState.specTaskId.mockReturnValue(null);

      await service.refresh();

      expect(unavailableProgress().reason).toContain('No spec folder');
      expect(mockRpc.call).not.toHaveBeenCalled();
    });

    it('reports unavailable when tasks:get fails, quoting the failure', async () => {
      mockRpc.call.mockResolvedValue(rpcFailed('workspace not indexed'));

      await service.refresh();

      const progress = unavailableProgress();
      expect(progress.reason).toContain(TASK_ID);
      expect(progress.reason).toContain('workspace not indexed');
    });

    it('reports unavailable when tasks:get throws', async () => {
      mockRpc.call.mockRejectedValue(new Error('rpc timeout'));

      await service.refresh();

      expect(unavailableProgress().reason).toContain('rpc timeout');
    });

    it('reports unavailable when the spec folder is gone', async () => {
      mockRpc.call.mockResolvedValue(rpcOk({ task: null }));

      await service.refresh();

      expect(unavailableProgress().reason).toContain('no longer on disk');
    });
  });

  // -------------------------------------------------------------------------
  // Relay — the pure join (AC-4.2, AC-4.3)
  // -------------------------------------------------------------------------

  describe('relay phases', () => {
    it('renders the four phases in pipeline order with their contract deliverables', async () => {
      await service.refresh();

      const { phases } = relayProgress();
      expect(phases.map((phase) => phase.role)).toEqual([
        'plan',
        'architect',
        'implement',
        'review',
      ]);
      expect(phases.map((phase) => phase.deliverable)).toEqual([
        'task-description.md',
        'implementation-plan.md',
        'batches.md',
        'code-logic-review.md',
      ]);
      expect(phases.map((phase) => phase.laneId)).toEqual([
        'codex#0',
        'codex#1',
        'copilot#2',
        'cursor#3',
      ]);
    });

    it('is all pending with nothing written and nothing spawned', async () => {
      await service.refresh();

      const progress = relayProgress();
      expect(progress.phases.map((phase) => phase.status)).toEqual([
        'pending',
        'pending',
        'pending',
        'pending',
      ]);
      expect(progress.runningIndex).toBeNull();
    });

    it('marks a phase complete when its deliverable appears in the artifacts', async () => {
      artifacts = ['task-description.md'];

      await service.refresh();

      expect(relayProgress().phases[0].status).toBe('complete');
      expect(relayProgress().phases[1].status).toBe('pending');
    });

    // R5 — the rename trap. Both names must close the implement phase.
    it('accepts batches.md as the implement deliverable', async () => {
      artifacts = ['batches.md'];

      await service.refresh();

      expect(relayProgress().phases[2].status).toBe('complete');
    });

    it('accepts the legacy tasks.md as the implement deliverable (R5)', async () => {
      artifacts = ['tasks.md'];

      await service.refresh();

      expect(relayProgress().phases[2].status).toBe('complete');
    });

    it('points runningIndex at the live phase and leaves its status pending', async () => {
      bind({ 'codex#1': makeAgent({ agentId: 'a2', status: 'running' }) });

      await service.refresh();

      const progress = relayProgress();
      expect(progress.runningIndex).toBe(1);
      expect(progress.phases[1].status).toBe('pending');
    });

    // AC-4.2, enforced by the TYPE rather than by a guard: `runningIndex` is a
    // single nullable index, so two simultaneously-running lanes cannot produce
    // two live phases however hard the roster tries.
    it('yields exactly ONE runningIndex when two lanes are running at once', async () => {
      bind({
        'codex#0': makeAgent({ agentId: 'a1', status: 'running' }),
        'copilot#2': makeAgent({ agentId: 'a3', status: 'running' }),
      });

      await service.refresh();

      const progress = relayProgress();
      expect(progress.runningIndex).toBe(0);
      expect(typeof progress.runningIndex).toBe('number');
      // No second live phase exists to be found: `running` is not a member of
      // the per-phase status union at all.
      expect(progress.phases.map((phase) => phase.status)).toEqual([
        'pending',
        'pending',
        'pending',
        'pending',
      ]);
    });

    it('prefers the artifact over a still-running lane and skips it for runningIndex', async () => {
      artifacts = ['task-description.md'];
      bind({ 'codex#0': makeAgent({ agentId: 'a1', status: 'running' }) });

      await service.refresh();

      const progress = relayProgress();
      expect(progress.phases[0].status).toBe('complete');
      expect(progress.runningIndex).toBeNull();
    });

    it.each(['failed', 'timeout', 'stopped', 'completed'] as const)(
      'marks a phase failed when its lane ended as %s without the deliverable',
      async (status) => {
        bind({ 'codex#0': makeAgent({ agentId: 'a1', status }) });

        await service.refresh();

        expect(relayProgress().phases[0].status).toBe('failed');
      },
    );

    // AC-4.4 — a reassigned phase says so instead of silently swapping the name.
    it('reports a reassignment when the role token appears under another lane', async () => {
      sessionAgents = [
        makeAgent({
          agentId: 'a9',
          task: '[tribunal:cursor#3] (implement) take over the implement phase',
          status: 'running',
        }),
      ];

      await service.refresh();

      const implement = relayProgress().phases[2];
      expect(implement.laneId).toBe('cursor#3');
      expect(implement.reassignedFromLaneId).toBe('copilot#2');
      expect(relayProgress().runningIndex).toBe(2);
    });

    it('does NOT claim a reassignment when the role token names the assigned lane', async () => {
      sessionAgents = [
        makeAgent({
          agentId: 'a3',
          task: '[tribunal:copilot#2] (implement) implement it',
          status: 'running',
        }),
      ];

      await service.refresh();

      const implement = relayProgress().phases[2];
      expect(implement.laneId).toBe('copilot#2');
      expect(implement.reassignedFromLaneId).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Crucible — rounds, verdicts and terminations (AC-5.1, AC-5.2, AC-5.6)
  // -------------------------------------------------------------------------

  describe('crucible rounds', () => {
    beforeEach(() => {
      mockState.move.mockReturnValue('crucible');
      mockState.lanes.mockReturnValue(CRUCIBLE_LANES);
    });

    it('starts at round 1 of the cap with no reports written', async () => {
      const progress = await (async () => {
        await service.refresh();
        return crucibleProgress();
      })();

      expect(progress.roundCap).toBe(2);
      expect(progress.currentRound).toBe(1);
      expect(progress.rounds).toEqual([]);
      expect(progress.termination).toBe('in-progress');
    });

    it('falls back to the launch default when the slice carries no cap', async () => {
      mockState.roundCap.mockReturnValue(null);

      await service.refresh();

      expect(crucibleProgress().roundCap).toBe(DEFAULT_CRUCIBLE_ROUND_CAP);
    });

    it('reads the round number off the artifact list (AC-5.1)', async () => {
      artifacts = ['round-1-judge.md'];
      judges[1] = judgeReport('REVISE', [
        'D1 [major] src/a.ts:10 — leaks — close it',
      ]);

      await service.refresh();

      const progress = crucibleProgress();
      expect(progress.rounds.map((round) => round.round)).toEqual([1]);
      expect(progress.rounds[0].verdict).toBe('revise');
      expect(progress.rounds[0].defects).toHaveLength(1);
      // REVISE with a round remaining: the loop is on round 2 now.
      expect(progress.currentRound).toBe(2);
      expect(progress.termination).toBe('in-progress');
    });

    it('terminates on PASS', async () => {
      artifacts = ['round-1-judge.md'];
      judges[1] = judgeReport('PASS');

      await service.refresh();

      const progress = crucibleProgress();
      expect(progress.termination).toBe('pass');
      expect(progress.currentRound).toBe(1);
    });

    it('terminates on REJECT', async () => {
      artifacts = ['round-1-judge.md'];
      judges[1] = judgeReport('REJECT');

      await service.refresh();

      expect(crucibleProgress().termination).toBe('reject');
    });

    it('reports cap-reached-with-defects at the cap with nothing running', async () => {
      artifacts = ['round-1-judge.md', 'round-2-judge.md'];
      judges[1] = judgeReport('REVISE', [
        'D1 [blocking] src/a.ts:10 — leaks — close it',
        'D2 [minor] src/b.ts:4 — typo — fix it',
      ]);
      judges[2] = judgeReport('REVISE', [
        'D1 [minor] src/b.ts:4 — typo — fix it',
      ]);

      await service.refresh();

      const progress = crucibleProgress();
      expect(progress.termination).toBe('cap-reached-with-defects');
      expect(progress.currentRound).toBe(2);
      expect(progress.roundCap).toBe(2);
    });

    // R3 — a 3rd round the user authorised is RENDERED, never clamped.
    it('advances past the cap while a lane is still running (Round 3 of 2)', async () => {
      artifacts = ['round-1-judge.md', 'round-2-judge.md'];
      judges[1] = judgeReport('REVISE', [
        'D1 [blocking] src/a.ts:10 — leaks — close it',
      ]);
      judges[2] = judgeReport('REVISE', [
        'D1 [major] src/a.ts:10 — still leaks — close it',
      ]);
      bind({ 'codex#0': makeAgent({ agentId: 'a1', status: 'running' }) });

      await service.refresh();

      const progress = crucibleProgress();
      expect(progress.currentRound).toBe(3);
      expect(progress.roundCap).toBe(2);
      expect(progress.termination).toBe('in-progress');
    });

    it('does not clamp a JUDGED 3rd round to the cap either (R3)', async () => {
      artifacts = ['round-1-judge.md', 'round-2-judge.md', 'round-3-judge.md'];
      judges[1] = judgeReport('REVISE', [
        'D1 [blocking] src/a.ts:10 — leaks — close it',
      ]);
      judges[2] = judgeReport('REVISE', [
        'D1 [major] src/a.ts:10 — leaks — close it',
      ]);
      judges[3] = judgeReport('PASS');

      await service.refresh();

      const progress = crucibleProgress();
      expect(progress.rounds.map((round) => round.round)).toEqual([1, 2, 3]);
      expect(progress.currentRound).toBe(3);
      expect(progress.roundCap).toBe(2);
      expect(progress.termination).toBe('pass');
    });

    it('reports a regression stop when neither count nor severity mix improved', async () => {
      mockState.roundCap.mockReturnValue(4);
      artifacts = ['round-1-judge.md', 'round-2-judge.md'];
      judges[1] = judgeReport('REVISE', [
        'D1 [major] src/a.ts:10 — leaks — close it',
      ]);
      judges[2] = judgeReport('REVISE', [
        'D1 [blocking] src/a.ts:10 — leaks worse — close it',
      ]);

      await service.refresh();

      expect(crucibleProgress().termination).toBe('regression-stop');
    });

    it('does not call an improving severity mix a regression', async () => {
      mockState.roundCap.mockReturnValue(4);
      artifacts = ['round-1-judge.md', 'round-2-judge.md'];
      judges[1] = judgeReport('REVISE', [
        'D1 [blocking] src/a.ts:10 — leaks — close it',
      ]);
      judges[2] = judgeReport('REVISE', [
        'D1 [minor] src/a.ts:10 — nit — polish it',
      ]);

      await service.refresh();

      expect(crucibleProgress().termination).toBe('in-progress');
    });

    it('never maps an unknown severity onto major when differencing rounds', async () => {
      mockState.roundCap.mockReturnValue(4);
      artifacts = ['round-1-judge.md', 'round-2-judge.md'];
      judges[1] = judgeReport('REVISE', [
        'D1 [major] src/a.ts:10 — leaks — close it',
      ]);
      judges[2] = judgeReport('REVISE', [
        'D1 [critical] src/a.ts:10 — leaks — close it',
      ]);

      await service.refresh();

      const progress = crucibleProgress();
      expect(progress.rounds[1].defects[0].severity).toBe('unknown');
      // major: 1 → 0 is an improvement in the worst-first comparison, so this
      // is NOT a regression stop. `unknown` is its own bucket, not a `major`.
      expect(progress.termination).toBe('in-progress');
    });

    it('renders an unreadable verdict as unparsed and NEVER as pass', async () => {
      artifacts = ['round-1-judge.md'];
      judges[1] = judgeReport('PASS | REVISE | REJECT');

      await service.refresh();

      const progress = crucibleProgress();
      expect(progress.rounds[0].verdict).toBe('unparsed');
      expect(progress.termination).toBe('in-progress');
    });

    it('reports unavailable when a judge report cannot be read', async () => {
      artifacts = ['round-1-judge.md'];
      mockRpc.call.mockImplementation(async (method: string) => {
        if (method === 'tasks:get') {
          return rpcOk({ task: { artifacts: ['round-1-judge.md'] } });
        }
        return rpcFailed('permission denied');
      });

      await service.refresh();

      expect(unavailableProgress().reason).toContain('permission denied');
    });

    it('refuses a judge report echoed back under the wrong round', async () => {
      artifacts = ['round-1-judge.md'];
      mockRpc.call.mockImplementation(async (method: string) => {
        if (method === 'tasks:get') {
          return rpcOk({ task: { artifacts: ['round-1-judge.md'] } });
        }
        return rpcOk({ round: 2, content: judgeReport('PASS') });
      });

      await service.refresh();

      expect(unavailableProgress().reason).toContain('tagged round 2');
    });

    it('yields no round for a listed report that reads back empty', async () => {
      artifacts = ['round-1-judge.md', 'round-2-judge.md'];
      judges[1] = judgeReport('REVISE', [
        'D1 [minor] src/b.ts:4 — typo — fix it',
      ]);
      judges[2] = null;

      await service.refresh();

      expect(crucibleProgress().rounds.map((round) => round.round)).toEqual([
        1,
      ]);
    });

    it('passes the round as an integer — the panel never sends a filename', async () => {
      artifacts = ['round-1-judge.md'];
      judges[1] = judgeReport('PASS');

      await service.refresh();

      expect(mockRpc.call).toHaveBeenCalledWith('tasks:getRoundJudge', {
        taskId: TASK_ID,
        round: 1,
        workspaceRoot: '/repo',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Refresh trigger and write safety
  // -------------------------------------------------------------------------

  describe('refresh trigger', () => {
    it('recomputes from an effect over the agent roster — no tasks:changed subscription', async () => {
      TestBed.flushEffects();
      await settle();
      const before = mockState.setProgress.mock.calls.length;
      expect(before).toBeGreaterThan(0);

      agents.set([makeAgent({ agentId: 'a1', status: 'running' })]);
      TestBed.flushEffects();
      await settle();

      expect(mockState.setProgress.mock.calls.length).toBeGreaterThan(before);
    });

    it('drops a derivation whose run changed while it was in flight', async () => {
      mockRpc.call.mockImplementation(async () => {
        mockState.specTaskId.mockReturnValue('TASK_2026_901');
        return rpcOk({ task: { artifacts: [] } });
      });

      await service.refresh();

      expect(mockState.setProgress).not.toHaveBeenCalled();
    });

    it('publishes only the newest of two overlapping refreshes', async () => {
      await Promise.all([service.refresh(), service.refresh()]);

      expect(mockState.setProgress).toHaveBeenCalledTimes(1);
    });
  });
});
