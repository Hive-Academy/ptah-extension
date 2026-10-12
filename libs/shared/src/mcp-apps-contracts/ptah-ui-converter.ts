import type {
  SurfaceAlertComponent,
  SurfaceBadgeComponent,
  SurfaceComponent,
  SurfaceEnvelope,
  SurfaceStatComponent,
} from './surface.types';
import {
  SURFACE_CATALOG_VERSION_4,
  SURFACE_SCHEMA_VERSION,
} from './surface-catalog';
import { PTAH_UI_SOURCES } from './ptah-ui-parser';
import type {
  PtahUiContainerElement,
  PtahUiDocument,
  PtahUiElement,
  PtahUiNode,
  PtahUiNoteTone,
  PtahUiScalar,
  PtahUiSourceName,
  PtahUiSourceScope,
  PtahUiStatItem,
  PtahUiTone,
} from './ptah-ui.types';

export type PtahUiBinding =
  | {
      readonly kind: 'scalar';
      readonly componentId: string;
      readonly source: PtahUiSourceName;
      readonly field: string;
      /** Present only on `$agents.session.<scalar>` (R5.11). */
      readonly scope?: PtahUiSourceScope;
    }
  | {
      readonly kind: 'rows';
      readonly componentId: string;
      readonly source: PtahUiSourceName;
      readonly columns: readonly string[];
      /** Present only on `table|list $agents session` (R5.11). */
      readonly scope?: PtahUiSourceScope;
    };

/** A display-only surface plus the host values it still needs. */
export interface PtahUiConversion {
  readonly envelope: SurfaceEnvelope;
  readonly bindings: readonly PtahUiBinding[];
}

/**
 * Converts parsed ptah-ui grammar to a display-only `dashboard-catalog/4`
 * surface. Depth-0 ids stay positional (`c${n}`, a statline expanding to one
 * stat each), so a 610 block converts to the same components; the children of
 * a container with id `P` are `${P}.${i}`.
 */
export function convertPtahUi(
  doc: PtahUiDocument,
  surfaceId: string,
): PtahUiConversion {
  const bindings: PtahUiBinding[] = [];
  return {
    envelope: {
      schemaVersion: SURFACE_SCHEMA_VERSION,
      catalogVersion: SURFACE_CATALOG_VERSION_4,
      surfaceId,
      title: { text: doc.title ?? '' },
      components: convertItems(doc.elements, (index) => `c${index}`, bindings),
    },
    bindings,
  };
}

/** Converts sibling items; `idAt` names the n-th emitted component. */
function convertItems(
  items: readonly PtahUiNode[],
  idAt: (index: number) => string,
  bindings: PtahUiBinding[],
): SurfaceComponent[] {
  const components: SurfaceComponent[] = [];
  for (const item of items) {
    if (item.kind === 'stats') {
      for (const stat of item.items)
        components.push(convertStat(stat, idAt(components.length), bindings));
      continue;
    }
    components.push(convertItem(item, idAt(components.length), bindings));
  }
  return components;
}

function convertItem(
  item: Exclude<PtahUiNode, { readonly kind: 'stats' }>,
  id: string,
  bindings: PtahUiBinding[],
): SurfaceComponent {
  switch (item.kind) {
    case 'row':
    case 'col':
    case 'grid':
    case 'card':
    case 'section':
    case 'accordion':
      return convertContainer(item, id, bindings);
    default:
      return convertElement(item, id, bindings);
  }
}

function convertContainer(
  container: PtahUiContainerElement,
  id: string,
  bindings: PtahUiBinding[],
): SurfaceComponent {
  const children = convertItems(
    container.children,
    (index) => `${id}.${index}`,
    bindings,
  );
  switch (container.kind) {
    case 'row':
    case 'col':
      return {
        kind: 'stack',
        id,
        direction: container.kind === 'row' ? 'horizontal' : 'vertical',
        children,
      };
    case 'grid':
      return { kind: 'grid', id, columns: container.columns, children };
    case 'card':
      return container.title === undefined
        ? { kind: 'card', id, children }
        : { kind: 'card', id, title: { text: container.title }, children };
    case 'section':
    case 'accordion':
      return {
        kind: container.kind,
        id,
        title: { text: container.title },
        children,
      };
  }
}

function convertElement(
  element: Exclude<PtahUiElement, { readonly kind: 'stats' }>,
  id: string,
  bindings: PtahUiBinding[],
): SurfaceComponent {
  switch (element.kind) {
    case 'table':
      if ('source' in element) {
        const columns = element.columns ?? sourceColumns(element.source);
        bindings.push(rowsBinding(id, element.source, columns, element.scope));
        return table(id, columns, []);
      }
      return table(id, element.columns, element.rows);
    case 'list':
      if ('source' in element) {
        bindings.push(
          rowsBinding(
            id,
            element.source,
            sourceColumns(element.source),
            element.scope,
          ),
        );
        return { kind: 'list', id, items: [] };
      }
      return {
        kind: 'list',
        id,
        items: element.items.map((text) => ({ text: { text } })),
      };
    case 'chart':
      return {
        kind: element.chart === 'line' ? 'line-chart' : 'bar-chart',
        id,
        title: { text: element.title },
        series: [
          {
            name: element.title,
            points: element.points.map((point) => ({
              x: point.label,
              y: point.value,
            })),
          },
        ],
      };
    case 'note':
      return {
        kind: 'alert',
        id,
        tone: NOTE_TONES[element.tone],
        text: { text: element.text },
      };
    case 'badge':
      return {
        kind: 'badge',
        id,
        tone: ATOM_TONES[element.tone],
        text: { text: element.text },
      };
    case 'progress':
      return {
        kind: 'progress',
        id,
        value: element.value,
        tone: ATOM_TONES[element.tone ?? 'neutral'],
        label: { text: element.label },
      };
    case 'avatar':
      return element.subtitle === undefined
        ? { kind: 'avatar', id, name: element.name }
        : {
            kind: 'avatar',
            id,
            name: element.name,
            subtitle: element.subtitle,
          };
  }
}

/** R4 mapping: `note` tones onto the `alert` vocabulary. */
const NOTE_TONES: Readonly<
  Record<PtahUiNoteTone, SurfaceAlertComponent['tone']>
> = { info: 'info', ok: 'success', warn: 'warning', error: 'error' };

/** R4 mapping: `badge` and `progress` tones onto the catalog vocabulary. */
const ATOM_TONES: Readonly<Record<PtahUiTone, SurfaceBadgeComponent['tone']>> =
  {
    neutral: 'neutral',
    info: 'info',
    ok: 'success',
    warn: 'warning',
    error: 'error',
  };

function convertStat(
  item: PtahUiStatItem,
  id: string,
  bindings: PtahUiBinding[],
): SurfaceComponent {
  const stat: SurfaceStatComponent = {
    kind: 'stat',
    id,
    title: { text: item.label },
    value: convertStatValue(item.value, id, bindings),
  };
  const trend =
    item.trend === undefined
      ? undefined
      : {
          direction: item.trend.direction,
          amount: item.trend.amount,
          percent: item.trend.percent,
          ...(item.trend.polarity === undefined
            ? {}
            : { polarity: item.trend.polarity }),
        };
  return {
    ...stat,
    ...(trend === undefined ? {} : { trend }),
    ...(item.spark === undefined ? {} : { spark: [...item.spark] }),
  };
}

function convertStatValue(
  value: string | PtahUiScalar,
  componentId: string,
  bindings: PtahUiBinding[],
): string {
  if (typeof value === 'string') return value;
  bindings.push({
    kind: 'scalar',
    componentId,
    source: value.source,
    field: value.field,
    ...(value.scope === undefined ? {} : { scope: value.scope }),
  });
  return value.scope === undefined
    ? `$${value.source}.${value.field}`
    : `$${value.source}.${value.scope}.${value.field}`;
}

function rowsBinding(
  componentId: string,
  source: PtahUiSourceName,
  columns: readonly string[],
  scope: PtahUiSourceScope | undefined,
): PtahUiBinding {
  return {
    kind: 'rows',
    componentId,
    source,
    columns,
    ...(scope === undefined ? {} : { scope }),
  };
}

function table(
  id: string,
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): SurfaceComponent {
  return {
    kind: 'table',
    id,
    columns: columns.map((label, index) => ({
      key: `c${index}`,
      label: { text: label },
    })),
    rows,
  };
}

function sourceColumns(source: PtahUiSourceName): readonly string[] {
  return PTAH_UI_SOURCES[source].columns;
}
