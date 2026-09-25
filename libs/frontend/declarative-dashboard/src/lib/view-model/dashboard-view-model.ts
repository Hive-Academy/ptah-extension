import type {
  DashboardComponent,
  DashboardSpecEnvelope,
} from '@ptah-extension/shared';
import { DASHBOARD_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts';
import type { SurfaceComponent } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { DashboardViewModel, DisplayNode } from './view-model.types';

type DisplayComponent =
  | DashboardComponent
  | Extract<SurfaceComponent, { kind: DashboardComponent['kind'] }>;

/** Shared by v1 and v2. Text remains literal contract text, never HTML. */
export function mapDisplayNode(
  component: DisplayComponent,
  children?: readonly DisplayNode[],
): DisplayNode {
  if (!component || typeof component.id !== 'string') {
    throw new TypeError('Invalid dashboard component.');
  }
  if (component.actions !== undefined && !Array.isArray(component.actions)) {
    throw new TypeError('Invalid dashboard actions.');
  }
  const selectable =
    component.actions?.some(
      (action) => action?.action === 'dashboard.select',
    ) ?? false;
  // Copy only catalog fields; never leak the source's unbounded children.
  const common = {
    id: component.id,
    title: component.title,
    description: component.description,
    actions: component.actions,
    selectable,
    ...(children === undefined ? {} : { children }),
  };
  switch (component.kind) {
    case 'stat':
      if (
        typeof component.value !== 'string' &&
        typeof component.value !== 'number'
      ) {
        throw new TypeError('Invalid dashboard stat value.');
      }
      return {
        ...common,
        kind: component.kind,
        value: component.value,
        unit: component.unit,
        delta: component.delta,
      };
    case 'table':
      if (!Array.isArray(component.columns))
        throw new TypeError('Invalid dashboard columns.');
      return {
        ...common,
        kind: component.kind,
        columns: component.columns,
        rows: component.rows,
        data: component.data,
      };
    case 'list':
      return {
        ...common,
        kind: component.kind,
        ordered: component.ordered,
        items: component.items,
        data: component.data,
      };
    case 'line-chart':
    case 'bar-chart':
      return {
        ...common,
        kind: component.kind,
        xLabel: component.xLabel,
        yLabel: component.yLabel,
        series: component.series,
        data: component.data,
      };
    default:
      throw new TypeError('Unknown dashboard component kind.');
  }
}

/** Pure projection of accepted v1 content. Root depth is 1, as in the validator.
 * Defensive shape failures throw for the renderer's renderFailed fallback;
 * excess descendants are omitted without visiting them (including cycles).
 */
export function buildDashboardViewModel(
  spec: DashboardSpecEnvelope,
): DashboardViewModel {
  if (
    !spec ||
    spec.schemaVersion !== 'dashboard-spec/1' ||
    spec.catalogVersion !== 'dashboard-catalog/1' ||
    typeof spec.title?.text !== 'string' ||
    !Array.isArray(spec.components)
  ) {
    throw new TypeError('Invalid dashboard envelope.');
  }

  const mapComponents = (
    components: readonly DashboardComponent[],
    depth: number,
  ): readonly DisplayNode[] =>
    components.map((component) => {
      if (
        !component ||
        (component.children !== undefined && !Array.isArray(component.children))
      ) {
        throw new TypeError('Invalid dashboard children.');
      }
      const children =
        component.children === undefined
          ? undefined
          : depth < DASHBOARD_LIMITS.maxTreeDepth
            ? mapComponents(component.children, depth + 1)
            : [];
      return mapDisplayNode(component, children);
    });

  return {
    title: spec.title,
    description: spec.description,
    components: mapComponents(spec.components, 1),
  };
}
