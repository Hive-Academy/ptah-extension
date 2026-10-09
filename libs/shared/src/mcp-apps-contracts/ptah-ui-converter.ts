import type { SurfaceComponent, SurfaceEnvelope } from './surface.types';
import {
  SURFACE_CATALOG_VERSION,
  SURFACE_SCHEMA_VERSION,
} from './surface-catalog';
import { PTAH_UI_SOURCES } from './ptah-ui-parser';
import type {
  PtahUiDocument,
  PtahUiNode,
  PtahUiScalar,
  PtahUiSourceName,
} from './ptah-ui.types';

export type PtahUiBinding =
  | {
      readonly kind: 'scalar';
      readonly componentId: string;
      readonly source: PtahUiSourceName;
      readonly field: string;
    }
  | {
      readonly kind: 'rows';
      readonly componentId: string;
      readonly source: PtahUiSourceName;
      readonly columns: readonly string[];
    };

/** A display-only surface plus the host values it still needs. */
export interface PtahUiConversion {
  readonly envelope: SurfaceEnvelope;
  readonly bindings: readonly PtahUiBinding[];
}

/** Converts parsed ptah-ui grammar to a display-only v2 surface. */
export function convertPtahUi(
  doc: PtahUiDocument,
  surfaceId: string,
): PtahUiConversion {
  const bindings: PtahUiBinding[] = [];
  const components: SurfaceComponent[] = [];
  for (const element of doc.elements) {
    if (element.kind === 'stats') {
      for (const item of element.items) {
        if (item.trend !== undefined || item.spark !== undefined)
          throw notConvertible('stat trend and spark');
        const id = `c${components.length}`;
        components.push({
          kind: 'stat',
          id,
          title: { text: item.label },
          value: convertStatValue(item.value, id, bindings),
        });
      }
      continue;
    }
    components.push(convertElement(element, `c${components.length}`, bindings));
  }
  return {
    envelope: {
      schemaVersion: SURFACE_SCHEMA_VERSION,
      catalogVersion: SURFACE_CATALOG_VERSION,
      surfaceId,
      title: { text: doc.title ?? '' },
      components,
    },
    bindings,
  };
}

function convertElement(
  element: PtahUiNode,
  id: string,
  bindings: PtahUiBinding[],
): SurfaceComponent {
  switch (element.kind) {
    case 'stats':
      throw new Error('stats are expanded before conversion');
    case 'row':
    case 'col':
    case 'grid':
    case 'card':
    case 'section':
    case 'accordion':
    case 'note':
    case 'progress':
    case 'badge':
    case 'avatar':
      throw notConvertible(`\`${element.kind}\``);
    case 'table':
      if ('source' in element) {
        const columns = element.columns ?? sourceColumns(element.source);
        bindings.push({
          kind: 'rows',
          componentId: id,
          source: element.source,
          columns,
        });
        return table(id, columns, []);
      }
      return table(id, element.columns, element.rows);
    case 'list':
      if ('source' in element) {
        const columns = sourceColumns(element.source);
        bindings.push({
          kind: 'rows',
          componentId: id,
          source: element.source,
          columns,
        });
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
  }
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
  });
  return `$${value.source}.${value.field}`;
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

/**
 * The R3 nested grammar parses before this converter emits it: it still emits
 * the 610 flat dashboard-catalog/3 shape. A block using a construct it cannot
 * emit fails here, and `renderPtahUiBlock` turns the throw into the atomic
 * code-block fallback instead of a partial surface.
 */
function notConvertible(construct: string): Error {
  return new Error(
    `ptah-ui ${construct} is not convertible to ${SURFACE_CATALOG_VERSION}`,
  );
}

function sourceColumns(source: PtahUiSourceName): readonly string[] {
  return PTAH_UI_SOURCES[source].columns;
}
