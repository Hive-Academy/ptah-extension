import { encode } from 'gpt-tokenizer';

import type { PtahUiAgentsInput } from './ptah-ui-agents-source';
import { convertPtahUi } from './ptah-ui-converter';
import { parsePtahUi } from './ptah-ui-parser';
import { compilePtahUiBlock, renderPtahUiBlock } from './ptah-ui-pipeline';
import type { PtahUiLimitsInput } from './ptah-ui-resolver';
import { PTAH_UI_CORPUS, type PtahUiCorpusCase } from './ptah-ui.corpus';
import type { PtahUiNode } from './ptah-ui.types';
import type { SurfaceComponent, SurfaceContent } from './surface.types';

const countBytes = (value: unknown): number =>
  Buffer.byteLength(JSON.stringify(value), 'utf8');

function parsed(body: string) {
  const result = parsePtahUi(body);
  if (!result.ok) throw new Error(result.failure.message);
  return result.doc;
}

// Req 5.13 / R8.4 compare the canonical fence body and compact, unresolved converter JSON.
const measured = PTAH_UI_CORPUS.map((entry) => ({
  name: entry.name,
  fenceTokens: encode(entry.body).length,
  jsonTokens: encode(
    JSON.stringify(convertPtahUi(parsed(entry.body), 'ptah-ui-corpus')),
  ).length,
}));

describe('ptah-ui corpus compactness (R8.4)', () => {
  // The counts are recorded in the test title so every run reports them.
  it.each(measured)(
    '$name: fence $fenceTokens tokens < JSON $jsonTokens tokens',
    ({ fenceTokens, jsonTokens }) => {
      expect(fenceTokens).toBeLessThan(jsonTokens);
    },
  );

  it('holds one case per new container and atom, and a mixed nested case', () => {
    const kinds = new Set<string>();
    const walk = (nodes: readonly PtahUiNode[]): void => {
      for (const node of nodes) {
        kinds.add(node.kind);
        if (node.kind === 'stats' && node.items.some((item) => item.trend))
          kinds.add('stat-trend');
        if (node.kind === 'stats' && node.items.some((item) => item.spark))
          kinds.add('stat-spark');
        if ('children' in node) walk(node.children);
      }
    };
    for (const entry of PTAH_UI_CORPUS.filter((c) => c.release === 623))
      walk(parsed(entry.body).elements);
    expect([...kinds]).toEqual(
      expect.arrayContaining([
        'row',
        'col',
        'grid',
        'card',
        'section',
        'accordion',
        'note',
        'progress',
        'badge',
        'avatar',
        'stat-trend',
        'stat-spark',
      ]),
    );
    expect(caseNamed('mixed-nested-release').body).toMatch(
      /\n {4}\S[\s\S]*\n {6}\S/,
    );
  });

  it('keeps every display id of the skill examples valid and unreserved', () => {
    for (const entry of PTAH_UI_CORPUS.filter((c) => c.displayId))
      expect(
        compilePtahUiBlock(entry.body, entry.displayId as string),
      ).toMatchObject({ ok: true });
  });
});

describe('ptah-ui skill examples (R8.3)', () => {
  const turnStart = Date.UTC(2026, 9, 10, 9, 0);
  const agents: PtahUiAgentsInput = {
    turnIndex: 1,
    turns: [
      {
        startedAt: turnStart - 60_000,
        nodes: [],
        spawnToolCallIds: [],
      },
      {
        startedAt: turnStart,
        nodes: [
          {
            id: 'n1',
            toolCallId: 't1',
            agentType: 'code-reviewer',
            startTime: turnStart + 1_000,
            status: 'complete',
          },
          {
            id: 'n2',
            agentType: 'test-writer',
            startTime: turnStart + 2_000,
            tokens: 31_540,
            cost: 0.41,
            durationMs: 61_000,
            status: 'error',
          },
        ],
        spawnToolCallIds: ['t1'],
      },
    ],
    records: [
      {
        parentToolUseId: 't1',
        agentType: 'code-reviewer',
        status: 'completed',
        inputTokens: 40_000,
        outputTokens: 8_210,
        cost: 0.62,
        durationMs: 94_000,
        contextTokens: 50_000,
        model: 'claude-sonnet-4-5',
      },
    ],
    lanes: [
      {
        // Started in the earlier turn: in `$agents session`, not in `$agents`.
        agentId: 'lane-1',
        cli: 'codex',
        displayName: 'codex',
        status: 'completed',
        startedAt: turnStart - 30_000,
        tokens: 20_118,
        cost: 0.33,
        durationMs: 45_000,
      },
      {
        agentId: 'lane-2',
        cli: 'gemini',
        status: 'running',
        startedAt: turnStart + 3_000,
        tokens: 8_402,
        cost: 0.004,
      },
    ],
    capacities: [
      {
        model: 'claude-sonnet-4-5',
        tokens: 200_000,
        source: 'sdk-native',
        providerId: null,
      },
    ],
  };
  const limits: PtahUiLimitsInput = {
    kind: 'available',
    rows: [
      {
        lane: 'codex',
        window: '5-hour',
        used: '62%',
        state: 'ok',
        reset: '14:00',
      },
      {
        lane: 'gemini',
        window: 'daily',
        used: 'unknown',
        state: 'unknown',
        reset: 'unknown',
      },
    ],
    lanes: 2,
    atLimit: 0,
    nearLimit: 0,
    unknown: 1,
    asOf: turnStart,
  };

  function render(entry: PtahUiCorpusCase): SurfaceContent {
    const result = renderPtahUiBlock(entry.body, {
      surfaceId: entry.displayId ?? 'surface',
      snapshot: null,
      agents,
      limits,
      countBytes,
    });
    if (!result.ok) throw new Error(result.reason);
    return result.content;
  }

  it('renders the subagent-usage dashboard with real $agents values', () => {
    const content = render(caseNamed('skill-subagent-usage-dashboard'));
    const components = flatten(content);
    expect(statValue(components, 'Agents')).toBe(3);
    expect(statValue(components, 'Running')).toBe(1);
    expect(statValue(components, 'Tokens')).toBe(88_152);
    expect(statValue(components, 'Cost')).toBe('$1.03');
    expect(tables(components)[0].rows).toEqual([
      ['code-reviewer', 'completed', 48_210, '$0.62', '1m 34s'],
      ['test-writer', 'failed', 31_540, '$0.41', '1m 1s'],
      ['gemini', 'running', 8_402, '$0.0040', 'unavailable'],
    ]);
    expect(JSON.stringify(content)).not.toMatch(/\$agents\./);
  });

  it('re-sends the id-update example under the same display id with new values', () => {
    const first = caseNamed('skill-id-update-first');
    const second = caseNamed('skill-id-update-second');
    expect(second.displayId).toBe(first.displayId);
    const before = flatten(render(first));
    const after = flatten(render(second));
    expect(before.find((c) => c.kind === 'progress')).toMatchObject({
      value: 40,
    });
    expect(after.find((c) => c.kind === 'progress')).toMatchObject({
      value: 100,
    });
    expect(statValue(after, 'Completed')).toBe(1);
    expect(statValue(after, 'Failed')).toBe(1);
  });

  it('lists CLI tools with usage and context, CLI context "unavailable" (#16, #28)', () => {
    const components = flatten(
      render(caseNamed('skill-cli-tools-usage-context')),
    );
    const [agentsTable, limitsTable] = tables(components);
    expect(agentsTable.rows).toEqual([
      ['codex', 'completed', 20_118, 'unavailable'],
      ['code-reviewer', 'completed', 48_210, '50,000 · 25%'],
      ['test-writer', 'failed', 31_540, 'unavailable'],
      ['gemini', 'running', 8_402, 'unavailable'],
    ]);
    expect(limitsTable.rows).toEqual([
      ['codex', '5-hour', '62%', 'ok', '14:00'],
      ['gemini', 'daily', 'unknown', 'unknown', 'unknown'],
    ]);
    expect(limitsTable.description?.text).toMatch(/^as of \d{2}:\d{2}$/);
  });

  it('renders every skill example "unavailable" without live inputs, never 0', () => {
    for (const entry of PTAH_UI_CORPUS.filter((c) => c.displayId)) {
      const result = renderPtahUiBlock(entry.body, {
        surfaceId: entry.displayId as string,
        snapshot: null,
        countBytes,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const components = flatten(result.content);
      for (const stat of components.filter((c) => c.kind === 'stat'))
        expect(stat).toMatchObject({ value: 'unavailable' });
    }
  });
});

describe('ptah-ui budget breach reasons (R3.3, decision #36)', () => {
  it.each([
    [
      'maxTreeDepth (8) exceeded',
      `${Array.from({ length: 9 }, (_, depth) => `${'  '.repeat(depth)}col`).join('\n')}\n${'  '.repeat(9)}badge ok Deep\n`,
    ],
    [
      'maxChildrenPerNode (50) exceeded',
      `row\n${Array.from({ length: 51 }, (_, i) => `  badge ok B${i}\n`).join('')}`,
    ],
    ['maxGridColumns (4) exceeded', 'grid 5\n  badge ok Wide\n'],
  ])('falls back with a reason naming %s', (limit, body) => {
    const result = renderPtahUiBlock(body, {
      surfaceId: 'surface',
      snapshot: null,
      countBytes,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason.startsWith(limit)).toBe(true);
    expect(result.reason).not.toContain('block exceeds a display limit');
  });
});

function caseNamed(name: string): PtahUiCorpusCase {
  const entry = PTAH_UI_CORPUS.find((c) => c.name === name);
  if (entry === undefined) throw new Error(`no corpus case ${name}`);
  return entry;
}

function flatten(content: SurfaceContent): SurfaceComponent[] {
  if (content.contract !== 'dashboard-spec/2') return [];
  const out: SurfaceComponent[] = [];
  const walk = (components: readonly SurfaceComponent[]): void => {
    for (const component of components) {
      out.push(component);
      if ('children' in component) walk(component.children);
    }
  };
  walk(content.surface.components);
  return out;
}

function statValue(
  components: readonly SurfaceComponent[],
  title: string,
): unknown {
  const stat = components.find(
    (c) => c.kind === 'stat' && c.title?.text === title,
  );
  if (stat === undefined || stat.kind !== 'stat')
    throw new Error(`no stat ${title}`);
  return stat.value;
}

function tables(
  components: readonly SurfaceComponent[],
): Extract<SurfaceComponent, { kind: 'table' }>[] {
  return components.filter(
    (c): c is Extract<SurfaceComponent, { kind: 'table' }> =>
      c.kind === 'table',
  );
}
