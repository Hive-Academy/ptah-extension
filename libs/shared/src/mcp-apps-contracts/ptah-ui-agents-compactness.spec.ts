import { encode } from 'gpt-tokenizer';

import type { PtahUiAgentsInput } from './ptah-ui-agents-source';
import { convertPtahUi } from './ptah-ui-converter';
import { parsePtahUi } from './ptah-ui-parser';
import { renderPtahUiBlock } from './ptah-ui-pipeline';
import { PTAH_UI_CORPUS } from './ptah-ui.corpus';
import { SURFACE_CATALOG_VERSION } from './surface-catalog';
import type { SurfaceComponent } from './surface.types';
import { validateSurfaceDocument } from './surface.validator';

const countBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

/**
 * R8.5: five agents with name, status, tokens, cost and duration, as (a) the
 * display fence an agent writes with `$agents` and (b) the GitHub-markdown
 * table it would otherwise type out.
 */
const FIVE_AGENTS: PtahUiAgentsInput = {
  turnIndex: 0,
  turns: [
    {
      startedAt: 0,
      nodes: [
        node('n1', 'code-reviewer', 1_000, 48_210, 0.62, 94_000, 'complete'),
        node('n2', 'test-writer', 2_000, 31_540, 0.41, 61_000, 'complete'),
        node('n3', 'researcher', 3_000, 12_905, 0.17, 22_400, 'running'),
      ],
      spawnToolCallIds: [],
    },
  ],
  records: [],
  lanes: [
    {
      agentId: 'lane-1',
      cli: 'codex',
      status: 'failed',
      startedAt: 4_000,
      tokens: 20_118,
      cost: 0.33,
      durationMs: 45_000,
    },
    {
      agentId: 'lane-2',
      cli: 'gemini',
      status: 'completed',
      startedAt: 5_000,
      tokens: 8_402,
      cost: 0.004,
      durationMs: 12_300,
    },
  ],
  capacities: [],
};

const DISPLAY_FENCE =
  '```ptah-ui display subagents\ntable $agents\n  cols name | status | tokens | cost | duration\n```';

const MARKDOWN_TABLE = [
  '| Name | Status | Tokens | Cost | Duration |',
  '| --- | --- | --- | --- | --- |',
  '| code-reviewer | completed | 48210 | $0.62 | 1m 34s |',
  '| test-writer | completed | 31540 | $0.41 | 1m 1s |',
  '| researcher | running | 12905 | $0.17 | unavailable |',
  '| codex | failed | 20118 | $0.33 | 45.0s |',
  '| gemini | completed | 8402 | $0.0040 | 12.3s |',
].join('\n');

const fenceTokens = encode(DISPLAY_FENCE).length;
const markdownTokens = encode(MARKDOWN_TABLE).length;

describe('$agents fence vs markdown compactness (R8.5)', () => {
  it('renders the fence to exactly the values the markdown table types out', () => {
    const body = DISPLAY_FENCE.split('\n').slice(1, -1).join('\n') + '\n';
    const result = renderPtahUiBlock(body, {
      surfaceId: 'subagents',
      snapshot: null,
      agents: FIVE_AGENTS,
      countBytes,
    });
    expect(result.ok).toBe(true);
    if (!result.ok || result.content.contract !== 'dashboard-spec/2') return;
    const [table] = result.content.surface.components;
    expect(table.kind).toBe('table');
    const rows =
      (table as Extract<SurfaceComponent, { kind: 'table' }>).rows ?? [];
    expect(rows).toHaveLength(5);
    const typedRows = MARKDOWN_TABLE.split('\n')
      .slice(2)
      .map((line) => line.slice(2, -2).split(' | '));
    expect(rows.map((row) => row.map((cell) => String(cell)))).toEqual(
      typedRows,
    );
  });

  // Both counts are recorded in the test title; no ratio target is set.
  it(`uses fewer tokens as a fence (${fenceTokens}) than as markdown (${markdownTokens})`, () => {
    expect(fenceTokens).toBeLessThan(markdownTokens);
  });
});

/**
 * R3.1: every 610 corpus case converts to the envelope it produced under
 * `dashboard-catalog/3`; only `catalogVersion` moves to `/4` (D1). The
 * expectations are the 610 converter output, so any drift in the shared
 * prefix of the grammar fails here.
 */
const RELEASED_610: Readonly<Record<string, unknown>> = {
  'turn-summary-sources-crlf': {
    title: { text: 'Release readiness' },
    components: [
      {
        kind: 'stat',
        id: 'c0',
        title: { text: 'Files changed' },
        value: '$diff.files',
      },
      {
        kind: 'stat',
        id: 'c1',
        title: { text: 'Tests passed' },
        value: '$tests.passed',
      },
      {
        kind: 'stat',
        id: 'c2',
        title: { text: 'Prompt cost' },
        value: '$usage.cost',
      },
      { kind: 'stat', id: 'c3', title: { text: 'Quoted budget' }, value: '$5' },
    ],
    bindings: [
      { kind: 'scalar', componentId: 'c0', source: 'diff', field: 'files' },
      { kind: 'scalar', componentId: 'c1', source: 'tests', field: 'passed' },
      { kind: 'scalar', componentId: 'c2', source: 'usage', field: 'cost' },
    ],
  },
  'literal-table-escapes-unicode': {
    title: { text: 'Migration notes' },
    components: [
      {
        kind: 'table',
        id: 'c0',
        columns: [
          { key: 'c0', label: { text: 'Check' } },
          { key: 'c1', label: { text: 'Detail' } },
          { key: 'c2', label: { text: 'Owner' } },
        ],
        rows: [
          ['Schema | contract', '\\', 'Priya'],
          ['Price', '$5 today', 'équipe'],
          ['Empty detail', '', '東京'],
        ],
      },
    ],
    bindings: [],
  },
  'changed-files-columns': {
    title: { text: 'Files prepared for review' },
    components: [
      {
        kind: 'table',
        id: 'c0',
        columns: [
          { key: 'c0', label: { text: 'path' } },
          { key: 'c1', label: { text: 'additions' } },
          { key: 'c2', label: { text: 'deletions' } },
        ],
        rows: [],
      },
    ],
    bindings: [
      {
        kind: 'rows',
        componentId: 'c0',
        source: 'diff',
        columns: ['path', 'additions', 'deletions'],
      },
    ],
  },
  'test-run-list': {
    title: { text: 'Verification runs' },
    components: [{ kind: 'list', id: 'c0', items: [] }],
    bindings: [
      {
        kind: 'rows',
        componentId: 'c0',
        source: 'tests',
        columns: ['command', 'outcome'],
      },
    ],
  },
  'coverage-trend-chart': {
    title: { text: 'Coverage trend' },
    components: [
      {
        kind: 'line-chart',
        id: 'c0',
        title: { text: 'Coverage by run' },
        series: [
          {
            name: 'Coverage by run',
            points: [
              { x: 'Baseline', y: 72.4 },
              { x: 'Parser', y: 78.1 },
              { x: 'Pipeline', y: 84.6 },
            ],
          },
        ],
      },
    ],
    bindings: [],
  },
  'release-checklist-mixed': {
    title: { text: 'Release checklist' },
    components: [
      { kind: 'stat', id: 'c0', title: { text: 'Reviewers' }, value: '2' },
      { kind: 'stat', id: 'c1', title: { text: 'Risk' }, value: 'low' },
      {
        kind: 'table',
        id: 'c2',
        columns: [
          { key: 'c0', label: { text: 'Area' } },
          { key: 'c1', label: { text: 'Status' } },
        ],
        rows: [
          ['Parser', 'ready'],
          ['Renderer', 'queued'],
        ],
      },
      {
        kind: 'list',
        id: 'c3',
        items: [
          { text: { text: 'Run the focused shared tests' } },
          { text: { text: 'Attach the compactness report' } },
        ],
      },
      {
        kind: 'bar-chart',
        id: 'c4',
        title: { text: 'Completed checks' },
        series: [
          {
            name: 'Completed checks',
            points: [
              { x: 'Draft', y: 1 },
              { x: 'Verified', y: 3 },
            ],
          },
        ],
      },
    ],
    bindings: [],
  },
};

describe('610 corpus /3 regression (R3.1)', () => {
  const released = PTAH_UI_CORPUS.filter((entry) => entry.release === 610);

  it('covers every released 610 case', () => {
    expect(released.map((entry) => entry.name).sort()).toEqual(
      Object.keys(RELEASED_610).sort(),
    );
  });

  it.each(released.map((entry) => [entry.name, entry.body] as const))(
    '%s converts deep-equal to its 610 output except catalogVersion',
    (name, body) => {
      const parsed = parsePtahUi(body);
      if (!parsed.ok) throw new Error(parsed.failure.message);
      const { envelope, bindings } = convertPtahUi(parsed.doc, 'ptah-ui-610');
      const expected = RELEASED_610[name] as {
        title: unknown;
        components: unknown;
        bindings: unknown;
      };
      expect({ envelope, bindings }).toEqual({
        envelope: {
          schemaVersion: 'dashboard-spec/2',
          catalogVersion: 'dashboard-catalog/4',
          surfaceId: 'ptah-ui-610',
          title: expected.title,
          components: expected.components,
        },
        bindings: expected.bindings,
      });
      // Only the version literal differs: the same envelope is a valid /3 document.
      expect(
        validateSurfaceDocument(
          { ...envelope, catalogVersion: SURFACE_CATALOG_VERSION },
          countBytes,
        ).ok,
      ).toBe(true);
    },
  );
});

function node(
  id: string,
  agentType: string,
  startTime: number,
  tokens: number,
  cost: number,
  durationMs: number,
  status: string,
): PtahUiAgentsInput['turns'][number]['nodes'][number] {
  return { id, agentType, startTime, tokens, cost, durationMs, status };
}
