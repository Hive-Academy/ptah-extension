import type { ContextCapacity } from '../lib/utils/pricing.utils';
import { getModelContextWindow } from '../lib/utils/pricing.utils';
import {
  agentContextAccessibleText,
  agentContextSortKey,
  agentContextText,
  agentsRowValues,
  agentsScalarValue,
  normalizeAgentStatus,
  resolvePtahUiAgents,
  type AgentNodeFact,
  type CliLaneFact,
  type PtahUiAgentsInput,
  type PtahUiAgentsView,
  type SubagentFact,
  type TurnAgentFacts,
} from './ptah-ui-agents-source';
import { SURFACE_LIMITS } from './surface-catalog';

const COLUMNS = ['name', 'status', 'tokens', 'cost', 'duration', 'context'];

function turn(
  startedAt: number,
  nodes: readonly AgentNodeFact[] = [],
  spawnToolCallIds: readonly string[] = [],
): TurnAgentFacts {
  return { startedAt, nodes, spawnToolCallIds };
}

function input(
  overrides: Partial<PtahUiAgentsInput> & Pick<PtahUiAgentsInput, 'turns'>,
): PtahUiAgentsInput {
  return {
    turnIndex: overrides.turns.length - 1,
    records: [],
    lanes: [],
    capacities: [],
    ...overrides,
  };
}

function available(view: PtahUiAgentsView) {
  if (view.kind !== 'available') throw new Error('expected available');
  return view;
}

function cells(view: PtahUiAgentsView, columns = COLUMNS) {
  return agentsRowValues(available(view).rows, columns);
}

describe('normalizeAgentStatus (R5.2)', () => {
  it.each([
    ['pending', 'pending'],
    ['streaming', 'running'],
    ['resumed', 'running'],
    ['running', 'running'],
    ['paused', 'running'],
    ['background', 'running'],
    ['complete', 'completed'],
    ['completed', 'completed'],
    ['background_completed', 'completed'],
    ['error', 'failed'],
    ['failed', 'failed'],
    ['interrupted', 'stopped'],
    ['stopped', 'stopped'],
    ['killed', 'stopped'],
    ['timeout', 'stopped'],
    ['something-new', 'pending'],
    ['toString', 'pending'],
  ])('maps %s to %s', (raw, expected) => {
    expect(normalizeAgentStatus(raw)).toBe(expected);
  });
});

describe('resolvePtahUiAgents', () => {
  describe('missing input', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      [
        'a turn index past the facts',
        input({ turns: [turn(1)], turnIndex: 1 }),
      ],
      ['a negative turn index', input({ turns: [turn(1)], turnIndex: -1 })],
    ])('is unavailable for %s, never an invalid block', (_name, value) => {
      const view = resolvePtahUiAgents(value);
      expect(view).toEqual({ kind: 'unavailable' });
      for (const field of ['total', 'tokens', 'cost'])
        expect(agentsScalarValue(view, field)).toBe('unavailable');
    });
  });

  describe('one row per agent (R5.9)', () => {
    it('(a) merges N and R on the same tool-use id; status from R while running', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [
              turn(0, [
                {
                  id: 'n1',
                  toolCallId: 't1',
                  status: 'complete',
                  tokens: 1000,
                  cost: 0.1,
                  agentType: 'reviewer',
                },
              ]),
            ],
            records: [
              {
                parentToolUseId: 't1',
                status: 'running',
                inputTokens: 5,
                outputTokens: 5,
                cost: 9,
              },
            ],
          }),
        ),
      );
      expect(view.rows).toHaveLength(1);
      expect(view.rows[0]).toMatchObject({
        key: 'sdk:t1',
        status: 'running',
        tokens: 1000,
        cost: 0.1,
      });
      expect(view.scalars).toMatchObject({ total: 1, tokens: 1000, cost: 0.1 });
      expect(agentsScalarValue(view, 'cost')).toBe('$0.10');
    });

    it('(a) takes N status once R is terminal', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [turn(0, [{ id: 'n1', toolCallId: 't1', status: 'error' }])],
            records: [{ parentToolUseId: 't1', status: 'completed' }],
          }),
        ),
      );
      expect(view.rows[0]?.status).toBe('failed');
    });

    it('(b) merges N and R on the same agent id when N has no tool-use id', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [
              turn(
                0,
                [{ id: 'n1', agentId: 'a1', status: 'complete' }],
                ['t9'],
              ),
            ],
            records: [
              { parentToolUseId: 't9', agentId: 'a1', status: 'completed' },
            ],
          }),
        ),
      );
      expect(view.rows.map((row) => row.key)).toEqual(['sdk:t9']);
      expect(view.scalars.total).toBe(1);
    });

    it('(c) keeps an N with no identity apart from an unrelated R', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [
              turn(0, [{ id: 'n1', status: 'complete', tokens: 300 }], ['t2']),
            ],
            records: [
              {
                parentToolUseId: 't2',
                status: 'completed',
                inputTokens: 100,
                outputTokens: 20,
              },
            ],
          }),
        ),
      );
      expect(view.rows).toHaveLength(2);
      expect(view.scalars).toMatchObject({ total: 2, tokens: 420 });
    });

    it('(d) gives a record-only background subagent its own row from R', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [turn(0, [], ['t3'])],
            records: [
              {
                parentToolUseId: 't3',
                teammateName: 'scout',
                status: 'background',
                inputTokens: 40,
                outputTokens: 2,
                cost: 0.5,
                durationMs: 1200,
              },
            ],
          }),
        ),
      );
      expect(view.rows).toEqual([
        {
          key: 'sdk:t3',
          name: 'scout',
          status: 'running',
          tokens: 42,
          cost: 0.5,
          durationMs: 1200,
          context: null,
        },
      ]);
      expect(view.scalars).toMatchObject({ total: 1, running: 1, tokens: 42 });
    });

    it('(e) never merges a CLI lane, even with an N carrying the same id', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [
              turn(100, [
                {
                  id: 'lane-1',
                  agentId: 'lane-1',
                  status: 'complete',
                  tokens: 5,
                },
              ]),
            ],
            lanes: [
              {
                agentId: 'lane-1',
                cli: 'codex',
                status: 'completed',
                startedAt: 150,
                tokens: 7,
                cost: 0.02,
              },
            ],
          }),
        ),
      );
      expect(view.rows.map((row) => row.key).sort()).toEqual([
        'cli:lane-1',
        'sdk-node:lane-1',
      ]);
      expect(view.scalars).toMatchObject({ total: 2, tokens: 12 });
    });

    it('(f) merges only the first of two N candidates for one R', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [
              turn(
                0,
                [
                  { id: 'n1', agentId: 'a1', status: 'complete', tokens: 10 },
                  { id: 'n2', agentId: 'a1', status: 'complete', tokens: 20 },
                ],
                ['t1'],
              ),
            ],
            records: [
              {
                parentToolUseId: 't1',
                agentId: 'a1',
                status: 'completed',
                inputTokens: 999,
                outputTokens: 999,
              },
            ],
          }),
        ),
      );
      expect(view.rows.map((row) => row.key).sort()).toEqual([
        'sdk-node:n2',
        'sdk:t1',
      ]);
      expect(view.scalars).toMatchObject({ total: 2, tokens: 30 });
    });
  });

  describe('unavailable, never zero (R5.3)', () => {
    const view = resolvePtahUiAgents(
      input({
        turns: [
          turn(0, [
            {
              id: 'n1',
              agentType: 'builder',
              status: 'streaming',
              durationMs: 4000,
            },
            {
              id: 'n2',
              agentType: 'tester',
              status: 'complete',
              tokens: 10,
              cost: null,
              durationMs: 2000,
            },
          ]),
        ],
      }),
    );

    it('renders missing tokens, null cost and a running duration as unavailable', () => {
      expect(cells(view, ['name', 'tokens', 'cost', 'duration'])).toEqual([
        ['builder', 'unavailable', 'unavailable', 'unavailable'],
        ['tester', 10, 'unavailable', '2.0s'],
      ]);
    });

    it('makes the cost and tokens scalars unavailable when any row lacks them', () => {
      expect(agentsScalarValue(view, 'cost')).toBe('unavailable');
      expect(agentsScalarValue(view, 'tokens')).toBe('unavailable');
      expect(agentsScalarValue(view, 'total')).toBe(2);
      expect(agentsScalarValue(view, 'running')).toBe(1);
      expect(agentsScalarValue(view, 'completed')).toBe(1);
      expect(agentsScalarValue(view, 'unknown-field')).toBe('unavailable');
    });

    it('names an N with no allow-listed name "unavailable"', () => {
      const unnamed = resolvePtahUiAgents(
        input({ turns: [turn(0, [{ id: 'n1', status: 'complete' }])] }),
      );
      expect(cells(unnamed, ['name'])).toEqual([['unavailable']]);
    });
  });

  describe('context (R5.10, R5.12)', () => {
    const MODEL = 'claude-sonnet-4-5';
    const capacity = (
      overrides: Partial<ContextCapacity> = {},
    ): ContextCapacity => ({
      model: MODEL,
      source: 'sdk-native',
      providerId: null,
      tokens: 200_000,
      ...overrides,
    });
    const record: SubagentFact = {
      parentToolUseId: 't1',
      status: 'completed',
      contextTokens: 50_000,
      model: MODEL,
    };
    const resolveContext = (
      capacities: readonly ContextCapacity[],
      fact: SubagentFact = record,
    ) =>
      available(
        resolvePtahUiAgents(
          input({ turns: [turn(0, [], ['t1'])], records: [fact], capacities }),
        ),
      ).rows[0];

    it('(a) shows tokens and the window percent with sdk-native evidence', () => {
      const row = resolveContext([capacity()]);
      expect(row?.context).toEqual({ tokens: 50_000, percent: 25 });
      expect(agentContextText(row?.context ?? null)).toBe('50,000 · 25%');
      expect(agentContextAccessibleText(row?.context ?? null)).toBe(
        '50,000 context tokens, 25 percent of the context window',
      );
    });

    it('accepts provider-catalog evidence with a provider id, to one decimal', () => {
      const row = resolveContext([
        capacity({
          source: 'provider-catalog',
          providerId: 'openrouter',
          tokens: 300_000,
        }),
      ]);
      expect(row?.context).toEqual({ tokens: 50_000, percent: 16.7 });
    });

    it.each<[string, readonly ContextCapacity[]]>([
      ['(b) an unknown source', [capacity({ source: 'unknown' })]],
      [
        '(c) provider-catalog with a null provider id',
        [capacity({ source: 'provider-catalog', providerId: null })],
      ],
      [
        '(c) provider-catalog with an empty provider id',
        [capacity({ source: 'provider-catalog', providerId: '' })],
      ],
      [
        '(d) evidence for a different model',
        [capacity({ model: 'other-model' })],
      ],
      ['a null limit', [capacity({ tokens: null })]],
      ['a zero limit', [capacity({ tokens: 0 })]],
    ])('shows tokens only with %s', (_name, capacities) => {
      const row = resolveContext(capacities);
      expect(row?.context).toEqual({ tokens: 50_000, percent: null });
      expect(agentContextText(row?.context ?? null)).toBe('50,000');
      expect(agentContextAccessibleText(row?.context ?? null)).toBe(
        '50,000 context tokens',
      );
    });

    it('(e) never uses the model-family window when no evidence exists', () => {
      expect(getModelContextWindow(MODEL)).toBeGreaterThan(0);
      const row = resolveContext([]);
      expect(row?.context?.percent).toBeNull();
      expect(agentContextText(row?.context ?? null)).not.toContain('%');
    });

    it('(f) is unavailable when the last request reported no context', () => {
      const row = resolveContext([capacity()], {
        parentToolUseId: 't1',
        status: 'completed',
        model: MODEL,
      });
      expect(row?.context).toBeNull();
      expect(agentContextText(null)).toBe('unavailable');
      expect(agentContextAccessibleText(null)).toBe('context unavailable');
    });

    it('(g) is unavailable for a CLI lane, even if a figure is smuggled in', () => {
      const lane = {
        agentId: 'l1',
        cli: 'gemini',
        status: 'running',
        startedAt: 5,
        contextTokens: 50_000,
      } as CliLaneFact;
      const view = resolvePtahUiAgents(
        input({ turns: [turn(0)], lanes: [lane], capacities: [capacity()] }),
      );
      expect(cells(view, ['name', 'context'])).toEqual([
        ['gemini', 'unavailable'],
      ]);
    });

    it('(h) is unavailable for N only, and takes the R value once merged', () => {
      const node: AgentNodeFact = {
        id: 'n1',
        toolCallId: 't1',
        status: 'complete',
      };
      const nOnly = resolvePtahUiAgents(input({ turns: [turn(0, [node])] }));
      expect(cells(nOnly, ['context'])).toEqual([['unavailable']]);
      const merged = resolvePtahUiAgents(
        input({
          turns: [turn(0, [node])],
          records: [record],
          capacities: [capacity()],
        }),
      );
      expect(cells(merged, ['context'])).toEqual([['50,000 · 25%']]);
    });

    it('sorts by tokens with unavailable last', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [turn(0, [], ['a', 'b', 'c'])],
            records: [
              { parentToolUseId: 'a', status: 'completed' },
              { parentToolUseId: 'b', status: 'completed', contextTokens: 900 },
              { parentToolUseId: 'c', status: 'completed', contextTokens: 10 },
            ],
          }),
        ),
      );
      const sorted = [...view.rows].sort((x, y) => {
        const a = agentContextSortKey(x);
        const b = agentContextSortKey(y);
        if (a === null) return b === null ? 0 : 1;
        if (b === null) return -1;
        return a - b;
      });
      expect(sorted.map((row) => row.key)).toEqual(['sdk:c', 'sdk:b', 'sdk:a']);
    });
  });

  describe('scope, order and cap (R5.5, R5.11, R5.13)', () => {
    // Turns 1-3 of R5.13 are indexes 0-2: A in turn 1, B and C in turn 2, D in turn 3.
    const liveTurns: readonly TurnAgentFacts[] = [
      turn(1_000, [
        {
          id: 'nA',
          toolCallId: 'tA',
          agentType: 'A',
          status: 'complete',
          startTime: 1_100,
          tokens: 1,
        },
      ]),
      turn(2_000, [
        {
          id: 'nC',
          toolCallId: 'tC',
          agentType: 'C',
          status: 'complete',
          startTime: 2_200,
          tokens: 3,
        },
        {
          id: 'nB',
          toolCallId: 'tB',
          agentType: 'B',
          status: 'complete',
          startTime: 2_100,
          tokens: 2,
          cost: 0.2,
        },
      ]),
      turn(3_000, [
        {
          id: 'nD',
          toolCallId: 'tD',
          agentType: 'D',
          status: 'complete',
          startTime: 3_100,
          tokens: 4,
        },
      ]),
    ];
    const liveRecords: readonly SubagentFact[] = [
      {
        parentToolUseId: 'tB',
        teammateName: 'B',
        status: 'completed',
        inputTokens: 50,
        outputTokens: 50,
        contextTokens: 7_000,
        model: 'm',
      },
    ];

    it('lists every agent up to the block turn for $agents session, in order', () => {
      const view = available(
        resolvePtahUiAgents(
          input({ turns: liveTurns, records: liveRecords, turnIndex: 1 }),
          'session',
        ),
      );
      expect(cells(view, ['name'])).toEqual([['A'], ['B'], ['C']]);
      expect(view.scalars.total).toBe(3);
    });

    it('keeps $agents to the block turn', () => {
      const view = available(
        resolvePtahUiAgents(
          input({ turns: liveTurns, records: liveRecords, turnIndex: 1 }),
        ),
      );
      expect(cells(view, ['name'])).toEqual([['B'], ['C']]);
      expect(view.scalars.total).toBe(2);
    });

    it('merges an N and R of turn 2 into one session row, not two', () => {
      const view = available(
        resolvePtahUiAgents(
          input({ turns: liveTurns, records: liveRecords, turnIndex: 1 }),
          'session',
        ),
      );
      expect(view.rows.filter((row) => row.key === 'sdk:tB')).toHaveLength(1);
      expect(view.scalars.tokens).toBe(6);
    });

    it('never shows an R or lane of a later turn', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: liveTurns,
            records: [{ parentToolUseId: 'tD', status: 'running' }],
            lanes: [
              {
                agentId: 'late',
                cli: 'codex',
                status: 'running',
                startedAt: 3_500,
              },
              {
                agentId: 'early',
                cli: 'codex',
                status: 'running',
                startedAt: 2_500,
              },
              {
                agentId: 'before',
                cli: 'codex',
                status: 'running',
                startedAt: 500,
              },
            ],
            turnIndex: 1,
          }),
          'session',
        ),
      );
      expect(view.rows.map((row) => row.key)).toEqual([
        'sdk-node:nA',
        'sdk-node:nB',
        'sdk-node:nC',
        'cli:early',
      ]);
    });

    it('drops an R that matches no transcript tool use (D7)', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: liveTurns,
            records: [{ parentToolUseId: 'orphan', status: 'running' }],
          }),
          'session',
        ),
      );
      expect(view.rows.some((row) => row.key === 'sdk:orphan')).toBe(false);
    });

    it('puts unknown start times last within their turn, by key', () => {
      const view = available(
        resolvePtahUiAgents(
          input({
            turns: [
              turn(
                0,
                [
                  { id: 'z', status: 'complete' },
                  { id: 'late', status: 'complete', startTime: 50 },
                  { id: 'a', status: 'complete' },
                  { id: 'early', status: 'complete', startTime: 10 },
                ],
                ['rec'],
              ),
            ],
            records: [{ parentToolUseId: 'rec', status: 'completed' }],
          }),
        ),
      );
      expect(view.rows.map((row) => row.key)).toEqual([
        'sdk-node:early',
        'sdk-node:late',
        'sdk-node:a',
        'sdk-node:z',
        'sdk:rec',
      ]);
    });

    it('caps rows at maxTableRows and counts the rest for "+N more"', () => {
      const count = SURFACE_LIMITS.maxTableRows + 1;
      const nodes = Array.from({ length: count }, (_, index) => ({
        id: `n${String(index).padStart(5, '0')}`,
        status: 'complete',
        startTime: index,
        tokens: 1,
      }));
      const view = available(
        resolvePtahUiAgents(input({ turns: [turn(0, nodes)] }), 'session'),
      );
      expect(view.rows).toHaveLength(SURFACE_LIMITS.maxTableRows);
      expect(view.omittedRows).toBe(1);
      expect(view.scalars.total).toBe(count);
      expect(view.scalars.tokens).toBe(count);
      expect(view.rows[0]?.key).toBe('sdk-node:n00000');
    });

    it('rebuilds tree-backed values on reload; R-only and lane usage read unavailable (R5.6, D8)', () => {
      const lanesLive: readonly CliLaneFact[] = [
        {
          agentId: 'l1',
          cli: 'codex',
          status: 'completed',
          startedAt: 2_300,
          tokens: 9,
          cost: 0.3,
        },
      ];
      const lanesReloaded: readonly CliLaneFact[] = [
        {
          agentId: 'l1',
          cli: 'codex',
          status: 'completed',
          startedAt: 2_300,
          tokens: null,
          cost: null,
        },
      ];
      const before = resolvePtahUiAgents(
        input({
          turns: liveTurns,
          records: liveRecords,
          lanes: lanesLive,
          turnIndex: 1,
        }),
      );
      const after = resolvePtahUiAgents(
        input({
          turns: liveTurns,
          records: [],
          lanes: lanesReloaded,
          turnIndex: 1,
        }),
      );
      const columns = ['status', 'tokens', 'cost', 'duration'];
      const nodeRows = (view: PtahUiAgentsView) =>
        agentsRowValues(
          available(view).rows.filter((row) => !row.key.startsWith('cli:')),
          columns,
        );
      expect(nodeRows(after)).toEqual(nodeRows(before));
      expect(cells(before, ['context'])[0]).toEqual(['7,000']);
      expect(cells(after, ['name', 'context', 'tokens', 'cost'])).toEqual([
        ['B', 'unavailable', 2, '$0.20'],
        ['C', 'unavailable', 3, 'unavailable'],
        ['codex', 'unavailable', 'unavailable', 'unavailable'],
      ]);
      expect(agentsScalarValue(after, 'total')).toBe(
        agentsScalarValue(before, 'total'),
      );
      expect(agentsScalarValue(after, 'tokens')).toBe('unavailable');
    });
  });

  describe('privacy (R5.1)', () => {
    it('lets no prompt or output text reach any resolved value', () => {
      const SENTINEL = 'SENTINEL-623-PRIVATE';
      const privateFields = {
        task: SENTINEL,
        description: SENTINEL,
        agentPrompt: SENTINEL,
        latestSummary: SENTINEL,
        stdout: SENTINEL,
        stderr: SENTINEL,
        errorMessage: SENTINEL,
        outputFile: SENTINEL,
      };
      const node = {
        id: 'n1',
        toolCallId: 't1',
        status: 'complete',
        ...privateFields,
      } as AgentNodeFact;
      const record = {
        parentToolUseId: 't1',
        status: 'running',
        contextTokens: 10,
        ...privateFields,
      } as SubagentFact;
      const orphanNode = {
        id: 'n2',
        status: 'error',
        ...privateFields,
      } as AgentNodeFact;
      const lane = {
        agentId: 'l1',
        cli: 'codex',
        status: 'failed',
        startedAt: 1,
        ...privateFields,
      } as CliLaneFact;
      const view = resolvePtahUiAgents(
        input({
          turns: [turn(0, [node, orphanNode], ['t2'])],
          records: [
            record,
            { ...record, parentToolUseId: 't2' } as SubagentFact,
          ],
          lanes: [lane],
        }),
        'session',
      );
      const resolved = available(view);
      const outputs = [
        JSON.stringify(resolved),
        JSON.stringify(cells(view)),
        ...['total', 'running', 'completed', 'failed', 'tokens', 'cost'].map(
          (field) => String(agentsScalarValue(view, field)),
        ),
        ...resolved.rows.map((row) => agentContextAccessibleText(row.context)),
      ];
      expect(resolved.rows).toHaveLength(4);
      for (const output of outputs) expect(output).not.toContain(SENTINEL);
    });
  });
});
