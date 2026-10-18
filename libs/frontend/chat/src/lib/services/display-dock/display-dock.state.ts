import {
  Injectable,
  signal,
  untracked,
  type WritableSignal,
} from '@angular/core';
// Every import below is type-only and erased: this store is eager (ChatView
// provides it), so it holds no runtime import of `mcp-apps-contracts`, the
// lazy chat-ui entries or the renderer (D4).
import type {
  DisplaySurface,
  PtahUiDisplayDock,
  PtahUiDisplayDockSync,
  PtahUiDisplayFenceStatus,
  PtahUiDisplaySurfacesPublication,
} from '@ptah-extension/chat-ui';
import type { TurnSummaryModel } from '@ptah-extension/chat-ui/turn-recap';
import type { SurfaceViewState } from '@ptah-extension/declarative-dashboard';
import type { TurnChangeSet } from '@ptah-extension/shared';

/** The dock's two tabs (design section 2). */
export type DisplayDockTab = 'displays' | 'agents';

/** What the Displays tab's strip has selected; `null` lets the panel pick. */
export type DisplayDockSelection =
  | { readonly kind: 'summary' }
  | { readonly kind: 'surface'; readonly surfaceKey: string }
  | null;

/** One turn's host-built summary and the change set its actions act on. */
export interface DisplayDockSummary {
  readonly model: TurnSummaryModel;
  /** `null` when the turn has no recorded change set (no file actions). */
  readonly changeSet: TurnChangeSet | null;
}

/** The dock state of one chat tab (D4). */
export interface DisplayDockTabState {
  readonly open: boolean;
  /** Pinned: updates move neither scroll nor focus; closing unpins (R1.6). */
  readonly pinned: boolean;
  readonly activeTab: DisplayDockTab;
  /** The user's width in px; `null` uses the responsive default (R1.5). */
  readonly widthPx: number | null;
  /** The turn streaming in the tab, as the transcript or the sync reported it. */
  readonly liveTurnKey: string | null;
  /** The turn in which the user closed the dock; its displays never reopen it (R1.8). */
  readonly userClosedTurnKey: string | null;
  /** Display updates held back by a user close; the toggle shows "n new". */
  readonly newCount: number;
  /** Advances for each published surface that requests a sheet peek. */
  readonly surfaceRevision: number;
  /** The user closed the dock; agent activity does not reopen it until released. */
  readonly agentsUserClosed: boolean;
  readonly selection: DisplayDockSelection;
  /** The turn whose summary the panel shows; `null` shows the latest turn. */
  readonly summaryTurnKey: string | null;
  /** The agent surfaces the sync last published, in creation order. */
  readonly surfaces: readonly DisplaySurface[];
  /** Per-fence statuses keyed by `displayFenceKey`. */
  readonly statuses: ReadonlyMap<string, PtahUiDisplayFenceStatus>;
  /** Renderer view state per surface key (D10). */
  readonly viewStates: ReadonlyMap<string, SurfaceViewState>;
  /** Host-built summaries keyed by turn key, in turn order. */
  readonly summaries: ReadonlyMap<string, DisplayDockSummary>;
}

const EMPTY_TAB_STATE: DisplayDockTabState = Object.freeze({
  open: false,
  pinned: false,
  activeTab: 'displays',
  widthPx: null,
  liveTurnKey: null,
  userClosedTurnKey: null,
  newCount: 0,
  surfaceRevision: 0,
  agentsUserClosed: false,
  selection: null,
  summaryTurnKey: null,
  surfaces: Object.freeze([]) as readonly DisplaySurface[],
  statuses: new Map<string, PtahUiDisplayFenceStatus>(),
  viewStates: new Map<string, SurfaceViewState>(),
  summaries: new Map<string, DisplayDockSummary>(),
});

/**
 * Per-tab state of the right-side `Displays | Agents` dock (TASK_2026_623,
 * D4, D10, D12, component 8). Provided by `ChatViewComponent`, so each canvas
 * tile owns its own store; every method takes the tab id, so the main
 * ChatView keeps each tab's dock across tab switches (R1.1).
 *
 * It implements both chat-ui ports: the read port the in-message chip uses
 * (`PtahUiDisplayDock`) and the write port of the headless display sync
 * (`PtahUiDisplayDockSync`, decisions #59, #60, #73).
 *
 * Reads go through signals: `tab(tabId)` and `fenceStatus(tabId, key)` re-run
 * a caller's `computed` when that tab changes, and a tab first written after
 * the read still notifies it. The seen-fence sets (D12) are plain per-tab sets:
 * `hasSeen` and `markSeen` are synchronous, so the sync's
 * `hasSeen -> requestAutoOpen -> markSeen` sequence has no gap another
 * publish could enter (decision #81).
 *
 * The store holds no timers and never moves focus (R1.7).
 */
@Injectable()
export class DisplayDockState implements PtahUiDisplayDock, PtahUiDisplayDockSync {
  /** One signal per tab; the map itself changes only when a tab is first written. */
  private readonly tabs = signal<
    ReadonlyMap<string, WritableSignal<DisplayDockTabState>>
  >(new Map());

  /** `seenBlockKeys` per tab (D12): `displayFenceKey`s the sync has published. */
  private readonly seen = new Map<string, Set<string>>();

  /** The tab's dock state; an unknown tab reads the closed, empty default. */
  tab(tabId: string): DisplayDockTabState {
    return this.tabs().get(tabId)?.() ?? EMPTY_TAB_STATE;
  }

  /** The summary the panel shows: the selected turn's, else the latest turn's. */
  summaryFor(tabId: string): DisplayDockSummary | null {
    const key = this.summaryKeyFor(tabId);
    return key === null ? null : (this.tab(tabId).summaries.get(key) ?? null);
  }

  /** The turn key of the summary the panel shows (see {@link summaryFor}). */
  summaryKeyFor(tabId: string): string | null {
    const state = this.tab(tabId);
    if (
      state.summaryTurnKey !== null &&
      state.summaries.has(state.summaryTurnKey)
    ) {
      return state.summaryTurnKey;
    }
    let latest: string | null = null;
    for (const key of state.summaries.keys()) latest = key;
    return latest;
  }

  // --- Read port (PtahUiDisplayDock) --------------------------------------

  fenceStatus(tabId: string, fenceKey: string): PtahUiDisplayFenceStatus | null {
    return this.tab(tabId).statuses.get(fenceKey) ?? null;
  }

  /** Releases all display and seen-fence state when its chat tab is closed. */
  forgetTab(tabId: string): void {
    this.seen.delete(tabId);
    const tabs = new Map(this.tabs());
    if (tabs.delete(tabId)) this.tabs.set(tabs);
  }

  openSurface(tabId: string, surfaceKey: string): void {
    this.update(tabId, (state) => ({
      ...openedState(state, 'displays'),
      selection: { kind: 'surface', surfaceKey },
    }));
  }

  // --- User actions --------------------------------------------------------

  open(tabId: string): void {
    this.update(tabId, (state) => openedState(state, state.activeTab));
  }

  /**
   * The user closed the dock. During a turn the turn is recorded, so its later
   * displays only count as new (R1.8). Closing a pinned dock unpins it (R1.6).
   */
  close(tabId: string): void {
    this.update(tabId, (state) =>
      state.open
        ? {
            ...state,
            open: false,
            pinned: false,
            userClosedTurnKey: state.liveTurnKey,
            agentsUserClosed: true,
          }
        : state,
    );
  }

  toggle(tabId: string): void {
    if (untracked(() => this.tab(tabId).open)) {
      this.close(tabId);
    } else {
      this.open(tabId);
    }
  }

  setPinned(tabId: string, pinned: boolean): void {
    this.update(tabId, (state) =>
      state.pinned === pinned ? state : { ...state, pinned },
    );
  }

  selectTab(tabId: string, activeTab: DisplayDockTab): void {
    this.update(tabId, (state) =>
      state.activeTab === activeTab ? state : { ...state, activeTab },
    );
  }

  /** The strip's selection changed inside an open dock (no open, no tab change). */
  select(tabId: string, selection: DisplayDockSelection): void {
    this.update(tabId, (state) =>
      sameSelection(state.selection, selection) ? state : { ...state, selection },
    );
  }

  /** The chip of a turn: opens the dock on that turn's summary. */
  openSummary(tabId: string, turnKey: string): void {
    this.update(tabId, (state) => ({
      ...openedState(state, 'displays'),
      summaryTurnKey: turnKey,
      selection: { kind: 'summary' },
    }));
  }

  /** The width the separator set, already clamped by `PanelResizeService`. */
  setWidth(tabId: string, widthPx: number | null): void {
    this.update(tabId, (state) =>
      state.widthPx === widthPx ? state : { ...state, widthPx },
    );
  }

  /** Stores a renderer's view state verbatim, for a surface the tab holds. */
  setViewState(tabId: string, surfaceKey: string, viewState: SurfaceViewState): void {
    this.update(tabId, (state) => {
      if (
        state.viewStates.get(surfaceKey) === viewState ||
        !state.surfaces.some((surface) => surface.key === surfaceKey)
      ) {
        return state;
      }
      const viewStates = new Map(state.viewStates);
      viewStates.set(surfaceKey, viewState);
      return { ...state, viewStates };
    });
  }

  // --- Turn and agent signals ---------------------------------------------

  /**
   * The turn streaming in the tab (`turnKey`, the opening user message id), or
   * `null` once it reached a terminal state. A user close records it (R1.8).
   */
  setLiveTurn(tabId: string, turnKey: string | null): void {
    this.update(tabId, (state) =>
      state.liveTurnKey === turnKey ? state : { ...state, liveTurnKey: turnKey },
    );
  }

  /** Host-built summaries of the tab's turns, keyed by turn key in turn order. */
  setSummaries(
    tabId: string,
    summaries: ReadonlyMap<string, DisplayDockSummary>,
  ): void {
    this.update(tabId, (state) => {
      if (state.summaries === summaries) return state;
      const summaryTurnKey =
        state.summaryTurnKey !== null && summaries.has(state.summaryTurnKey)
          ? state.summaryTurnKey
          : null;
      const selection =
        state.selection?.kind === 'summary' && summaries.size === 0
          ? null
          : state.selection;
      return { ...state, summaries, summaryTurnKey, selection };
    });
  }

  /**
   * Agent activity asks for the Agents tab. Ignored while the dock is open
   * (the user's tab stays) or after the user closed it, until
   * `releaseAgentsUserClose` (the existing monitor rule).
   */
  requestAgentsOpen(tabId: string): void {
    this.update(tabId, (state) =>
      state.open || state.agentsUserClosed ? state : openedState(state, 'agents'),
    );
  }

  /** The tab's agents all settled: agent activity may open the dock again. */
  releaseAgentsUserClose(tabId: string): void {
    this.update(tabId, (state) =>
      state.agentsUserClosed ? { ...state, agentsUserClosed: false } : state,
    );
  }

  // --- Write port (PtahUiDisplayDockSync) ----------------------------------

  surfaces(tabId: string): readonly DisplaySurface[] {
    return untracked(() => this.tab(tabId).surfaces);
  }

  /**
   * Replaces the tab's surfaces and statuses and applies D10 (decision #74):
   * view state of a key no longer present is dropped, and each surface keeps
   * only the component entries listed in its `retainedViewStateIds`.
   */
  setSurfaces(
    tabId: string,
    publication: PtahUiDisplaySurfacesPublication,
  ): void {
    this.update(tabId, (state) => {
      const viewStates = new Map<string, SurfaceViewState>();
      for (const surface of publication.surfaces) {
        const previous = state.viewStates.get(surface.key);
        if (previous === undefined) continue;
        const retained = retainViewState(previous, surface.retainedViewStateIds);
        if (retained !== null) viewStates.set(surface.key, retained);
      }
      const selected = state.selection;
      const selection =
        selected?.kind === 'surface' &&
        !publication.surfaces.some(
          (surface) => surface.key === selected.surfaceKey,
        )
          ? null
          : selected;
      return {
        ...state,
        surfaces: publication.surfaces,
        statuses: publication.statuses,
        viewStates,
        selection,
      };
    });
  }

  hasSeen(tabId: string, fenceKey: string): boolean {
    return this.seen.get(tabId)?.has(fenceKey) ?? false;
  }

  markSeen(tabId: string, fenceKeys: readonly string[]): void {
    if (fenceKeys.length === 0) return;
    let seen = this.seen.get(tabId);
    if (seen === undefined) {
      seen = new Set<string>();
      this.seen.set(tabId, seen);
    }
    for (const key of fenceKeys) seen.add(key);
  }

  /**
   * D12. A closed dock opens on the Displays tab with the surface selected,
   * unless the user closed it in this turn: then it stays closed and
   * `newCount` grows (R1.8). An open, unpinned dock shows the Displays tab
   * with the surface selected; a pinned one does not move (R1.6). Focus is
   * never moved (R1.7).
   */
  requestAutoOpen(tabId: string, turnKey: string, surfaceKey: string): void {
    this.update(tabId, (state) => {
      const live = { ...state, liveTurnKey: turnKey, surfaceRevision: state.surfaceRevision + 1 };
      if (state.open) {
        return state.pinned
          ? live
          : {
              ...live,
              activeTab: 'displays',
              selection: { kind: 'surface', surfaceKey },
            };
      }
      if (state.userClosedTurnKey === turnKey) {
        return { ...live, newCount: state.newCount + 1 };
      }
      return {
        ...openedState(live, 'displays'),
        selection: { kind: 'surface', surfaceKey },
      };
    });
  }

  // --- Internals -----------------------------------------------------------

  private update(
    tabId: string,
    next: (state: DisplayDockTabState) => DisplayDockTabState,
  ): void {
    let tab = untracked(this.tabs).get(tabId);
    if (tab === undefined) {
      const created = signal(EMPTY_TAB_STATE);
      tab = created;
      this.tabs.update((tabs) => new Map(tabs).set(tabId, created));
    }
    tab.update(next);
  }
}

/** The dock open on `activeTab`; opening shows the held-back content. */
function openedState(
  state: DisplayDockTabState,
  activeTab: DisplayDockTab,
): DisplayDockTabState {
  return { ...state, open: true, activeTab, newCount: 0 };
}

function sameSelection(a: DisplayDockSelection, b: DisplayDockSelection): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'summary' || b.kind === 'summary') return a.kind === b.kind;
  return a.surfaceKey === b.surfaceKey;
}

/**
 * The view state with only the retained component ids (D10); the same object
 * when nothing is dropped, `null` when nothing is left.
 */
function retainViewState(
  viewState: SurfaceViewState,
  retainedIds: ReadonlySet<string>,
): SurfaceViewState | null {
  const componentIds = Object.keys(viewState.components);
  const draftIds = Object.keys(viewState.drafts);
  const keptComponents = componentIds.filter((id) => retainedIds.has(id));
  const keptDrafts = draftIds.filter((id) => retainedIds.has(id));
  if (keptComponents.length === 0 && keptDrafts.length === 0) return null;
  if (
    keptComponents.length === componentIds.length &&
    keptDrafts.length === draftIds.length
  ) {
    return viewState;
  }
  return {
    components: Object.fromEntries(
      keptComponents.map((id) => [id, viewState.components[id]]),
    ),
    drafts: Object.fromEntries(keptDrafts.map((id) => [id, viewState.drafts[id]])),
  };
}
