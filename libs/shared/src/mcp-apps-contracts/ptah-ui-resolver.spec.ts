import type { AgentNodeFact, PtahUiAgentsInput } from './ptah-ui-agents-source';
import { convertPtahUi } from './ptah-ui-converter';
import { parsePtahUi } from './ptah-ui-parser';
import { renderPtahUiBlock } from './ptah-ui-pipeline';
import {
  resolvePtahUi,
  type PtahUiLimitRow,
  type PtahUiLimitsInput,
  type PtahUiLiveSources,
} from './ptah-ui-resolver';
import type { TurnSourceSnapshot } from '../lib/utils/turn-sources.utils';
import { SURFACE_LIMITS } from './surface-catalog';
import type { SurfaceComponent, SurfaceContent } from './surface.types';

const snapshot: TurnSourceSnapshot = {
  state: 'terminal',
  incomplete: false,
  diff: {
    kind: 'available',
    changeSet: {
      sessionId: 's',
      workspaceRoot: 'w',
      turnStartedAt: 0,
      turnEndedAt: 1,
      files: [
        {
          path: 'a.ts',
          status: 'M',
          additions: null,
          deletions: null,
          binary: true,
        },
      ],
      truncatedCount: 2,
      totals: { files: 1, additions: 3, deletions: 1 },
      countsUnavailable: false,
      baselineMissing: true,
    },
  },
  tests: {
    kind: 'available',
    runs: [{ command: 'npm test', outcome: 'passed' }],
    summary: { total: 1, passed: 1, failed: 0, running: 0, unknown: 0 },
  },
  usage: {
    kind: 'available',
    input: 12,
    output: 8,
    cost: 0.5,
    durationMs: 1500,
  },
};

const bytes = (value: unknown): number =>
  new TextEncoder().encode(JSON.stringify(value)).length;

function snapshotWithEmptyDiff(): TurnSourceSnapshot {
  const diff = snapshot.diff;
  if (diff.kind !== 'available') return snapshot;
  return {
    ...snapshot,
    diff: { kind: 'available', changeSet: { ...diff.changeSet, files: [] } },
  };
}

describe('resolvePtahUi', () => {
  it('formats host scalars and keeps literal rows separate', () => {
    const result = resolvePtahUi(
      convertPtahUi(
        {
          elements: [
            {
              kind: 'stats',
              items: [
                { label: 'Cost', value: { source: 'usage', field: 'cost' } },
                {
                  label: 'Duration',
                  value: { source: 'usage', field: 'duration' },
                },
              ],
            },
            { kind: 'table', columns: ['literal'], rows: [['kept']] },
            { kind: 'table', source: 'diff', columns: ['path', 'additions'] },
          ],
        },
        'surface',
      ),
      snapshot,
    );
    expect(surfaceOf(result).components).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'stat', value: '$0.50' }),
        expect.objectContaining({ kind: 'stat', value: '1.5s' }),
        expect.objectContaining({ kind: 'table', id: 'c2', rows: [['kept']] }),
        expect.objectContaining({
          kind: 'table',
          id: 'c3',
          rows: [['a.ts', 'binary']],
          description: { text: '+2 more; may include earlier changes' },
        }),
      ]),
    );
  });

  it.each(['diff', 'tests', 'usage'] as const)(
    'renders every null-snapshot source as unavailable: %s',
    (source) => {
      const result = resolvePtahUi(
        convertPtahUi(
          {
            elements: [
              {
                kind: 'stats',
                items: [
                  {
                    label: 'Value',
                    value: {
                      source,
                      field:
                        source === 'diff'
                          ? 'files'
                          : source === 'tests'
                            ? 'total'
                            : 'cost',
                    },
                  },
                ],
              },
            ],
          },
          'surface',
        ),
        null,
      );
      expect(surfaceOf(result).components[0]).toMatchObject({
        value: 'unavailable',
      });
    },
  );

  it('renders pending values as pending, never a numeric substitute', () => {
    const pending: TurnSourceSnapshot = {
      ...snapshot,
      state: 'pending',
      diff: { kind: 'pending' },
      tests: { kind: 'pending' },
      usage: { kind: 'pending' },
    };
    const result = resolvePtahUi(
      convertPtahUi(
        {
          elements: [
            {
              kind: 'stats',
              items: [
                { label: 'Files', value: { source: 'diff', field: 'files' } },
              ],
            },
          ],
        },
        'surface',
      ),
      pending,
    );
    expect(surfaceOf(result).components[0]).toMatchObject({ value: 'pending' });
  });

  it('truncates an over-limit host test command without rejecting the block', () => {
    const command = 'c'.repeat(SURFACE_LIMITS.maxStringLength + 1);
    const result = renderPtahUiBlock('table $tests\n', {
      surfaceId: 'surface',
      snapshot: {
        ...snapshot,
        tests: {
          kind: 'available',
          runs: [{ command, outcome: 'passed' }],
          summary: { total: 1, passed: 1, failed: 0, running: 0, unknown: 0 },
        },
      },
      countBytes: bytes,
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).toContain(
      `${'c'.repeat(SURFACE_LIMITS.maxStringLength - 1)}…`,
    );
  });

  it('truncates an over-limit host path without rejecting the block', () => {
    const path = 'p'.repeat(SURFACE_LIMITS.maxStringLength + 1);
    const result = renderPtahUiBlock('table $diff\n', {
      surfaceId: 'surface',
      snapshot: {
        ...snapshot,
        diff: {
          kind: 'available',
          changeSet: {
            sessionId: 's',
            workspaceRoot: 'w',
            turnStartedAt: 0,
            turnEndedAt: 1,
            files: [
              {
                path,
                status: 'M',
                additions: 1,
                deletions: 0,
                binary: false,
              },
            ],
            truncatedCount: 0,
            totals: { files: 1, additions: 1, deletions: 0 },
            countsUnavailable: false,
            baselineMissing: false,
          },
        },
      },
      countBytes: bytes,
    });
    expect(result).toMatchObject({ ok: true });
    expect(JSON.stringify(result)).toContain(
      `${'p'.repeat(SURFACE_LIMITS.maxStringLength - 1)}…`,
    );
  });

  it.each([
    [
      'pending',
      {
        ...snapshot,
        state: 'pending' as const,
        diff: { kind: 'pending' as const },
      },
      'pending',
    ],
    [
      'unavailable',
      { ...snapshot, diff: { kind: 'unavailable' as const } },
      'unavailable',
    ],
    ['empty', snapshotWithEmptyDiff(), 'No files changed this turn'],
  ] as const)(
    'keeps a %s source-table state surface-valid',
    (_state, sourceSnapshot, expected) => {
      const result = renderPtahUiBlock('table $diff\n', {
        surfaceId: 'surface',
        snapshot: sourceSnapshot,
        countBytes: bytes,
      });
      expect(result).toMatchObject({ ok: true });
      expect(JSON.stringify(result)).toContain(expected);
    },
  );

  it('rejects a rowless usage table instead of resolving it as a list', () => {
    const result = renderPtahUiBlock('table $usage\n', {
      surfaceId: 'surface',
      snapshot,
      countBytes: bytes,
    });
    expect(result).toMatchObject({
      ok: false,
      reason: 'source `usage` has no columns (line 1)',
    });
  });
});

function surfaceOf(content: SurfaceContent) {
  if (content.contract !== 'dashboard-spec/2')
    throw new Error('expected dashboard-spec/2');
  return content.surface;
}

const agentNode = (
  id: string,
  agentType: string,
  status: string,
  startTime: number,
): AgentNodeFact => ({
  id,
  agentType,
  status,
  startTime,
  tokens: 100,
  cost: 0.02,
  durationMs: 1_000,
});

/** Turn 0 ran `explorer`; turn 1, the block's turn, runs `planner` and `coder`. */
const agents: PtahUiAgentsInput = {
  turnIndex: 1,
  turns: [
    {
      startedAt: 0,
      nodes: [agentNode('n0', 'explorer', 'complete', 1)],
      spawnToolCallIds: [],
    },
    {
      startedAt: 10,
      nodes: [
        agentNode('n1', 'planner', 'streaming', 11),
        agentNode('n2', 'coder', 'complete', 12),
      ],
      spawnToolCallIds: [],
    },
  ],
  records: [],
  lanes: [],
  capacities: [],
};

/** R10.10: one lane at limit (one window), one near limit (two), one failed lookup. */
const asOf = new Date(2026, 9, 10, 14, 32).getTime();
const limitRows: readonly PtahUiLimitRow[] = [
  {
    lane: 'codex',
    window: '5h',
    used: '100%',
    state: 'AT LIMIT',
    reset: '15:00',
  },
  {
    lane: 'gemini',
    window: '5h',
    used: '91%',
    state: 'near limit',
    reset: '16:10',
  },
  {
    lane: 'gemini',
    window: 'weekly',
    used: '40%',
    state: 'room',
    reset: 'Mon 09:00',
  },
  {
    lane: 'copilot',
    window: '-',
    used: 'unknown',
    state: 'unknown (limit lookup failed)',
    reset: 'reset unknown',
  },
];
const limits = {
  kind: 'available' as const,
  rows: limitRows,
  lanes: 3,
  atLimit: 1,
  nearLimit: 1,
  unknown: 1,
  asOf,
} satisfies PtahUiLimitsInput;

function resolveBody(body: string, live: PtahUiLiveSources) {
  const parsed = parsePtahUi(body);
  if (!parsed.ok) throw new Error(parsed.failure.message);
  return surfaceOf(
    resolvePtahUi(convertPtahUi(parsed.doc, 'surface'), snapshot, live),
  );
}

function flatten(
  components: readonly SurfaceComponent[],
): readonly SurfaceComponent[] {
  return components.flatMap((component) =>
    'children' in component
      ? [component, ...flatten(component.children)]
      : [component],
  );
}

function byId(components: readonly SurfaceComponent[], id: string) {
  const found = flatten(components).find((component) => component.id === id);
  if (found === undefined) throw new Error(`no component ${id}`);
  return found;
}

describe('resolvePtahUi live sources', () => {
  it('resolves bindings at every depth, leaving no source placeholder (decision #27)', () => {
    const surface = resolveBody(
      [
        'section Agents',
        '  card Totals',
        '    stats',
        '      Turn | $agents.total',
        '      Session | $agents.session.total',
        '      Files | $diff.files',
        '      Lanes | $limits.lanes',
        '  table $agents session',
        '    cols name | status',
        '  accordion Limits',
        '    list $limits',
        '',
      ].join('\n'),
      { agents, limits },
    );
    expect(byId(surface.components, 'c0.0.0')).toMatchObject({
      kind: 'stat',
      value: 2,
    });
    expect(byId(surface.components, 'c0.0.1')).toMatchObject({
      kind: 'stat',
      value: 3,
    });
    expect(byId(surface.components, 'c0.0.2')).toMatchObject({
      kind: 'stat',
      value: 1,
    });
    expect(byId(surface.components, 'c0.0.3')).toMatchObject({
      kind: 'stat',
      value: 3,
    });
    expect(byId(surface.components, 'c0.1')).toMatchObject({
      kind: 'table',
      rows: [
        ['explorer', 'completed'],
        ['planner', 'running'],
        ['coder', 'completed'],
      ],
    });
    expect(byId(surface.components, 'c0.2.0')).toMatchObject({
      kind: 'list',
      items: [
        { text: { text: 'codex' } },
        { text: { text: 'gemini' } },
        { text: { text: 'copilot' } },
      ],
    });
    expect(JSON.stringify(surface)).not.toMatch(
      /\$(?:agents|limits|diff|tests|usage)\./,
    );
  });

  it('keeps $agents to the block turn and $agents session to every turn up to it', () => {
    const surface = resolveBody(
      'table $agents\n  cols name\nlist $agents session\n',
      { agents },
    );
    expect(byId(surface.components, 'c0')).toMatchObject({
      rows: [['planner'], ['coder']],
    });
    expect(byId(surface.components, 'c1')).toMatchObject({
      items: [
        { text: { text: 'explorer' } },
        { text: { text: 'planner' } },
        { text: { text: 'coder' } },
      ],
    });
  });

  it('formats the $agents scalars through the agents module', () => {
    const surface = resolveBody(
      'stats\n  Cost | $agents.session.cost\n  Tokens | $agents.tokens\n  Running | $agents.running\n',
      { agents },
    );
    expect(
      surface.components.map(
        (component) => 'value' in component && component.value,
      ),
    ).toEqual(['$0.06', 200, 1]);
  });

  it('renders a zero-agent cost as a true zero, not a missing value', () => {
    const surface = resolveBody(
      'stats\n  Cost | $agents.cost\n  Total | $agents.total\n',
      {
        agents: {
          ...agents,
          turnIndex: 0,
          turns: [{ startedAt: 0, nodes: [], spawnToolCallIds: [] }],
        },
      },
    );
    expect(surface.components).toMatchObject([
      { kind: 'stat', value: '$0.0000' },
      { kind: 'stat', value: 0 },
    ]);
  });

  it('shows the session empty state for an agentless $agents session table', () => {
    const surface = resolveBody('table $agents session\n', {
      agents: {
        ...agents,
        turnIndex: 0,
        turns: [{ startedAt: 0, nodes: [], spawnToolCallIds: [] }],
      },
    });
    expect(surface.components[0]).toMatchObject({
      rows: [],
      description: { text: 'No agents in this session' },
    });
  });

  it('announces $agents rows past the row cap as "+N more"', () => {
    const nodes = Array.from(
      { length: SURFACE_LIMITS.maxTableRows + 2 },
      (_, index) => agentNode(`n${index}`, `agent-${index}`, 'complete', index),
    );
    const surface = resolveBody('table $agents\n', {
      agents: {
        ...agents,
        turnIndex: 0,
        turns: [{ startedAt: 0, nodes, spawnToolCallIds: [] }],
      },
    });
    const table = surface.components[0];
    expect(table).toMatchObject({ description: { text: '+2 more' } });
    expect(table.kind === 'table' && table.rows?.length).toBe(
      SURFACE_LIMITS.maxTableRows,
    );
  });

  it.each([
    ['absent', {}],
    ['null', { agents: null, limits: null }],
  ] as const)(
    'renders %s live inputs as unavailable, never zero',
    (_name, live) => {
      const surface = resolveBody(
        'stats\n  A | $agents.total\n  L | $limits.lanes\ntable $agents\n  cols name | cost\nlist $limits\n',
        live,
      );
      expect(surface.components).toMatchObject([
        { value: 'unavailable' },
        { value: 'unavailable' },
        { rows: [['unavailable', 'unavailable']] },
        { items: [{ text: { text: 'unavailable' } }] },
      ]);
    },
  );

  it('resolves $limits with three lanes into four rows and lane scalars (R10.10)', () => {
    const surface = resolveBody(
      'stats\n  Lanes | $limits.lanes\n  At limit | $limits.atLimit\n  Near | $limits.nearLimit\n  Unknown | $limits.unknown\ntable $limits\n',
      { limits },
    );
    expect(surface.components.slice(0, 4)).toMatchObject([
      { value: 3 },
      { value: 1 },
      { value: 1 },
      { value: 1 },
    ]);
    expect(surface.components[4]).toMatchObject({
      kind: 'table',
      rows: limitRows.map((row) => [
        row.lane,
        row.window,
        row.used,
        row.state,
        row.reset,
      ]),
      description: { text: 'as of 14:32' },
    });
  });

  it('keeps the "as of" time beside the empty state and the row cap', () => {
    const empty = resolveBody('table $limits\n', {
      limits: { ...limits, rows: [] },
    });
    expect(empty.components[0]).toMatchObject({
      description: { text: 'No CLI lanes; as of 14:32' },
    });
    const row = {
      lane: 'x',
      window: 'w',
      used: '1%',
      state: 'room',
      reset: 'r',
    };
    const many = resolveBody('table $limits\n', {
      limits: {
        ...limits,
        rows: Array.from(
          { length: SURFACE_LIMITS.maxTableRows + 1 },
          () => row,
        ),
      },
    });
    expect(many.components[0]).toMatchObject({
      description: { text: 'as of 14:32; +1 more' },
    });
  });

  const limitRow = (lane: string, window: string) => ({
    lane,
    window,
    used: '1%',
    state: 'room',
    reset: 'r',
  });
  const listTexts = (surface: ReturnType<typeof resolveBody>) => {
    const list = surface.components[0];
    return list.kind === 'list'
      ? (list.items ?? []).map((item) => item.text.text)
      : [];
  };

  it('lists a lane whose windows all fall past the table row cap', () => {
    const rows = [
      ...Array.from({ length: SURFACE_LIMITS.maxTableRows }, (_, index) =>
        limitRow('codex', `w${index}`),
      ),
      limitRow('grok', 'w0'),
    ];
    expect(
      listTexts(resolveBody('list $limits\n', { limits: { ...limits, rows } })),
    ).toEqual(['codex', 'grok']);
    const table = resolveBody('table $limits\n', {
      limits: { ...limits, rows },
    }).components[0];
    expect(table).toMatchObject({
      description: { text: 'as of 14:32; +1 more' },
    });
    expect(table.kind === 'table' && table.rows?.length).toBe(
      SURFACE_LIMITS.maxTableRows,
    );
  });

  it('caps list $limits lanes with a final "+N more" item', () => {
    const lanes = Array.from(
      { length: SURFACE_LIMITS.maxTableRows + 2 },
      (_, index) => `lane-${index}`,
    );
    const items = listTexts(
      resolveBody('list $limits\n', {
        limits: { ...limits, rows: lanes.map((lane) => limitRow(lane, 'w')) },
      }),
    );
    expect(items).toEqual([
      ...lanes.slice(0, SURFACE_LIMITS.maxTableRows - 1),
      '+3 more',
    ]);
  });

  it('lists exactly maxTableRows lanes without a "+N more" item', () => {
    const lanes = Array.from(
      { length: SURFACE_LIMITS.maxTableRows },
      (_, index) => `lane-${index}`,
    );
    expect(
      listTexts(
        resolveBody('list $limits\n', {
          limits: {
            ...limits,
            rows: lanes.map((lane) => limitRow(lane, 'w')),
          },
        }),
      ),
    ).toEqual(lanes);
  });

  it.each(['pending', 'unavailable'] as const)(
    'renders a %s $limits read as its status',
    (kind) => {
      const surface = resolveBody(
        'stats\n  L | $limits.lanes\ntable $limits\n',
        {
          limits: { kind },
        },
      );
      expect(surface.components).toMatchObject([
        { value: kind },
        { rows: [[kind, kind, kind, kind, kind]] },
      ]);
    },
  );
});

describe('renderPtahUiBlock', () => {
  it('returns validated SurfaceContent and reports parser failures', () => {
    expect(
      renderPtahUiBlock('stats\n  Files | $diff.files\n', {
        surfaceId: 'surface',
        snapshot: null,
        countBytes: bytes,
      }).ok,
    ).toBe(true);
    expect(
      renderPtahUiBlock('gauge nope\n', {
        surfaceId: 'surface',
        snapshot: null,
        countBytes: bytes,
      }),
    ).toMatchObject({ ok: false, reason: expect.any(String) });
  });
});
