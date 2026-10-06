import type { DashboardSeriesPoint } from '@ptah-extension/shared';
import {
  checkDraftValue,
  readSurfacePath,
  SURFACE_CATALOG_VERSION,
  SURFACE_INPUT_EMPTY_VALUES,
  SURFACE_LIMITS,
  type SurfaceAction,
  type SurfaceComponent,
  type SurfaceDataModel,
  type SurfaceDataValue,
  type SurfaceInput,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { SurfaceRenderable } from '../surface-view-state';
import { buildDashboardViewModel, mapDisplayNode } from './dashboard-view-model';
import type {
  InputNode,
  LayoutNode,
  StatusNode,
  SurfaceNode,
  SurfaceViewModel,
} from './view-model.types';

/** A failed build renders nothing; the renderer reports `renderFailed`. */
export type SurfaceViewModelBuild =
  | { readonly renderFailed: false; readonly viewModel: SurfaceViewModel }
  | { readonly renderFailed: true; readonly reason: string; readonly viewModel: null };

type LayoutComponent = Extract<SurfaceComponent, { kind: LayoutNode['kind'] }>;
type DisplayComponent = Exclude<SurfaceComponent, LayoutComponent | SurfaceInput>;
type StatusComponent = Extract<
  SurfaceComponent,
  { kind: 'alert' | 'badge' | 'progress' | 'radial-progress' | 'divider' | 'text-block' }
>;

const STATUS_TONES = ['neutral', 'primary', 'info', 'success', 'warning', 'error'] as const;
const ALERT_TONES = ['info', 'success', 'warning', 'error'] as const;
const DIVIDER_DIRECTIONS = ['horizontal', 'vertical'] as const;
const TEXT_BLOCK_ROLES = ['heading', 'body'] as const;

const BUILD_FAILED = 'Surface content could not be mapped.';

/** Deliberately not a type guard: a guard would narrow interface unions away. */
function isObject(value: unknown): boolean {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isRichText(value: unknown): boolean {
  return isObject(value) && typeof (value as { readonly text?: unknown }).text === 'string';
}

function actionsOf(component: { readonly actions?: readonly SurfaceAction[] }): readonly SurfaceAction[] {
  if (component.actions === undefined) return [];
  if (!Array.isArray(component.actions)) throw new TypeError('Invalid surface actions.');
  return component.actions;
}

/** Only `dashboard.select` makes a node selectable; no other action id is a control here. */
function declaresSelect(actions: readonly SurfaceAction[]): boolean {
  return actions.some((action) => isObject(action) && action.action === 'dashboard.select');
}

/** Only well-formed `surface.submit` actions can become buttons (Req 4.6). */
function submitActionsOf(actions: readonly SurfaceAction[]): readonly SurfaceAction[] {
  return actions.filter((action) => isObject(action) && action.action === 'surface.submit'
    && typeof action.id === 'string' && isRichText(action.label));
}

/**
 * Host value for an input. A read that fails, or a stored value of the wrong
 * type for the kind, falls back to the kind's empty value and a draft error.
 * A missing path is not a failure: the contract reads it as the empty value.
 */
function hostValueOf(input: SurfaceInput, dataModel: SurfaceDataModel): Pick<InputNode, 'hostValue' | 'draftError'> {
  const empty: SurfaceDataValue = SURFACE_INPUT_EMPTY_VALUES[input.kind];
  const read = readSurfacePath(dataModel, input.path, input.kind);
  if (!read.ok) return { hostValue: empty, draftError: read.reason };
  if (read.value === undefined) return { hostValue: empty };
  const check = checkDraftValue(input, read.value);
  return check.ok ? { hostValue: read.value } : { hostValue: empty, draftError: check.reason };
}

function mapInput(input: SurfaceInput, dataModel: SurfaceDataModel): InputNode {
  if (typeof input.label !== 'string' || typeof input.path !== 'string') {
    throw new TypeError('Invalid surface input.');
  }
  const common = { id: input.id, label: input.label, path: input.path, selectable: false, ...hostValueOf(input, dataModel) };
  switch (input.kind) {
    case 'text':
      return { ...common, kind: input.kind, description: input.description, placeholder: input.placeholder,
        multiline: input.multiline, hints: input.hints };
    case 'select':
    case 'radio-group':
      if (!Array.isArray(input.options) || !input.options.every((option) => isObject(option)
        && typeof option.value === 'string' && typeof option.label === 'string')) {
        throw new TypeError('Invalid surface input options.');
      }
      return { ...common, kind: input.kind, options: input.options, hints: input.hints };
    case 'checkbox':
      return { ...common, kind: input.kind, hints: input.hints };
  }
}

/** Tightens the shared display mapper for the shapes it does not check (list items, chart series). */
function checkDisplayShape(component: DisplayComponent): void {
  if (component.kind === 'list' && component.items !== undefined
    && (!Array.isArray(component.items) || !component.items.every((item) => isObject(item)))) {
    throw new TypeError('Invalid surface list items.');
  }
  if ((component.kind === 'line-chart' || component.kind === 'bar-chart') && component.series !== undefined
    && (!Array.isArray(component.series) || !component.series.every((series) => isObject(series)
      && typeof series.name === 'string' && Array.isArray(series.points)
      && series.points.every((point: DashboardSeriesPoint) => isObject(point) && typeof point.y === 'number'
        && (typeof point.x === 'string' || typeof point.x === 'number'))))) {
    throw new TypeError('Invalid surface chart series.');
  }
}

/**
 * v2-only projection of the six status kinds. It copies only declared
 * contract fields and rejects any hostile in-process shape, so a failure
 * yields the all-or-nothing `renderFailed`, never a partial node.
 */
function mapStatus(component: StatusComponent): StatusNode {
  switch (component.kind) {
    case 'alert': {
      if (!ALERT_TONES.includes(component.tone)) throw new TypeError('Invalid surface alert tone.');
      if (!isRichText(component.text)) throw new TypeError('Invalid surface alert text.');
      if (component.title !== undefined && !isRichText(component.title)) throw new TypeError('Invalid surface alert title.');
      return { id: component.id, kind: component.kind, tone: component.tone, text: component.text,
        title: component.title, selectable: false };
    }
    case 'badge': {
      if (!STATUS_TONES.includes(component.tone)) throw new TypeError('Invalid surface badge tone.');
      if (!isRichText(component.text)) throw new TypeError('Invalid surface badge text.');
      if (component.actions !== undefined && (!Array.isArray(component.actions)
        || !component.actions.every((action) => isObject(action) && action.action === 'dashboard.select'))) {
        throw new TypeError('Invalid surface badge actions.');
      }
      return { id: component.id, kind: component.kind, tone: component.tone, text: component.text,
        actions: component.actions, selectable: declaresSelect(component.actions ?? []) };
    }
    case 'progress':
    case 'radial-progress': {
      if (typeof component.value !== 'number' || !Number.isFinite(component.value)
        || component.value < 0 || component.value > 100) {
        throw new TypeError('Invalid surface progress value.');
      }
      if (!STATUS_TONES.includes(component.tone)) throw new TypeError('Invalid surface progress tone.');
      if (!isRichText(component.label)) throw new TypeError('Invalid surface progress label.');
      return { id: component.id, kind: component.kind, value: component.value, tone: component.tone,
        label: component.label, selectable: false };
    }
    case 'divider': {
      if (!DIVIDER_DIRECTIONS.includes(component.direction)) throw new TypeError('Invalid surface divider direction.');
      if (component.text !== undefined && !isRichText(component.text)) throw new TypeError('Invalid surface divider text.');
      return { id: component.id, kind: component.kind, direction: component.direction,
        text: component.text, selectable: false };
    }
    case 'text-block': {
      if (!isRichText(component.text)) throw new TypeError('Invalid surface text block text.');
      if (!TEXT_BLOCK_ROLES.includes(component.role)) throw new TypeError('Invalid surface text block role.');
      return { id: component.id, kind: component.kind, text: component.text, role: component.role,
        selectable: false };
    }
  }
}

function buildSurface(content: Extract<SurfaceRenderable, { contract: 'dashboard-spec/2' }>): SurfaceViewModel {
  const { surface, dataModel } = content;
  if (
    !isObject(surface) ||
    surface.schemaVersion !== 'dashboard-spec/2' ||
    surface.catalogVersion !== SURFACE_CATALOG_VERSION ||
    !isRichText(surface.title) ||
    !Array.isArray(surface.components) ||
    !isObject(dataModel)
  ) {
    throw new TypeError('Invalid surface envelope.');
  }
  let mapped = 0;

  function mapComponents(components: readonly SurfaceComponent[], depth: number): readonly SurfaceNode[] {
    return components.map((component) => {
      if (!isObject(component) || typeof component.id !== 'string' || typeof component.kind !== 'string') {
        throw new TypeError('Invalid surface component.');
      }
      // Validated content is bounded; this cap keeps a hostile in-process tree finite.
      if (++mapped > SURFACE_LIMITS.maxComponents) throw new TypeError('Surface exceeds maxComponents.');
      switch (component.kind) {
        case 'section':
        case 'stack':
        case 'grid':
        case 'card':
          return mapLayout(component, depth);
        case 'text':
        case 'select':
        case 'radio-group':
        case 'checkbox':
          return mapInput(component, dataModel);
        case 'alert':
        case 'badge':
        case 'progress':
        case 'radial-progress':
        case 'divider':
        case 'text-block':
          return mapStatus(component);
        default:
          checkDisplayShape(component);
          return mapDisplayNode(component);
      }
    });
  }

  function mapLayout(component: LayoutComponent, depth: number): LayoutNode {
    if (!Array.isArray(component.children)) throw new TypeError('Invalid surface children.');
    const actions = actionsOf(component);
    const children = depth < SURFACE_LIMITS.maxTreeDepth ? mapComponents(component.children, depth + 1) : [];
    const common = { id: component.id, actions: component.actions, children,
      submitActions: submitActionsOf(actions), selectable: declaresSelect(actions) };
    switch (component.kind) {
      case 'section':
        if (!isRichText(component.title)) throw new TypeError('Invalid surface section title.');
        return { ...common, kind: component.kind, title: component.title, description: component.description };
      case 'card':
        return { ...common, kind: component.kind, title: component.title, description: component.description };
      case 'stack':
        return { ...common, kind: component.kind, direction: component.direction, gap: component.gap };
      case 'grid':
        return { ...common, kind: component.kind, columns: component.columns, gap: component.gap };
    }
  }

  return {
    title: surface.title,
    description: surface.description,
    components: mapComponents(surface.components, 1),
  };
}

/**
 * Pure projection of accepted v1 or v2 content. It never throws: any shape
 * failure yields `renderFailed` with no view model, so nothing partial renders.
 */
export function buildSurfaceViewModel(renderable: SurfaceRenderable): SurfaceViewModelBuild {
  try {
    if (!isObject(renderable)) throw new TypeError('Invalid surface content.');
    if (renderable.contract === 'dashboard-spec/1') {
      return { renderFailed: false, viewModel: buildDashboardViewModel(renderable.spec) };
    }
    if (renderable.contract === 'dashboard-spec/2') {
      return { renderFailed: false, viewModel: buildSurface(renderable) };
    }
    throw new TypeError('Unknown surface contract.');
  } catch (error: unknown) {
    // Our own shape checks throw TypeError with fixed text; anything else is not echoed.
    return { renderFailed: true, reason: error instanceof TypeError ? error.message : BUILD_FAILED, viewModel: null };
  }
}
