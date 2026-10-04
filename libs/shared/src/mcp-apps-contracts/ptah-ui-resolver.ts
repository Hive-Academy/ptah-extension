import { formatDurationMs, formatUsdCost } from '../lib/utils/usage-format.utils';
import type { TurnSourceSnapshot } from '../lib/utils/turn-sources.utils';

import type { SurfaceComponent, SurfaceContent, SurfaceEnvelope } from './surface.types';
import type { PtahUiBinding, PtahUiConversion } from './ptah-ui-converter';
import type { PtahUiSourceName } from './ptah-ui.types';

export type ResolvedPtahUiContent = Extract<SurfaceContent, { readonly contract: 'dashboard-spec/2' }>;

/** Resolves host-owned turn data into a fully literal renderable surface. */
export function resolvePtahUi(
  conversion: PtahUiConversion,
  snapshot: TurnSourceSnapshot | null,
): ResolvedPtahUiContent {
  const components = conversion.envelope.components.map((component) => resolveComponent(component, conversion.bindings, snapshot));
  const surface: Omit<SurfaceEnvelope, 'dataModel'> = { ...conversion.envelope, components };
  return { contract: 'dashboard-spec/2', surface, dataModel: {} };
}

function resolveComponent(
  component: SurfaceComponent,
  bindings: readonly PtahUiBinding[],
  snapshot: TurnSourceSnapshot | null,
): SurfaceComponent {
  const binding = bindings.find((candidate) => candidate.componentId === component.id);
  if (binding === undefined) return component;
  if (binding.kind === 'scalar' && component.kind === 'stat') {
    return { ...component, value: scalarValue(binding, snapshot) };
  }
  if (binding.kind === 'rows') return resolveRows(component, binding, snapshot);
  return component;
}

function scalarValue(binding: Extract<PtahUiBinding, { readonly kind: 'scalar' }>, snapshot: TurnSourceSnapshot | null): string | number {
  switch (binding.source) {
    case 'diff': {
      const source = snapshot === null ? null : snapshot.diff;
      if (source === null || source.kind !== 'available') return source?.kind ?? 'unavailable';
      if (source.changeSet.countsUnavailable) return 'unavailable';
      switch (binding.field) {
        case 'files': return source.changeSet.totals.files;
        case 'additions': return source.changeSet.totals.additions;
        case 'deletions': return source.changeSet.totals.deletions;
        default: return 'unavailable';
      }
    }
    case 'tests': {
      const source = snapshot === null ? null : snapshot.tests;
      if (source === null || source.kind !== 'available') return source?.kind ?? 'unavailable';
      switch (binding.field) {
        case 'total': return source.summary.total;
        case 'passed': return source.summary.passed;
        case 'failed': return source.summary.failed;
        case 'unknown': return source.summary.unknown;
        default: return 'unavailable';
      }
    }
    case 'usage': {
      const source = snapshot === null ? null : snapshot.usage;
      if (source === null || source.kind !== 'available') return source?.kind ?? 'unavailable';
      switch (binding.field) {
        case 'cost': return formatUsdCost(source.cost) ?? 'unavailable';
        case 'duration': return formatDurationMs(source.durationMs);
        case 'input': return source.input;
        case 'output': return source.output;
        default: return 'unavailable';
      }
    }
  }
}

function resolveRows(
  component: SurfaceComponent,
  binding: Extract<PtahUiBinding, { readonly kind: 'rows' }>,
  snapshot: TurnSourceSnapshot | null,
): SurfaceComponent {
  const source = rowsSource(snapshot, binding.source);
  if (component.kind === 'list') {
    if (source === 'pending' || source === 'unavailable') return { ...component, items: [{ text: { text: source } }] };
    const rows = rowValues(binding.source, source, binding.columns);
    return { ...component, items: rows.length === 0 ? [{ text: { text: emptyMessage(binding.source) } }] : rows.map(([text]) => ({ text: { text: String(text) } })) };
  }
  if (component.kind !== 'table') return component;
  if (source === 'pending' || source === 'unavailable') {
    // Req 3.2-3.4 requires a visible status while retaining the table's declared shape.
    return { ...component, rows: [statusRow(component.columns.length, source)] };
  }
  const rows = rowValues(binding.source, source, binding.columns);
  return { ...component, rows, description: rows.length === 0 ? { text: emptyMessage(binding.source) } : sourceDescription(binding.source, source) };
}

function statusRow(columnCount: number, status: 'pending' | 'unavailable'): readonly string[] {
  return [status, ...Array.from({ length: Math.max(0, columnCount - 1) }, () => '')];
}

function rowsSource(snapshot: TurnSourceSnapshot | null, name: PtahUiSourceName): TurnSourceSnapshot['diff'] | TurnSourceSnapshot['tests'] | TurnSourceSnapshot['usage'] | 'pending' | 'unavailable' {
  if (snapshot === null || !Object.hasOwn(snapshot, name)) return 'unavailable';
  const source = snapshot[name];
  return source.kind === 'available' ? source : source.kind;
}

function rowValues(source: PtahUiSourceName, value: Exclude<ReturnType<typeof rowsSource>, 'pending' | 'unavailable'>, columns: readonly string[]): readonly (readonly (string | number | null)[])[] {
  if (source === 'diff' && 'changeSet' in value) return value.changeSet.files.map((file) => columns.map((column) => {
    if (column === 'path') return file.path;
    if (column === 'status') return file.status;
    if (column === 'additions') return file.binary ? 'binary' : file.additions ?? 'unknown';
    if (column === 'deletions') return file.binary ? 'binary' : file.deletions ?? 'unknown';
    return 'unavailable';
  }));
  if (source === 'tests' && 'runs' in value) return value.runs.map((run) => columns.map((column) => column === 'command' ? run.command : column === 'outcome' ? run.outcome : 'unavailable'));
  return [];
}

function sourceDescription(source: PtahUiSourceName, value: Exclude<ReturnType<typeof rowsSource>, 'pending' | 'unavailable'>): { readonly text: string } | undefined {
  if (source !== 'diff' || !('changeSet' in value)) return undefined;
  const notes: string[] = [];
  if (value.changeSet.truncatedCount > 0) notes.push(`+${value.changeSet.truncatedCount} more`);
  if (value.changeSet.baselineMissing) notes.push('may include earlier changes');
  return notes.length === 0 ? undefined : { text: notes.join('; ') };
}

function emptyMessage(source: PtahUiSourceName): string {
  return source === 'diff' ? 'No files changed this turn' : source === 'tests' ? 'No tests ran this turn' : 'No rows available';
}
