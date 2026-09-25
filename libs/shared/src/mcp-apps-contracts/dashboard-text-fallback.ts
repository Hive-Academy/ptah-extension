/**
 * The mandatory plain-text rendering of a dashboard spec.
 *
 * TASK_2026_493_9f58, deliverable 5. Research report Revision 6, entry 8: "the
 * text fallback for every UI-linked tool is a Ptah product requirement". The
 * CLI and the VS Code host have no dashboard page, so the tool's text content
 * IS the answer there — it is never a receipt for a UI that did the real work.
 *
 * `context.md` fixes three elements: the title, each stat as `label: value`,
 * and each table as a short text table capped at 20 rows. Charts and lists get
 * a one-line summary as well, because a host with no UI would otherwise be
 * told nothing at all about half the spec.
 *
 * The UI never parses this text (`context.md` "Transport contract"). It reads
 * the push message. So this renderer is free to change shape without breaking
 * a consumer.
 */

import {
  DASHBOARD_LIMITS,
  DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS,
} from './dashboard-catalog';
import type {
  DashboardComponent,
  DashboardRichText,
  DashboardSpecEnvelope,
  DashboardTableCell,
  DashboardTableComponent,
} from './dashboard-spec.types';

/** Display-only fields shared by v1 and v2, without actions or children. */
type TextDisplay<T> = T extends DashboardComponent
  ? Omit<T, 'actions' | 'children'>
  : never;

/** Widest a single text-table cell is printed before it is elided. */
const MAX_CELL_WIDTH = 40;

function textOf(
  value: DashboardRichText | undefined,
  fallback: string,
): string {
  const raw = value?.text.trim() ?? '';
  return raw.length > 0 ? raw : fallback;
}

/**
 * A component's human label. Falls back to the id rather than to an empty
 * string: an unlabelled tile still has to be identifiable in a text transcript.
 */
function labelOf(component: Pick<DashboardComponent, 'id' | 'title'>): string {
  return textOf(component.title, component.id);
}

function elide(value: string, width: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length <= width
    ? singleLine
    : `${singleLine.slice(0, Math.max(0, width - 1))}…`;
}

function renderCell(cell: DashboardTableCell): string {
  if (cell === null) return '';
  if (typeof cell === 'boolean') return cell ? 'true' : 'false';
  if (typeof cell === 'number') return String(cell);
  return cell;
}

/** Depth-first, document order — the order the reader sees on screen. */
function flatten(
  components: readonly DashboardComponent[],
): DashboardComponent[] {
  return components.flatMap((component) => [
    component,
    ...flatten(component.children ?? []),
  ]);
}

export function renderStat(
  component: TextDisplay<DashboardComponent>,
): string | null {
  if (component.kind !== 'stat') return null;
  const unit = component.unit === undefined ? '' : ` ${component.unit}`;
  let delta = '';
  if (component.delta !== undefined) {
    const sign = component.delta >= 0 ? '+' : '';
    delta = ` (${sign}${component.delta})`;
  }
  return `${labelOf(component)}: ${component.value}${unit}${delta}`;
}

export function renderTable(
  table: TextDisplay<DashboardTableComponent>,
): string {
  const lines: string[] = [`${labelOf(table)} (table)`];

  if (table.data !== undefined) {
    const total =
      table.data.rowCount === undefined ? '' : ` ${table.data.rowCount} rows,`;
    lines.push(
      `  rows not embedded:${total} referenced as ${table.data.resultId}`,
    );
    return lines.join('\n');
  }

  const rows = table.rows ?? [];
  const shown = rows.slice(0, DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS);
  const headers = table.columns.map((column) =>
    elide(textOf(column.label, column.key), MAX_CELL_WIDTH),
  );
  const body = shown.map((row) =>
    row.map((cell) => elide(renderCell(cell), MAX_CELL_WIDTH)),
  );

  const widths = headers.map((header, index) =>
    body.reduce(
      (widest, row) => Math.max(widest, (row[index] ?? '').length),
      header.length,
    ),
  );
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, index) => cell.padEnd(widths[index]))
      .join(' | ')
      .trimEnd();

  lines.push(
    `  ${line(headers)}`,
    `  ${widths.map((width) => '-'.repeat(width)).join('-+-')}`,
  );
  for (const row of body) lines.push(`  ${line(row)}`);

  if (rows.length > shown.length) {
    lines.push(
      `  … ${rows.length - shown.length} more row(s) of ${rows.length} not shown`,
    );
  }
  return lines.join('\n');
}

export function renderChart(
  component: TextDisplay<
    Extract<DashboardComponent, { kind: 'line-chart' | 'bar-chart' }>
  >,
): string {
  const shape = component.kind === 'line-chart' ? 'line chart' : 'bar chart';
  if (component.data !== undefined) {
    return `${labelOf(component)} (${shape}): series referenced as ${component.data.resultId}`;
  }
  const series = component.series ?? [];
  const points = series.reduce((total, one) => total + one.points.length, 0);
  const names = series.map((one) => one.name).join(', ');
  return `${labelOf(component)} (${shape}): ${series.length} series (${names}), ${points} point(s)`;
}

export function renderList(
  component: TextDisplay<Extract<DashboardComponent, { kind: 'list' }>>,
): string {
  if (component.data !== undefined) {
    return `${labelOf(component)} (list): items referenced as ${component.data.resultId}`;
  }
  const items = component.items ?? [];
  const shown = items.slice(0, DASHBOARD_TEXT_FALLBACK_MAX_TABLE_ROWS);
  const lines = [`${labelOf(component)} (list): ${items.length} item(s)`];
  for (const item of shown) {
    lines.push(`  - ${elide(item.text.text, MAX_CELL_WIDTH * 2)}`);
  }
  if (items.length > shown.length) {
    lines.push(`  … ${items.length - shown.length} more item(s) not shown`);
  }
  return lines.join('\n');
}

/**
 * Render a VALIDATED spec as plain text.
 *
 * Takes `DashboardSpecEnvelope`, never `unknown`: past the boundary the
 * inferred type is trusted, so this function does no re-validation and has no
 * failure mode of its own.
 */
export function renderDashboardSpecText(spec: DashboardSpecEnvelope): string {
  const blocks: string[] = [spec.title.text.trim()];

  const description = spec.description?.text.trim();
  if (description !== undefined && description.length > 0) {
    blocks.push(description);
  }

  const components = flatten(spec.components);

  const stats = components
    .map(renderStat)
    .filter((line): line is string => line !== null);
  if (stats.length > 0) blocks.push(stats.join('\n'));

  for (const component of components) {
    if (component.kind === 'table') {
      blocks.push(renderTable(component));
    } else if (
      component.kind === 'line-chart' ||
      component.kind === 'bar-chart'
    ) {
      blocks.push(renderChart(component));
    } else if (component.kind === 'list') {
      blocks.push(renderList(component));
    }
  }

  blocks.push(
    `spec ${spec.specId} revision ${spec.revision}, ${components.length} component(s), ` +
      `catalog ${spec.catalogVersion}, generated ${spec.generatedAt}`,
  );

  return blocks.join('\n\n');
}

/**
 * The provisional budget table, as plain text.
 *
 * Exists so a rejection can tell an agent the actual numbers instead of making
 * it guess, and so the numbers in a tool description are generated from
 * `DASHBOARD_LIMITS` rather than retyped beside it and left to drift.
 */
export function describeDashboardLimits(): string {
  return [
    `components ${DASHBOARD_LIMITS.maxComponents}`,
    `tree depth ${DASHBOARD_LIMITS.maxTreeDepth}`,
    `string length ${DASHBOARD_LIMITS.maxStringLength}`,
    `table rows ${DASHBOARD_LIMITS.maxTableRows}`,
    `table columns ${DASHBOARD_LIMITS.maxTableColumns}`,
    `series points per chart ${DASHBOARD_LIMITS.maxSeriesPoints}`,
    `total ${DASHBOARD_LIMITS.maxSpecBytes} UTF-8 bytes`,
  ].join(', ');
}
