/**
 * Dashboard-spec fixtures (TASK_2026_493_9f58).
 *
 * Shared between the contract's own specs in `src/mcp-apps-contracts` and the
 * MCP tool's spec in `libs/backend/vscode-lm-tools`, so both measurement points
 * are proved against the SAME at-limit and over-limit documents rather than
 * against two hand-built approximations of them.
 *
 * Every builder returns a VALID document unless a caller pushes one of its
 * numbers past a budget. Deliberately invalid documents (a bad version, an
 * unknown kind, a `javascript:` URL) stay inline in the specs that assert on
 * them, because their whole point is that they are not this shape.
 */

import type {
  DashboardComponent,
  DashboardListComponent,
  DashboardSeries,
  DashboardSpecEnvelope,
  DashboardStatComponent,
  DashboardTableComponent,
} from '../../mcp-apps-contracts/dashboard-spec.types';

/**
 * UTF-8 bytes of a value's JSON encoding — the same measure
 * `jsonUtf8Bytes` (`libs/backend/platform-core/src/utils/json-budget.ts`)
 * applies at the MCP boundary, restated here because a shared lib must not
 * import a backend lib (see `dashboard-spec.validator.ts`).
 */
export function dashboardJsonBytes(value: unknown): number {
  const encoded = JSON.stringify(value);
  return Buffer.byteLength(encoded === undefined ? 'null' : encoded, 'utf8');
}

/** A minimal valid envelope. Override any field to break exactly one rule. */
export function makeDashboardSpec(
  overrides: Partial<DashboardSpecEnvelope> = {},
): DashboardSpecEnvelope {
  return {
    schemaVersion: 'dashboard-spec/1',
    catalogVersion: 'dashboard-catalog/1',
    specId: 'build-health',
    revision: 1,
    generatedAt: '2026-09-22T10:00:00Z',
    title: { text: 'Build health' },
    components: [makeStat()],
    ...overrides,
  };
}

export function makeStat(
  overrides: Partial<DashboardStatComponent> = {},
): DashboardStatComponent {
  return { id: 'passing', kind: 'stat', title: { text: 'Passing' }, value: 42, ...overrides };
}

/** `count` sibling stats with distinct ids. */
export function makeStats(count: number): DashboardComponent[] {
  return Array.from({ length: count }, (_unused, index) =>
    makeStat({ id: `stat-${index}`, value: index }),
  );
}

/**
 * A chain `depth` levels deep: one root, one child per level. Depth 1 is a
 * single childless node, which is what `dashboardTreeDepth` reports for a flat
 * row of tiles.
 */
export function makeNestedStats(depth: number): DashboardComponent[] {
  if (depth <= 0) return [];
  let node: DashboardStatComponent = makeStat({ id: `level-${depth}` });
  for (let level = depth - 1; level >= 1; level--) {
    node = makeStat({ id: `level-${level}`, children: [node] });
  }
  return [node];
}

/**
 * `total` nodes arranged two levels deep, so the total exercises the tree-wide
 * component count rather than the root array's own `max`.
 */
export function makeStatPairs(total: number): DashboardComponent[] {
  const roots = Math.ceil(total / 2);
  return Array.from({ length: roots }, (_unused, index) => {
    const hasChild = index * 2 + 1 < total;
    return makeStat({
      id: `pair-${index}`,
      ...(hasChild ? { children: [makeStat({ id: `pair-${index}-child` })] } : {}),
    });
  });
}

export function makeTable(
  rowCount: number,
  columnCount: number,
): DashboardTableComponent {
  return {
    id: 'slowest-tests',
    kind: 'table',
    title: { text: 'Slowest tests' },
    columns: Array.from({ length: columnCount }, (_unused, index) => ({
      key: `c${index}`,
      label: { text: `Column ${index}` },
    })),
    rows: Array.from({ length: rowCount }, (_unused, rowIndex) =>
      Array.from({ length: columnCount }, (_cell, cellIndex) => rowIndex * 100 + cellIndex),
    ),
  };
}

/** One chart whose points are split across `perSeries.length` series. */
export function makeChart(perSeries: readonly number[]): DashboardComponent {
  const series: DashboardSeries[] = perSeries.map((points, index) => ({
    name: `series-${index}`,
    points: Array.from({ length: points }, (_unused, pointIndex) => ({
      x: pointIndex,
      y: pointIndex % 7,
    })),
  }));
  return { id: 'duration', kind: 'line-chart', title: { text: 'Duration' }, series };
}

export function makeList(texts: readonly string[]): DashboardListComponent {
  return {
    id: 'failures',
    kind: 'list',
    title: { text: 'Failures' },
    items: texts.map((text) => ({ text: { text } })),
  };
}

/** Widest single string the contract accepts, so padding needs fewest items. */
const PAD_CHUNK = 2_000;

/**
 * A valid spec whose JSON encoding is EXACTLY `targetBytes` UTF-8 bytes.
 *
 * The per-item JSON overhead is measured rather than assumed: one probe item is
 * added and the delta is read back, so the arithmetic cannot drift if the list
 * item's shape ever changes. Throws instead of returning an approximation — a
 * byte-budget test that silently ran at 262,140 bytes would pass for the wrong
 * reason and never catch an off-by-one in the check it exists to pin.
 */
export function makeDashboardSpecOfExactBytes(
  targetBytes: number,
): DashboardSpecEnvelope {
  const build = (padding: readonly string[]): DashboardSpecEnvelope =>
    makeDashboardSpec({ components: [makeList(padding)] });

  const maxChunks = Math.ceil(targetBytes / PAD_CHUNK) + 2;
  for (let chunks = 0; chunks <= maxChunks; chunks++) {
    const full = Array.from({ length: chunks }, () => 'a'.repeat(PAD_CHUNK));
    const withoutTail = dashboardJsonBytes(build(full));
    if (withoutTail === targetBytes) return build(full);
    if (withoutTail > targetBytes) break;

    const probeBytes = dashboardJsonBytes(build([...full, 'a']));
    const itemOverhead = probeBytes - withoutTail - 1;
    const tailLength = targetBytes - withoutTail - itemOverhead;
    if (tailLength >= 1 && tailLength <= PAD_CHUNK) {
      return build([...full, 'a'.repeat(tailLength)]);
    }
  }

  throw new Error(
    `cannot build a dashboard spec of exactly ${targetBytes} bytes with ${PAD_CHUNK}-char padding items`,
  );
}
