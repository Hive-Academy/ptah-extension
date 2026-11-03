import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
  untracked,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { LayoutDashboard, LucideAngularModule } from 'lucide-angular';
import {
  SurfaceRendererComponent,
  type SurfaceInteractionState,
  type SurfaceViewState,
} from '@ptah-extension/declarative-dashboard';
import type { ArtifactRecord } from '@ptah-extension/shared';
import type { TurnSummaryModel } from '../../molecules/turn-recap/turn-summary.model';
import type { DisplaySurface } from './display-surfaces';
import { ArtifactViewerComponent } from '../artifacts';
import { TurnSummaryComponent } from './turn-summary.component';

/**
 * The strip key of the host-built turn summary. Surface keys always start
 * with `id:` or `anon:` (D11), so it never collides with one.
 */
export const DISPLAY_PANEL_SUMMARY_KEY = 'summary';

/** A view-state write from one surface's renderer, for the dock store. */
export interface DisplayPanelViewStateChange {
  readonly surfaceKey: string;
  readonly viewState: SurfaceViewState;
}

/** One pill in the strip and its tabpanel. */
type DisplayPanelItem =
  | { readonly kind: 'summary'; readonly key: string; readonly title: string }
  | {
      readonly kind: 'surface';
      readonly key: string;
      readonly title: string;
      readonly surface: DisplaySurface;
    }
  | {
      readonly kind: 'artifact';
      readonly key: string;
      readonly title: string;
      readonly artifact: ArtifactRecord;
    };

/**
 * Display only (R2.12, the 610 `READ_ONLY_INTERACTION`): no selection, no
 * submit. The renderer keeps its local view actions (sort, filter, page,
 * expand), which flow out through `viewStateChange` only.
 */
const READ_ONLY_INTERACTION: SurfaceInteractionState = {
  selection: null,
  selectionUnsynced: false,
  pendingValues: new Map(),
  issues: new Map(),
  actions: new Map(),
  submitDisabled: true,
};

/**
 * One frozen object for "no stored view state": the renderer treats every new
 * `viewState` object as a replacement, so the fallback must keep its identity.
 */
const EMPTY_VIEW_STATE: SurfaceViewState = Object.freeze({
  components: Object.freeze({}),
  drafts: Object.freeze({}),
});

const NO_VIEW_STATES: ReadonlyMap<string, SurfaceViewState> = new Map();

/**
 * Panel styles (design-spec section 2): the strip scrolls horizontally inside
 * itself only; pills are 28 px tall and at most 180 px wide with an ellipsis.
 * The new-content dot pulses twice under `prefers-reduced-motion:
 * no-preference` (transform and opacity only); the dot stays without motion.
 */
const PANEL_STYLES = `
  :host { display: flex; flex-direction: column; min-width: 0; min-height: 0; height: 100%; }
  .dp-strip { scrollbar-width: thin; }
  .dp-pill { height: 1.75rem; max-width: 180px; }
  .dp-pill[aria-selected='true'] {
    border-color: color-mix(in oklab, oklch(var(--bc)) 40%, transparent);
    font-weight: 600;
  }
  .dp-pill:focus-visible, .dp-tabpanel:focus-visible {
    outline: 2px solid oklch(var(--bc));
    outline-offset: 2px;
  }
  .dp-new-dot { position: relative; width: 0.5rem; height: 0.5rem; border-radius: 9999px; background: oklch(var(--s)); }
  .dp-new-dot::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: oklch(var(--s));
    opacity: 0;
  }
  @media (prefers-reduced-motion: no-preference) {
    .dp-new-dot::after { animation: dp-ring 1.4s ease-out 2; }
  }
  @keyframes dp-ring {
    0% { transform: scale(1); opacity: 0.6; }
    100% { transform: scale(2.4); opacity: 0; }
  }
`;

let nextDisplayPanelInstance = 0;

/** An id-safe, injective spelling of a strip key (keys may hold `:` etc.). */
function idSafe(key: string): string {
  return key.replace(
    /[^A-Za-z0-9-]/g,
    (char) => `_${char.codePointAt(0)?.toString(16) ?? ''}_`,
  );
}

/**
 * DisplayPanelComponent - the Displays tabpanel body of the dock
 * (TASK_2026_623, component 5; R1.6, R1.13, R2.12, R9; design-spec sections 2
 * and 8; decisions #74, #79).
 *
 * Presentational over the dock store: the dock passes the tab's published
 * surfaces, its summary, selection, pin state and view states, and handles
 * every output. It holds no timer or observer, and it does not prune view
 * state (the store applies `retainedViewStateIds`, decision #74).
 *
 * - Strip: a `role="tablist"` with the summary first, then the surfaces in
 *   the published order. Roving tabindex, automatic activation, wrapping
 *   arrows, Home and End. A surface updated since the user last viewed it
 *   carries a gold dot (`aria-hidden`) and a visually hidden "New: " prefix.
 * - Body: one `role="tabpanel"` per pill; only the selected one is shown
 *   (`hidden` on the rest). Surfaces render through `ptah-surface-renderer`
 *   at container width with a read-only interaction; a render failure shows
 *   "Could not display this surface" in that panel only.
 * - Unpinned (R1.6): when a surface is created or updated, the one with the
 *   highest `updatedSeq` (decision #79) is selected and scrolled into view.
 *   Pinned: nothing moves; the dot marks the change. Focus never moves on an
 *   update in either state (R1.7).
 * - Empty (R1.13): "Nothing to show yet" with one explanatory sentence.
 * - Missing artifact (TASK_2026_853): a selected `artifact:<id>` that is not
 *   in `artifacts` shows one alert with Retry (`retryArtifacts`) and mounts
 *   no viewer frame.
 */
@Component({
  selector: 'ptah-display-panel',
  standalone: true,
  imports: [
    ArtifactViewerComponent,
    LucideAngularModule,
    NgTemplateOutlet,
    SurfaceRendererComponent,
    TurnSummaryComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [PANEL_STYLES],
  template: `
    <ng-template #missingNotice>
      <div
        role="alert"
        class="flex flex-wrap items-center gap-2 rounded-box border border-base-content/15 p-3 text-xs text-base-content-muted"
        data-testid="display-panel-artifact-missing"
      >
        <p class="min-w-0 flex-1">
          This artifact is not available. It may have been deleted, or the
          list did not load.
        </p>
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          (click)="retryArtifacts.emit()"
          data-testid="display-panel-artifact-retry"
        >
          Retry
        </button>
      </div>
    </ng-template>
    @if (items().length === 0) {
      @if (missingArtifact()) {
        <div class="p-3">
          <ng-container [ngTemplateOutlet]="missingNotice" />
        </div>
      }
      <div
        class="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center"
        data-testid="display-panel-empty"
      >
        <lucide-angular
          [img]="EmptyIcon"
          class="h-8 w-8 text-base-content-muted"
          aria-hidden="true"
        />
        <p class="text-sm font-semibold text-base-content">
          Nothing to show yet
        </p>
        <p class="max-w-xs text-xs text-base-content-muted">
          A turn that changes files or runs tests leaves its summary here, next
          to any displays the agent sends to this panel.
        </p>
      </div>
    } @else {
      <div
        class="dp-strip flex shrink-0 gap-1 overflow-x-auto border-b border-base-content/15 px-2 py-1.5"
        role="tablist"
        aria-label="Displays"
        data-testid="display-panel-strip"
      >
        @for (item of items(); track item.key) {
          <button
            type="button"
            role="tab"
            class="dp-pill inline-flex shrink-0 items-center gap-1.5 rounded-full border border-base-content/15 px-2.5 text-xs text-base-content"
            [class.bg-base-200]="item.key === activeKey()"
            [id]="tabId(item.key)"
            [attr.aria-selected]="item.key === activeKey()"
            [attr.aria-controls]="panelId(item.key)"
            [attr.tabindex]="item.key === activeKey() ? 0 : -1"
            [title]="item.title"
            [attr.data-key]="item.key"
            (click)="select(item.key)"
            (keydown)="onTabKeydown($event, item.key)"
            data-testid="display-panel-tab"
          >
            @if (isNew(item)) {
              <span class="sr-only">New: </span>
              <span
                class="dp-new-dot shrink-0"
                aria-hidden="true"
                data-testid="display-panel-new-dot"
              ></span>
            }
            <span class="min-w-0 truncate">{{ item.title }}</span>
          </button>
        }
      </div>
      <div
        class="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto p-3"
        data-testid="display-panel-body"
      >
        @if (missingArtifact()) {
          <ng-container [ngTemplateOutlet]="missingNotice" />
        }
        @for (item of items(); track item.key) {
          <div
            role="tabpanel"
            class="dp-tabpanel min-w-0 rounded-box"
            [id]="panelId(item.key)"
            [attr.aria-labelledby]="tabId(item.key)"
            [hidden]="item.key !== activeKey()"
            tabindex="0"
            data-testid="display-panel-tabpanel"
            [attr.data-key]="item.key"
          >
            @if (item.kind === 'summary') {
              @if (summary(); as model) {
                <ptah-turn-summary
                  [summary]="model"
                  [turnKey]="summaryTurnKey()"
                  [actionError]="actionError()"
                  (openFile)="openFile.emit($event)"
                  (review)="review.emit()"
                />
              }
            } @else if (item.kind === 'artifact') {
              @if (item.key === activeKey() && open()) { <ptah-artifact-viewer
                [artifact]="item.artifact"
                [fullscreen]="fullscreenArtifactId() === item.artifact.id"
                (fullscreenChange)="fullscreenChange.emit($event)"
                (openExternal)="openExternal.emit($event)"
                data-testid="display-panel-artifact-viewer"
              /> }
            } @else {
              @if (failedFences().has(item.surface.fenceKey)) {
                <p
                  class="rounded-box border border-base-content/15 p-3 text-xs text-base-content-muted"
                  role="note"
                  data-testid="display-panel-render-failed"
                >
                  Could not display this surface.
                </p>
              } @else {
                <ptah-surface-renderer
                  [renderable]="item.surface.content"
                  [viewState]="viewStateOf(item.key)"
                  [interaction]="readOnlyInteraction"
                  layoutWidth="container"
                  (viewStateChange)="onViewStateChange(item.key, $event)"
                  (renderFailed)="markRenderFailed(item.surface.fenceKey)"
                />
              }
            }
          </div>
        }
      </div>
    }
  `,
})
export class DisplayPanelComponent {
  /** The tab's agent surfaces in the published (creation) order. */
  readonly surfaces = input<readonly DisplaySurface[]>([]);
  /**
   * The tab's published artifacts (TASK_2026_710), in creation order. Each
   * becomes one strip item next to the summary and surfaces, rendered through
   * the sandboxed artifact viewer.
   */
  readonly artifacts = input<readonly ArtifactRecord[]>([]);
  readonly open = input(true);
  readonly fullscreenArtifactId = input<string | null>(null);
  readonly fullscreenChange = output<boolean>();
  /** The selected turn's host-built summary, or `null` when there is none. */
  readonly summary = input<TurnSummaryModel | null>(null);
  /** The summary source's id of the turn `summary` describes. */
  readonly summaryTurnKey = input('');
  /** The store's selected strip key (`DISPLAY_PANEL_SUMMARY_KEY` or a surface key). */
  readonly selectedKey = input<string | null>(null);
  /** A host opening directly on a surface requests one initial strip scroll. */
  readonly scrollToSelectedOnMount = input(false);
  /** Pinned: a new or updated surface moves neither scroll nor focus (R1.6). */
  readonly pinned = input(false);
  /** The store's per-surface view state, keyed by surface key. */
  readonly viewStates =
    input<ReadonlyMap<string, SurfaceViewState>>(NO_VIEW_STATES);
  /** The last summary action failure, shown inside the Files card (R6.8). */
  readonly actionError = input<string | null>(null);

  /** The user or an unpinned update selected another strip item. */
  readonly selectedKeyChange = output<string>();
  /** A surface's renderer changed its view state; the store keeps it. */
  readonly viewStateChange = output<DisplayPanelViewStateChange>();
  /** Summary: open (or resolve) one file of the turn's change set. */
  readonly openFile = output<string>();
  /** Summary: review the turn's whole change set. */
  readonly review = output<void>();
  /**
   * An artifact viewer relayed a validated `open-link` request; the host
   * routes the HTTP(S) URL through the main-process allowlist.
   */
  readonly openExternal = output<string>();
  /**
   * The selected artifact is not in the list the host passed (deleted, or the
   * list did not load). The host reloads its artifact list for this tab.
   */
  readonly retryArtifacts = output<void>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly instanceId = `ptah-display-panel-${nextDisplayPanelInstance++}`;

  protected readonly EmptyIcon = LayoutDashboard;
  protected readonly readOnlyInteraction = READ_ONLY_INTERACTION;

  /** Follows the store's selection; a local pick shows at once. */
  private readonly selected = linkedSignal(() => this.selectedKey());

  /** Surface key -> the `updatedSeq` the user has seen (selected) or was there at mount. */
  private readonly seenSeq = signal<ReadonlyMap<string, number>>(new Map());
  /** Fence versions whose render failed; a newer version renders again. */
  protected readonly failedFences = signal<ReadonlySet<string>>(new Set());

  /** The highest `updatedSeq` already acted on; `null` until the first read. */
  private newestSeq: number | null = null;
  private previousExternalSelection: string | null | undefined;

  protected readonly items = computed((): readonly DisplayPanelItem[] => {
    const items: DisplayPanelItem[] = [];
    if (this.summary() !== null) {
      items.push({
        kind: 'summary',
        key: DISPLAY_PANEL_SUMMARY_KEY,
        title: 'Turn summary',
      });
    }
    for (const surface of this.surfaces()) {
      items.push({
        kind: 'surface',
        key: surface.key,
        title: surface.title ?? 'Display',
        surface,
      });
    }
    // The `artifact:` prefix cannot collide with the summary key or the
    // `id:` / `anon:` surface keys.
    for (const artifact of this.artifacts()) {
      items.push({
        kind: 'artifact',
        key: `artifact:${artifact.id}`,
        title: artifact.title,
        artifact,
      });
    }
    return items;
  });

  protected readonly missingArtifact = computed(() => {
    const key = this.selected();
    return key?.startsWith('artifact:') === true && !this.items().some((item) => item.key === key);
  });

  /** The selected key when it is in the strip, else the first item's. */
  protected readonly activeKey = computed((): string | null => {
    const items = this.items();
    const selected = this.selected();
    if (selected !== null && items.some((item) => item.key === selected)) {
      return selected;
    }
    if (this.missingArtifact()) return null;
    return items[0]?.key ?? null;
  });

  constructor() {
    // An inline block can select an existing surface from outside the strip.
    effect(() => {
      const key = this.selectedKey();
      if (
        key !== null &&
        (this.previousExternalSelection === undefined
          ? this.scrollToSelectedOnMount()
          : key !== this.previousExternalSelection)
      ) this.scrollIntoView(key);
      this.previousExternalSelection = key;
    });
    // R1.6 / decision #79: react to a new highest `updatedSeq`.
    effect(() => {
      const surfaces = this.surfaces();
      const newest = surfaces.reduce<DisplaySurface | null>(
        (best, surface) =>
          best === null || surface.updatedSeq > best.updatedSeq
            ? surface
            : best,
        null,
      );
      const newestSeq = newest?.updatedSeq ?? -1;
      untracked(() => {
        if (this.newestSeq === null) {
          // First read: what is already there is not new.
          this.newestSeq = newestSeq;
          this.seenSeq.set(
            new Map(
              surfaces.map((surface) => [surface.key, surface.updatedSeq]),
            ),
          );
          return;
        }
        if (newest === null || newestSeq <= this.newestSeq) return;
        this.newestSeq = newestSeq;
        if (this.pinned()) return;
        this.selected.set(newest.key);
        this.selectedKeyChange.emit(newest.key);
        this.scrollIntoView(newest.key);
      });
    });

    // The selected surface counts as seen at its current version.
    effect(() => {
      const key = this.activeKey();
      const surfaces = this.surfaces();
      untracked(() => {
        const current = this.seenSeq();
        const next = new Map<string, number>();
        for (const surface of surfaces) {
          const seen =
            surface.key === key ? surface.updatedSeq : current.get(surface.key);
          if (seen !== undefined) next.set(surface.key, seen);
        }
        if (!sameSeq(current, next)) this.seenSeq.set(next);
      });
    });
  }

  protected tabId(key: string): string {
    return `${this.instanceId}-tab-${idSafe(key)}`;
  }

  protected panelId(key: string): string {
    return `${this.instanceId}-panel-${idSafe(key)}`;
  }

  protected isNew(item: DisplayPanelItem): boolean {
    if (item.kind !== 'surface') return false;
    const seen = this.seenSeq().get(item.key);
    return seen === undefined || item.surface.updatedSeq > seen;
  }

  protected viewStateOf(key: string): SurfaceViewState {
    return this.viewStates().get(key) ?? EMPTY_VIEW_STATE;
  }

  protected select(key: string): void {
    if (key === this.activeKey()) return;
    this.selected.set(key);
    this.selectedKeyChange.emit(key);
  }

  /** Automatic activation: arrows wrap, Home and End jump; focus follows. */
  protected onTabKeydown(event: KeyboardEvent, key: string): void {
    const items = this.items();
    const index = items.findIndex((item) => item.key === key);
    if (index < 0) return;
    let target: number;
    switch (event.key) {
      case 'ArrowRight':
        target = (index + 1) % items.length;
        break;
      case 'ArrowLeft':
        target = (index - 1 + items.length) % items.length;
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const next = items[target].key;
    this.select(next);
    this.tabElement(next)?.focus();
  }

  protected onViewStateChange(
    surfaceKey: string,
    viewState: SurfaceViewState,
  ): void {
    this.viewStateChange.emit({ surfaceKey, viewState });
  }

  protected markRenderFailed(fenceKey: string): void {
    const live = new Set(this.surfaces().map((surface) => surface.fenceKey));
    this.failedFences.update((failed) => {
      const next = new Set([...failed].filter((key) => live.has(key)));
      next.add(fenceKey);
      return next;
    });
  }

  private tabElement(key: string): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>(
      `#${this.tabId(key)}`,
    );
  }

  /** After the selection renders: bring its pill and panel top into view. Never focuses. */
  private scrollIntoView(key: string): void {
    afterNextRender(
      {
        write: () => {
          const tab = this.tabElement(key);
          if (typeof tab?.scrollIntoView === 'function') {
            tab.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          }
          const body = this.host.nativeElement.querySelector<HTMLElement>(
            '[data-testid="display-panel-body"]',
          );
          if (body !== null) body.scrollTop = 0;
        },
      },
      { injector: this.injector },
    );
  }
}

function sameSeq(
  left: ReadonlyMap<string, number>,
  right: ReadonlyMap<string, number>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [key, seq] of right) {
    if (left.get(key) !== seq) return false;
  }
  return true;
}
