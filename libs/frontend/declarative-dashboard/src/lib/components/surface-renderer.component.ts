import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  untracked,
} from '@angular/core';
import {
  checkDraftValue,
  type SurfaceDataValue,
  type SurfaceSelection,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceActionInvoke,
  SurfaceInputCommit,
  SurfaceInteractionState,
  SurfaceSelectionChange,
} from '../surface-interaction';
import type { SurfaceRenderable, SurfaceViewState } from '../surface-view-state';
import { buildSurfaceViewModel, type SurfaceViewModelBuild } from '../view-model/surface-view-model';
import type { InputNode, SurfaceNode, SurfaceViewModel } from '../view-model/view-model.types';
import { committedInputValue, plainText } from './surface-input-messages';
import { SURFACE_NODE_KINDS, SurfaceNodeComponent, type SurfaceComponentViewStateWrite } from './surface-node.component';
import type { SurfaceDraftWrite } from './surface-text-input.component';

/** Pure projection of accepted content into the view model the nodes render. */
export type SurfaceViewModelBuilder = (renderable: SurfaceRenderable) => SurfaceViewModelBuild;

/**
 * The renderer's view-model builder. Root default: the pure
 * `buildSurfaceViewModel`. An override that throws, or returns anything but a
 * successful build, is treated exactly like a `renderFailed` build.
 */
export const SURFACE_VIEW_MODEL_BUILDER = new InjectionToken<SurfaceViewModelBuilder>('SURFACE_VIEW_MODEL_BUILDER', {
  providedIn: 'root',
  factory: () => buildSurfaceViewModel,
});

const EMPTY_VIEW_STATE: SurfaceViewState = { components: {}, drafts: {} };
const NO_LOCAL_OVERLAYS: ReadonlyMap<string, SurfaceDataValue> = new Map();
const NO_INTERACTION: SurfaceInteractionState = {
  selection: null,
  selectionUnsynced: false,
  pendingValues: new Map(),
  issues: new Map(),
  actions: new Map(),
  submitDisabled: false,
};

/** One build attempt; a new object per renderable so each failure is reported once. */
interface BuildAttempt {
  readonly viewModel: SurfaceViewModel | null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function ownEntry<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;
}

const LAYOUT_KINDS: ReadonlySet<string> = new Set(['section', 'stack', 'grid', 'card']);
const CHOICE_KINDS: ReadonlySet<string> = new Set(['select', 'radio-group']);
const INPUT_KINDS: ReadonlySet<string> = new Set(['text', 'select', 'radio-group', 'checkbox']);

function isOption(value: unknown): boolean {
  return isObject(value) && typeof value['value'] === 'string' && typeof value['label'] === 'string';
}

/**
 * The fields the node and input components dereference without a guard: a
 * known kind, a string id, `selectable`; per layout, `children` and
 * `submitActions`; per input, `label`, `path`, a host value and, for a
 * choice, well-formed options; v1 display `children` when present. A node
 * that is its own ancestor is malformed too (the check would never end).
 */
function isRenderableNode(value: unknown, ancestors: Set<unknown>): boolean {
  if (!isObject(value) || ancestors.has(value)) return false;
  const kind = value['kind'];
  if (typeof kind !== 'string' || !SURFACE_NODE_KINDS.has(kind) || typeof value['id'] !== 'string'
    || typeof value['selectable'] !== 'boolean') return false;
  if (INPUT_KINDS.has(kind)) {
    if (typeof value['label'] !== 'string' || typeof value['path'] !== 'string' || value['hostValue'] === undefined) return false;
    const options = value['options'];
    return !CHOICE_KINDS.has(kind) || (Array.isArray(options) && options.every(isOption));
  }
  if (LAYOUT_KINDS.has(kind) && !Array.isArray(value['submitActions'])) return false;
  const children = value['children'];
  if (children === undefined && !LAYOUT_KINDS.has(kind)) return true;
  if (!Array.isArray(children)) return false;
  ancestors.add(value);
  const valid = children.every(child => isRenderableNode(child, ancestors));
  ancestors.delete(value);
  return valid;
}

/**
 * A successful build whose every node has a renderable shape, or null. Never
 * throws. A throwing builder, a failed build and a malformed node (possible
 * only through a `SURFACE_VIEW_MODEL_BUILDER` override) all report
 * `renderFailed` and render nothing (Req 3.6).
 */
function attemptBuild(builder: SurfaceViewModelBuilder, renderable: SurfaceRenderable): SurfaceViewModel | null {
  try {
    const result: unknown = builder(renderable);
    if (!isObject(result) || result['renderFailed'] !== false) return null;
    const viewModel = result['viewModel'];
    if (!isObject(viewModel)) return null;
    const components = viewModel['components'];
    const ancestors = new Set<unknown>();
    return Array.isArray(components) && components.every(node => isRenderableNode(node, ancestors))
      ? (viewModel as unknown as SurfaceViewModel)
      : null;
  } catch {
    // A throwing builder (or a throwing getter in its result) is a render failure.
    return null;
  }
}

function isInputNode(node: SurfaceNode): node is InputNode {
  return INPUT_KINDS.has(node.kind);
}

/** Draft id → the binding (kind and path) of the input it was typed into. */
type DraftBindings = ReadonlyMap<string, string>;

function bindingOf(node: InputNode): string {
  return `${node.kind}\u0000${node.path}`;
}

/** Input nodes in document order, recursing through layout children. */
function inputNodesOf(nodes: readonly SurfaceNode[], into: InputNode[] = []): InputNode[] {
  for (const node of nodes) {
    if (isInputNode(node)) into.push(node);
    else if ('children' in node && Array.isArray(node.children)) inputNodesOf(node.children, into);
  }
  return into;
}

function surfaceIdOf(renderable: SurfaceRenderable): string {
  if (!isObject(renderable)) return '';
  const id = renderable.contract === 'dashboard-spec/2' ? renderable.surface?.surfaceId : renderable.spec?.specId;
  return typeof id === 'string' ? id : '';
}

function sameSelection(left: SurfaceSelection | null, right: SurfaceSelection): boolean {
  if (left === null || left.componentId !== right.componentId || left.target.kind !== right.target.kind) return false;
  return JSON.stringify(left.target) === JSON.stringify(right.target);
}

/**
 * Renders accepted v1 or v2 content with Ptah components; no I/O, no markup.
 *
 * State ownership:
 * - `viewState` is the parent's copy and is authoritative. The renderer keeps
 *   a working copy that every draft and presentation write updates
 *   SYNCHRONOUSLY before it emits `viewStateChange`, so the next `drafts`
 *   object an input sees always holds its last write, whether or not the
 *   parent feeds it back. Every `viewState` object the parent passes, and a
 *   change of surface id, replaces the working copy: a reset, a restore of an
 *   object emitted earlier, or another surface's or workspace's state. The
 *   contract (B8 carry-over a): a parent that feeds the state back stores
 *   each emitted object synchronously, so it never passes an older one late.
 * - On `inputCommit` the renderer installs a local pending overlay for the
 *   input's path BEFORE it forwards the commit and before the draft is
 *   discarded, so the committed value stays shown. The overlay lasts until the
 *   parent passes a new `interaction` or `renderable`, which then decides:
 *   its own overlay, the host echo, or a rejection shown through
 *   `interaction.issues` for that component id (no silent revert).
 * - A draft belongs to the binding (kind and path) of the input it was typed
 *   into. Drafts of inputs that left the surface, or whose id now names
 *   another kind or path, are pruned and never committed.
 */
@Component({
  selector: 'ptah-surface-renderer',
  standalone: true,
  imports: [SurfaceNodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (viewModel(); as model) {
      <!-- Root stats flow as compact tiles, several across (prototype stats row); every other node takes a full row. -->
      <div class="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-x-2 gap-y-4 text-base-content" data-testid="surface-root">
        <header class="col-span-full flex flex-col gap-0.5">
          <h2 class="text-base font-semibold">{{ title() }}</h2>
          @if (description(); as description) { <p class="text-xs text-base-content-muted">{{ description }}</p> }
        </header>
        <!-- Position plus id: duplicate ids stay distinct, and a swapped id gets a fresh view. -->
        @for (node of model.components; track $index + ':' + node.id) {
          <ptah-surface-node [class.col-span-full]="node.kind !== 'stat'" [node]="node" [surfaceId]="surfaceId()" [componentStates]="state().components"
            [drafts]="state().drafts" [interaction]="effectiveInteraction()"
            (componentViewStateChange)="writeComponentState($event)" (selectionChange)="select($event)"
            (inputCommit)="commit($event)" (draftChange)="writeDraft($event)" (actionInvoke)="invoke($event)"
            (renderFailed)="renderFailed.emit()" />
        }
      </div>
    }
  `,
})
export class SurfaceRendererComponent {
  private readonly builder = inject(SURFACE_VIEW_MODEL_BUILDER);

  public readonly renderable = input.required<SurfaceRenderable>();
  public readonly viewState = input<SurfaceViewState>(EMPTY_VIEW_STATE);
  public readonly interaction = input<SurfaceInteractionState>(NO_INTERACTION);
  public readonly viewStateChange = output<SurfaceViewState>();
  public readonly selectionChange = output<SurfaceSelectionChange>();
  public readonly inputCommit = output<SurfaceInputCommit>();
  public readonly actionInvoke = output<SurfaceActionInvoke>();
  /** Build failure or an unknown node kind: nothing (or nothing more) renders. */
  public readonly renderFailed = output<void>();

  private readonly attempt = computed((): BuildAttempt => ({
    viewModel: attemptBuild(this.builder, this.renderable()),
  }));
  public readonly viewModel = computed(() => this.attempt().viewModel);
  public readonly title = computed(() => plainText(this.viewModel()?.title) ?? '');
  public readonly description = computed(() => plainText(this.viewModel()?.description));
  public readonly surfaceId = computed(() => surfaceIdOf(this.renderable()));

  /** The parent's copy, per surface: a surface switch re-adopts it even when the object is the same. */
  private readonly parentState = computed(() => ({ surfaceId: this.surfaceId(), viewState: this.viewState() }));
  /**
   * Working copy of `viewState`. Writes land here synchronously; whatever the
   * parent passes next replaces it. No object is ever refused as "stale": a
   * restore of an object emitted earlier is as authoritative as a new one.
   */
  public readonly state = linkedSignal(() => this.normalized(this.parentState().viewState));
  /**
   * Per `drafts` record (held weakly): the binding each draft was written
   * against. A record this renderer emitted carries it, so a restored record
   * is judged by the bindings it was typed against, on any surface.
   */
  private readonly draftBindings = new WeakMap<object, DraftBindings>();
  /** Path → committed value, installed on commit, reset by new host-derived inputs. */
  private readonly localOverlays = linkedSignal<ReadonlyMap<string, SurfaceDataValue>>(() => {
    this.interaction();
    this.renderable();
    return NO_LOCAL_OVERLAYS;
  });
  public readonly effectiveInteraction = computed((): SurfaceInteractionState => {
    const interaction = this.interaction();
    const local = this.localOverlays();
    if (local.size === 0) return interaction;
    const pendingValues = new Map(interaction.pendingValues);
    local.forEach((value, path) => pendingValues.set(path, value));
    return { ...interaction, pendingValues };
  });
  private readonly inputNodes = computed((): readonly InputNode[] => {
    const model = this.viewModel();
    return model === null ? [] : inputNodesOf(model.components);
  });
  /** First occurrence wins when ids repeat; a commit names only its component id. */
  private readonly inputsById = computed(() => {
    const byId = new Map<string, InputNode>();
    for (const node of this.inputNodes()) if (!byId.has(node.id)) byId.set(node.id, node);
    return byId;
  });

  public constructor() {
    effect(() => {
      if (this.attempt().viewModel === null) untracked(() => this.renderFailed.emit());
    });
    effect(() => {
      const inputs = this.inputsById();
      const drafts = this.state().drafts;
      if (this.viewModel() === null) return;
      untracked(() => this.pruneDrafts(inputs, drafts));
    });
  }

  /** Synchronous: the working copy holds the write before any input sees the next `drafts`. */
  public writeDraft(write: SurfaceDraftWrite): void {
    const current = this.state();
    const exists = ownEntry(current.drafts, write.componentId) !== undefined;
    if (write.value === undefined && !exists) {
      return;
    }
    if (write.value === undefined) {
      this.publish({ ...current, drafts: this.withoutDrafts(current.drafts, new Set([write.componentId])) });
      return;
    }
    const inputs = this.inputsById();
    const node = inputs.get(write.componentId);
    const bindings = new Map(this.bindingsOf(current.drafts, inputs));
    if (node === undefined) bindings.delete(write.componentId);
    else bindings.set(write.componentId, bindingOf(node));
    const drafts = { ...current.drafts, [write.componentId]: write.value };
    this.draftBindings.set(drafts, bindings);
    this.publish({ ...current, drafts });
  }

  public writeComponentState(write: SurfaceComponentViewStateWrite): void {
    const current = this.state();
    this.publish({ ...current, components: { ...current.components, [write.componentId]: write.state } });
  }

  /** The overlay goes in first, so the committed value never drops back to the host value. */
  public commit(commit: SurfaceInputCommit): void {
    const node = this.inputsById().get(commit.componentId);
    if (node !== undefined) this.localOverlays.update(overlays => new Map(overlays).set(node.path, commit.value));
    this.inputCommit.emit(commit);
  }

  /** Selecting the selected target again clears the selection. */
  public select(selection: SurfaceSelection): void {
    this.selectionChange.emit(sameSelection(this.interaction().selection, selection) ? null : selection);
  }

  /**
   * Submit flushes first: every valid draft is committed (overlay, then
   * `inputCommit`) and discarded, so the submit follows the values shown. An
   * invalid draft stays, with its error, and is never committed. A draft
   * whose binding changed is discarded, never committed.
   */
  public invoke(invoke: SurfaceActionInvoke): void {
    const inputs = this.inputsById();
    const drafts = this.state().drafts;
    const discarded = this.staleDraftIds(inputs, drafts);
    for (const node of inputs.values()) {
      const draft = ownEntry(drafts, node.id);
      if (draft === undefined || discarded.has(node.id) || !checkDraftValue(node, draft).ok) continue;
      if (!Object.is(draft, committedInputValue(node, this.effectiveInteraction().pendingValues))) {
        this.commit({ componentId: node.id, value: draft });
      }
      discarded.add(node.id);
    }
    if (discarded.size > 0) this.publish({ ...this.state(), drafts: this.withoutDrafts(this.state().drafts, discarded) });
    this.actionInvoke.emit(invoke);
  }

  private publish(next: SurfaceViewState): void {
    this.state.set(next);
    this.viewStateChange.emit(next);
  }

  /** Drops drafts whose input is gone, or whose id now names another kind or path. */
  private pruneDrafts(inputs: ReadonlyMap<string, InputNode>, drafts: SurfaceViewState['drafts']): void {
    const stale = this.staleDraftIds(inputs, drafts);
    if (stale.size > 0) this.publish({ ...this.state(), drafts: this.withoutDrafts(this.state().drafts, stale) });
  }

  private staleDraftIds(inputs: ReadonlyMap<string, InputNode>, drafts: SurfaceViewState['drafts']): Set<string> {
    const bindings = this.bindingsOf(drafts, inputs);
    const stale = new Set<string>();
    for (const id of Object.keys(drafts)) {
      const node = inputs.get(id);
      if (node === undefined || bindings.get(id) !== bindingOf(node)) stale.add(id);
    }
    return stale;
  }

  /**
   * The bindings a `drafts` record was written against. A record the parent
   * made itself carries none: its drafts are taken to belong to the inputs
   * rendered when it is first seen, and are judged against those from then on.
   */
  private bindingsOf(drafts: SurfaceViewState['drafts'], inputs: ReadonlyMap<string, InputNode>): DraftBindings {
    const known = this.draftBindings.get(drafts);
    if (known !== undefined) return known;
    const adopted = new Map<string, string>();
    for (const id of Object.keys(drafts)) {
      const node = inputs.get(id);
      if (node !== undefined) adopted.set(id, bindingOf(node));
    }
    this.draftBindings.set(drafts, adopted);
    return adopted;
  }

  private withoutDrafts(drafts: SurfaceViewState['drafts'], ids: ReadonlySet<string>): SurfaceViewState['drafts'] {
    const bindings = new Map(this.bindingsOf(drafts, this.inputsById()));
    ids.forEach(id => bindings.delete(id));
    const next = withoutKeys(drafts, ids);
    this.draftBindings.set(next, bindings);
    return next;
  }

  /** A malformed parent copy still renders: missing records read as empty. */
  private normalized(viewState: SurfaceViewState): SurfaceViewState {
    if (!isObject(viewState)) return EMPTY_VIEW_STATE;
    const components = isObject(viewState.components) ? viewState.components : EMPTY_VIEW_STATE.components;
    const drafts = isObject(viewState.drafts) ? viewState.drafts : EMPTY_VIEW_STATE.drafts;
    return components === viewState.components && drafts === viewState.drafts ? viewState : { components, drafts };
  }
}

function withoutKeys<T>(record: Readonly<Record<string, T>>, keys: ReadonlySet<string>): Readonly<Record<string, T>> {
  return Object.fromEntries(Object.entries(record).filter(([key]) => !keys.has(key)));
}
