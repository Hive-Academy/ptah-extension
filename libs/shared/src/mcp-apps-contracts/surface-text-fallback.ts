/** Plain-text presentation of the validated host state, including current drafts. */
import {
  renderChart,
  renderDashboardSpecText,
  renderList,
  renderStat,
  renderTable,
} from './dashboard-text-fallback';
import {
  isSurfaceInputComponent,
  isSurfaceLayoutComponent,
  visitSurfaceComponents,
} from './surface-bindings';
import { SURFACE_LIMITS } from './surface-catalog';
import { readSurfacePath } from './surface-data-model';
import type { SurfaceComponent, SurfaceStateView } from './surface.types';

function renderDisplay(component: SurfaceComponent): string {
  switch (component.kind) {
    case 'stat':
      return renderStat(component) ?? '';
    case 'table':
      return renderTable(component);
    case 'list':
      return renderList(component);
    case 'line-chart':
    case 'bar-chart':
      return renderChart(component);
    default:
      return '';
  }
}

/** v1 delegates unchanged; v2 reads input values from the host's data model. */
export function renderSurfaceText(view: SurfaceStateView): string {
  const content = view.content;
  if (content.contract === 'dashboard-spec/1')
    return renderDashboardSpecText(content.spec);
  const lines = [content.surface.title.text.trim()];
  const description = content.surface.description?.text.trim();
  if (description) lines.push(description);
  visitSurfaceComponents(content.surface.components, (component, depth) => {
    const indent = '  '.repeat(depth - 1);
    let text: string;
    if (isSurfaceLayoutComponent(component)) {
      const title = 'title' in component ? component.title?.text.trim() : '';
      text = title || component.id;
      if ('description' in component && component.description?.text.trim())
        text += `\n  ${component.description.text.trim()}`;
    } else if (isSurfaceInputComponent(component)) {
      const read = readSurfacePath(
        content.dataModel,
        component.path,
        component.kind,
      );
      // A failed path read and nothing to show deliberately share [unavailable].
      const value =
        read.ok && read.value !== undefined
          ? typeof read.value === 'string'
            ? read.value
                .replace(/\u2028/g, '\\u2028')
                .replace(/\u2029/g, '\\u2029')
            : JSON.stringify(read.value)
          : '[unavailable]';
      text = `${component.label}: ${value}${component.hints?.required ? ' [required]' : ''}`;
      if (component.kind === 'select' || component.kind === 'radio-group')
        for (const option of component.options)
          text += `\n  - ${option.label}: ${option.value}`;
    } else {
      text = renderDisplay(component);
    }
    lines.push(
      text
        .split('\n')
        .map((line) => indent + line)
        .join('\n'),
    );
  });
  lines.push(`surface ${view.surfaceId} revision ${view.revision}`);
  return lines.join('\n');
}

/** Generate tool-description budgets from the same constants as validation. */
export function describeSurfaceLimits(): string {
  return Object.entries(SURFACE_LIMITS)
    .map(
      ([name, value]) =>
        `${name} ${value}${name.endsWith('Bytes') ? ' UTF-8 bytes' : ''}`,
    )
    .join(', ');
}
