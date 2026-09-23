import type {
  DashboardComponent,
  DashboardTableCell,
} from './dashboard-spec.types';
import { checkSurfaceSelection } from './surface-patch';
import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceSelection,
} from './surface.types';

/** Cap every source string before quoting; numeric and boolean cells stay typed. */
function bounded(
  value: DashboardTableCell | undefined,
): DashboardTableCell | undefined {
  return typeof value === 'string' ? value.slice(0, 200) : value;
}

function quoted(value: DashboardTableCell | undefined): string {
  return (JSON.stringify(bounded(value)) ?? 'null')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/** 494 D4: resolve identifiers and indexes against the host copy, never UI text. */
export function describeSurfaceSelection(
  content: SurfaceContent,
  selection: SurfaceSelection | null,
): string | null {
  if (selection === null || !checkSurfaceSelection(content, selection).ok)
    return null;
  const stack: (SurfaceComponent | DashboardComponent)[] = [
    ...(content.contract === 'dashboard-spec/2'
      ? content.surface.components
      : content.spec.components),
  ];
  let component: SurfaceComponent | DashboardComponent | undefined;
  while (stack.length > 0) {
    const candidate = stack.pop();
    if (candidate === undefined) break;
    if (candidate.id === selection.componentId) {
      component = candidate;
      break;
    }
    if ('children' in candidate && candidate.children)
      stack.push(...candidate.children);
  }
  if (component === undefined) return null;
  const title = 'title' in component ? component.title?.text : undefined;
  const lines = [
    `Component: ${quoted(component.id)}`,
    `Kind: ${quoted(component.kind)}`,
    `Title: ${quoted(title ?? component.id)}`,
  ];
  const target = selection.target;
  if (component.kind === 'stat' && target.kind === 'stat') {
    lines.push(
      `Label: ${quoted(title ?? component.id)}`,
      `Value: ${quoted(component.value)}`,
    );
    if (component.unit !== undefined)
      lines.push(`Unit: ${quoted(component.unit)}`);
  } else if (component.kind === 'table' && target.kind === 'table-row') {
    const row = component.rows?.[target.rowIndex];
    if (row === undefined) return null;
    lines.push(`Row: ${target.rowIndex}`);
    row.slice(0, 50).forEach((cell, index) => {
      const column = component.columns[index];
      lines.push(
        `${quoted(column?.label.text ?? column?.key ?? String(index))}: ${quoted(cell)}`,
      );
    });
  } else if (component.kind === 'list' && target.kind === 'list-item') {
    const item = component.items?.[target.itemIndex];
    if (item === undefined) return null;
    lines.push(`Text: ${quoted(item.text.text)}`);
    if (item.detail !== undefined)
      lines.push(`Detail: ${quoted(item.detail.text)}`);
  } else if (
    (component.kind === 'line-chart' || component.kind === 'bar-chart') &&
    target.kind === 'chart-point'
  ) {
    const series = component.series?.[target.seriesIndex];
    const point = series?.points[target.pointIndex];
    if (series === undefined || point === undefined) return null;
    lines.push(
      `Series: ${quoted(series.name)}`,
      `X: ${quoted(point.x)}`,
      `Y: ${quoted(point.y)}`,
    );
  } else return null;
  return lines.join('\n');
}
