import { DestroyRef, effect, inject, untracked, type Signal } from '@angular/core';
import { ElectronLayoutService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ArtifactStore } from '../../services/artifact.store';
import type { DisplayDockState } from '../../services/display-dock/display-dock.state';
import { DisplayWindowSync } from '../../services/display-window/display-window-sync.service';
import type { PanelResizeService } from '../../services/panel-resize.service';

/**
 * The Display sidebar's wiring for one chat view (TASK_2026_853_3401, B and D1).
 * Kept out of `ChatViewComponent` so the view only binds the result.
 */
export interface DisplaySidebarOptions {
  /** This view's dock store (its own, or the host's). */
  readonly dock: DisplayDockState;
  /** The tab this view shows. */
  readonly tabId: Signal<string | null>;
  /**
   * The main chat view (no session context) that renders its own sidebar:
   * auto-open for any known tab, the persisted width and the separate window.
   * Otherwise (a canvas tile or a host-dock embed) auto-open applies to the
   * view's own tab only, and width and window stay local.
   */
  readonly main: boolean;
  /** This view's width store; seeded from the persisted width when `main`. */
  readonly resize: PanelResizeService;
}

export interface DisplaySidebarConnection {
  /**
   * Commits the sidebar width (drag end, key step, reset; `null` resets). A
   * no-op outside the main view. Never call it per drag frame: it persists.
   */
  commitWidth(width: number | null): void;
  /** The separate-window sync; `null` outside the main view. */
  readonly window: DisplayWindowSync | null;
}

/** Must run in an injection context (a component constructor or field). */
export function connectDisplaySidebar(
  options: DisplaySidebarOptions,
): DisplaySidebarConnection {
  wireArtifactAutoOpen(options);
  if (!options.main) return { commitWidth: () => undefined, window: null };

  const layout = inject(ElectronLayoutService);
  const { resize } = options;
  // Seed, and follow a later restore. The raw width is kept (an unbounded
  // container only applies the 300 px floor); ChatView's `dockWidth` clamps
  // it against the measured host on every read.
  effect(() => {
    const stored = layout.displaySidebarWidth();
    untracked(() => {
      if (resize.dragging()) return;
      if (stored === null) resize.resetWidth();
      else resize.setCustomWidth(stored, Number.POSITIVE_INFINITY);
    });
  });

  const displayWindow = inject(DisplayWindowSync);
  const unbind = displayWindow.bindSource({ tabId: options.tabId, dock: options.dock });
  inject(DestroyRef).onDestroy(unbind);

  return {
    commitWidth: (width) => layout.setDisplaySidebarWidth(width),
    window: displayWindow,
  };
}

/**
 * Applies each new `ArtifactStore.autoOpenRequest` once. A request made
 * before this view existed is not replayed. The main view opens the record's
 * tab when any workspace holds it; any other view only its own tab. An
 * unknown tab gets no open (the reply card still works).
 */
function wireArtifactAutoOpen({ dock, tabId, main }: DisplaySidebarOptions): void {
  const store = inject(ArtifactStore);
  const tabs = inject(TabManagerService);
  let lastSeq = untracked(store.autoOpenRequest)?.seq ?? 0;
  effect(() => {
    const request = store.autoOpenRequest();
    if (request === null || request.seq <= lastSeq) return;
    lastSeq = request.seq;
    const { record } = request;
    untracked(() => {
      const target = main
        ? (tabs.findTabByIdAcrossWorkspaces(record.sessionId)?.tab.id ?? null)
        : record.sessionId === tabId()
          ? record.sessionId
          : null;
      if (target !== null) dock.requestArtifactAutoOpen(target, record.id);
    });
  });
}
