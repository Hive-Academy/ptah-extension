import type { DashboardSeriesPoint } from '@ptah-extension/shared';
import {
  checkDraftValue,
  readSurfacePath,
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
  SurfaceNode,
  SurfaceViewModel,
} from './view-model.types';

/** A failed build renders nothing; the renderer reports `renderFailed`. */
export type SurfaceViewModelBuild =
  | { readonly renderFailed: false; readonly viewModel: SurfaceViewModel }
  | { readonly renderFailed: true; readonly reason: string; readonly viewModel: null };

type LayoutComponent = Extract<SurfaceComponent, { kind: LayoutNode['kind'] }>;
type DisplayComponent = Exclude<SurfaceComponent, LayoutComponent | SurfaceInput>;

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

function buildSurface(content: Extract<SurfaceRenderable, { contract: 'dashboard-spec/2' }>): SurfaceViewModel {
  const { surface, dataModel } = content;
  if (
    !isObject(surface) ||
    surface.schemaVersion !== 'dashboard-spec/2' ||
    surface.catalogVersion !== 'dashboard-catalog/2' ||
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
    const viewModel = renderable.contract === 'dashboard-spec/1'
      ? buildDashboardViewModel(renderable.spec)
      : renderable.contract === 'dashboard-spec/2'
        ? buildSurface(renderable)
        : null;
    if (viewModel === null) throw new TypeError('Unknown surface contract.');
    return { renderFailed: false, viewModel };
  } catch (error: unknown) {
    // Our own shape checks throw TypeError with fixed text; anything else is not echoed.
    return { renderFailed: true, reason: error instanceof TypeError ? error.message : BUILD_FAILED, viewModel: null };
  }
}
