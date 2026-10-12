import {
  formatDurationMs,
  formatUsdCost,
} from '../lib/utils/usage-format.utils';
import type { TurnSourceSnapshot } from '../lib/utils/turn-sources.utils';

import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceEnvelope,
} from './surface.types';
import { isSurfaceLayoutComponent } from './surface-bindings';
import { SURFACE_LIMITS } from './surface-catalog';
import type { PtahUiBinding, PtahUiConversion } from './ptah-ui-converter';
import {
  agentsRowValues,
  agentsScalarValue,
  resolvePtahUiAgents,
  type PtahUiAgentsInput,
  type PtahUiAgentsView,
} from './ptah-ui-agents-source';
import type { PtahUiSourceName, PtahUiSourceScope } from './ptah-ui.types';

export type ResolvedPtahUiContent = Extract<
  SurfaceContent,
  { readonly contract: 'dashboard-spec/2' }
>;

/** One `$limits` row: the first five cells of the matching list row (R10.2). */
export interface PtahUiLimitRow {
  readonly lane: string;
  readonly window: string;
  readonly used: string;
  readonly state: string;
  readonly reset: string;
}

/**
 * The latest lane plan-limit read (R10.1, R10.6). `$limits` is a current-state
 * source, so it is not part of `TurnSourceSnapshot`.
 */
export type PtahUiLimitsInput =
  | { readonly kind: 'pending' }
  | { readonly kind: 'unavailable' }
  | {
      readonly kind: 'available';
      /** Rows in list order: one per lane per window. */
      readonly rows: readonly PtahUiLimitRow[];
      /** The four R10 scalars; they count lanes, not rows. */
      readonly lanes: number;
      readonly atLimit: number;
      readonly nearLimit: number;
      readonly unknown: number;
      /** Epoch milliseconds of the read, shown as "as of HH:MM". */
      readonly asOf: number;
    };

/**
 * Live sources, kept apart from the frozen turn snapshot (D5). A missing input
 * makes its source "unavailable", never an invalid block.
 */
export interface PtahUiLiveSources {
  readonly agents?: PtahUiAgentsInput | null;
  readonly limits?: PtahUiLimitsInput | null;
}

/** Resolves host-owned data into a fully literal renderable surface. */
export function resolvePtahUi(
  conversion: PtahUiConversion,
  snapshot: TurnSourceSnapshot | null,
  live: PtahUiLiveSources = {},
): ResolvedPtahUiContent {
  const context: ResolveContext = {
    bindings: new Map(
      conversion.bindings.map((binding) => [binding.componentId, binding]),
    ),
    snapshot,
    live,
    agentViews: new Map(),
  };
  const components = conversion.envelope.components.map((component) =>
    resolveComponent(component, context),
  );
  const surface: Omit<SurfaceEnvelope, 'dataModel'> = {
    ...conversion.envelope,
    components,
  };
  return { contract: 'dashboard-spec/2', surface, dataModel: {} };
}

interface ResolveContext {
  readonly bindings: ReadonlyMap<string, PtahUiBinding>;
  readonly snapshot: TurnSourceSnapshot | null;
  readonly live: PtahUiLiveSources;
  /** One `$agents` resolution per scope per resolve, shared by every binding. */
  readonly agentViews: Map<PtahUiSourceScope | 'turn', PtahUiAgentsView>;
}

/** Resolves one component and, for a container, every descendant (D27). */
function resolveComponent(
  component: SurfaceComponent,
  context: ResolveContext,
): SurfaceComponent {
  if (isSurfaceLayoutComponent(component))
    return {
      ...component,
      children: component.children.map((child) =>
        resolveComponent(child, context),
      ),
    };
  const binding = context.bindings.get(component.id);
  if (binding === undefined) return component;
  if (binding.kind === 'scalar' && component.kind === 'stat') {
    return {
      ...component,
      value: clampHostValue(scalarValue(binding, context)),
    };
  }
  if (binding.kind === 'rows') return resolveRows(component, binding, context);
  return component;
}

function agentsView(
  context: ResolveContext,
  scope: PtahUiSourceScope | undefined,
): PtahUiAgentsView {
  const key = scope ?? 'turn';
  const cached = context.agentViews.get(key);
  if (cached !== undefined) return cached;
  const view = resolvePtahUiAgents(context.live.agents, scope);
  context.agentViews.set(key, view);
  return view;
}

function scalarValue(
  binding: Extract<PtahUiBinding, { readonly kind: 'scalar' }>,
  context: ResolveContext,
): string | number {
  const { snapshot } = context;
  switch (binding.source) {
    case 'diff': {
      const source = snapshot === null ? null : snapshot.diff;
      if (source === null || source.kind !== 'available')
        return source?.kind ?? 'unavailable';
      if (source.changeSet.countsUnavailable) return 'unavailable';
      switch (binding.field) {
        case 'files':
          return source.changeSet.totals.files;
        case 'additions':
          return source.changeSet.totals.additions;
        case 'deletions':
          return source.changeSet.totals.deletions;
        default:
          return 'unavailable';
      }
    }
    case 'tests': {
      const source = snapshot === null ? null : snapshot.tests;
      if (source === null || source.kind !== 'available')
        return source?.kind ?? 'unavailable';
      switch (binding.field) {
        case 'total':
          return source.summary.total;
        case 'passed':
          return source.summary.passed;
        case 'failed':
          return source.summary.failed;
        case 'unknown':
          return source.summary.unknown;
        default:
          return 'unavailable';
      }
    }
    case 'usage': {
      const source = snapshot === null ? null : snapshot.usage;
      if (source === null || source.kind !== 'available')
        return source?.kind ?? 'unavailable';
      switch (binding.field) {
        case 'cost':
          return formatUsdCost(source.cost) ?? 'unavailable';
        case 'duration':
          return formatDurationMs(source.durationMs);
        case 'input':
          return source.input;
        case 'output':
          return source.output;
        default:
          return 'unavailable';
      }
    }
    case 'agents':
      return agentsScalarValue(
        agentsView(context, binding.scope),
        binding.field,
      );
    case 'limits':
      return limitsScalarValue(context.live.limits, binding.field);
  }
}

function limitsScalarValue(
  limits: PtahUiLimitsInput | null | undefined,
  field: string,
): string | number {
  if (limits === null || limits === undefined) return 'unavailable';
  if (limits.kind !== 'available') return limits.kind;
  switch (field) {
    case 'lanes':
      return limits.lanes;
    case 'atLimit':
      return limits.atLimit;
    case 'nearLimit':
      return limits.nearLimit;
    case 'unknown':
      return limits.unknown;
    default:
      return 'unavailable';
  }
}

/** Resolved rows of a bound source, or the status shown in their place. */
type RowsResolution =
  | 'pending'
  | 'unavailable'
  | {
      /** Cells for the binding's columns, at most `maxTableRows` rows. */
      readonly rows: readonly (readonly (string | number | null)[])[];
      /** One text per displayed row for `list`, deduplicated where rows repeat. */
      readonly listItems: readonly string[];
      /** Notes about the displayed rows ("+N more"); dropped when there are none. */
      readonly notes: readonly string[];
      /** The read time of a current-state source ("as of HH:MM"), always shown. */
      readonly freshness?: string;
    };

function resolveRows(
  component: SurfaceComponent,
  binding: Extract<PtahUiBinding, { readonly kind: 'rows' }>,
  context: ResolveContext,
): SurfaceComponent {
  const resolved = rowsResolution(binding, context);
  const empty = emptyMessage(binding.source, binding.scope);
  if (component.kind === 'table' && component.columns.length === 0) {
    return statusList(
      component.id,
      typeof resolved === 'string' ? resolved : empty,
    );
  }
  if (component.kind === 'list') {
    if (typeof resolved === 'string')
      return { ...component, items: [{ text: { text: resolved } }] };
    return {
      ...component,
      items:
        resolved.listItems.length === 0
          ? [{ text: { text: empty } }]
          : resolved.listItems.map((text) => ({ text: { text } })),
    };
  }
  if (component.kind !== 'table') return component;
  if (typeof resolved === 'string') {
    // Req 3.2-3.4 requires a visible status while retaining the table's declared shape.
    return {
      ...component,
      rows: [statusRow(component.columns.length, resolved)],
    };
  }
  const notes =
    resolved.rows.length === 0
      ? [empty, ...optional(resolved.freshness)]
      : [...optional(resolved.freshness), ...resolved.notes];
  return {
    ...component,
    rows: resolved.rows,
    description: notes.length === 0 ? undefined : { text: notes.join('; ') },
  };
}

function rowsResolution(
  binding: Extract<PtahUiBinding, { readonly kind: 'rows' }>,
  context: ResolveContext,
): RowsResolution {
  switch (binding.source) {
    case 'agents':
      return agentsRows(agentsView(context, binding.scope), binding.columns);
    case 'limits':
      return limitsRows(context.live.limits, binding.columns);
    case 'diff':
      return diffRows(context.snapshot, binding.columns);
    case 'tests':
      return testRows(context.snapshot, binding.columns);
    case 'usage':
      // The registry gives `usage` no columns, so the parser rejects its rows.
      return 'unavailable';
  }
}

function diffRows(
  snapshot: TurnSourceSnapshot | null,
  columns: readonly string[],
): RowsResolution {
  const source = snapshot === null ? null : snapshot.diff;
  if (source === null || source.kind !== 'available')
    return source?.kind ?? 'unavailable';
  const { changeSet } = source;
  const rows = changeSet.files
    .slice(0, SURFACE_LIMITS.maxTableRows)
    .map((file) =>
      columns.map((column) => {
        if (column === 'path') return clampHostValue(file.path);
        if (column === 'status') return clampHostValue(file.status);
        if (column === 'additions')
          return file.binary ? 'binary' : (file.additions ?? 'unknown');
        if (column === 'deletions')
          return file.binary ? 'binary' : (file.deletions ?? 'unknown');
        return 'unavailable';
      }),
    );
  const notes: string[] = [];
  const moreRows =
    changeSet.truncatedCount + changeSet.files.length - rows.length;
  if (moreRows > 0) notes.push(`+${moreRows} more`);
  if (changeSet.baselineMissing) notes.push('may include earlier changes');
  return { rows, listItems: rows.map(firstCellText), notes };
}

function testRows(
  snapshot: TurnSourceSnapshot | null,
  columns: readonly string[],
): RowsResolution {
  const source = snapshot === null ? null : snapshot.tests;
  if (source === null || source.kind !== 'available')
    return source?.kind ?? 'unavailable';
  const rows = source.runs
    .slice(0, SURFACE_LIMITS.maxTableRows)
    .map((run) =>
      columns.map((column) =>
        column === 'command'
          ? clampHostValue(run.command)
          : column === 'outcome'
            ? clampHostValue(run.outcome)
            : 'unavailable',
      ),
    );
  const omittedRows = source.runs.length - rows.length;
  return {
    rows,
    listItems: rows.map(firstCellText),
    notes: omittedRows > 0 ? [`+${omittedRows} more`] : [],
  };
}

/** `$agents` rows come capped and ordered from the agents module (R5.11). */
function agentsRows(
  view: PtahUiAgentsView,
  columns: readonly string[],
): RowsResolution {
  if (view.kind === 'unavailable') return 'unavailable';
  const rows = agentsRowValues(view.rows, columns).map((row) =>
    row.map(clampHostValue),
  );
  return {
    rows,
    listItems: rows.map(firstCellText),
    notes: view.omittedRows > 0 ? [`+${view.omittedRows} more`] : [],
  };
}

/**
 * `$limits` rows keep the list's order; the table shows the first
 * `maxTableRows` rows and notes the rest as "+N more".
 *
 * `list $limits` lists each lane once, in the order it first appears across
 * every row, not only the rows the table shows. The list renders no notes, so
 * when there are more lanes than `maxTableRows` it lists the first
 * `maxTableRows - 1` and ends with a "+N more" item for the lanes left out.
 */
function limitsRows(
  limits: PtahUiLimitsInput | null | undefined,
  columns: readonly string[],
): RowsResolution {
  if (limits === null || limits === undefined) return 'unavailable';
  if (limits.kind !== 'available') return limits.kind;
  const shown = limits.rows.slice(0, SURFACE_LIMITS.maxTableRows);
  const rows = shown.map((row) =>
    columns.map((column) => clampHostValue(limitCell(row, column))),
  );
  const omittedRows = limits.rows.length - shown.length;
  return {
    rows,
    listItems: laneListItems(limits.rows),
    notes: omittedRows > 0 ? [`+${omittedRows} more`] : [],
    freshness: `as of ${clockTime(limits.asOf)}`,
  };
}

function laneListItems(rows: readonly PtahUiLimitRow[]): string[] {
  const lanes = [...new Set(rows.map((row) => row.lane))];
  const cap = SURFACE_LIMITS.maxTableRows;
  const listed = lanes.length <= cap ? lanes : lanes.slice(0, cap - 1);
  const items = listed.map((lane) => String(clampHostValue(lane)));
  const omittedLanes = lanes.length - listed.length;
  return omittedLanes > 0 ? [...items, `+${omittedLanes} more`] : items;
}

function optional(value: string | undefined): readonly string[] {
  return value === undefined ? [] : [value];
}

function limitCell(row: PtahUiLimitRow, column: string): string {
  switch (column) {
    case 'lane':
      return row.lane;
    case 'window':
      return row.window;
    case 'used':
      return row.used;
    case 'state':
      return row.state;
    case 'reset':
      return row.reset;
    default:
      return 'unavailable';
  }
}

/** Local wall-clock `HH:MM` of an epoch-millisecond time; "unknown" if invalid. */
function clockTime(epochMs: number): string {
  const date = new Date(epochMs);
  if (!Number.isFinite(date.getTime())) return 'unknown';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function firstCellText(row: readonly (string | number | null)[]): string {
  return String(row[0] ?? 'unavailable');
}

function statusRow(
  columnCount: number,
  status: 'pending' | 'unavailable',
): readonly string[] {
  return Array.from({ length: columnCount }, () => status);
}

function statusList(id: string, text: string): SurfaceComponent {
  return { kind: 'list', id, items: [{ text: { text } }] };
}

function clampHostValue(value: string | number): string | number {
  if (
    typeof value !== 'string' ||
    value.length <= SURFACE_LIMITS.maxStringLength
  )
    return value;
  return `${value.slice(0, SURFACE_LIMITS.maxStringLength - 1)}…`;
}

function emptyMessage(
  source: PtahUiSourceName,
  scope: PtahUiSourceScope | undefined,
): string {
  switch (source) {
    case 'diff':
      return 'No files changed this turn';
    case 'tests':
      return 'No tests ran this turn';
    case 'agents':
      return scope === 'session'
        ? 'No agents in this session'
        : 'No agents this turn';
    case 'limits':
      return 'No CLI lanes';
    case 'usage':
      return 'No rows available';
  }
}
