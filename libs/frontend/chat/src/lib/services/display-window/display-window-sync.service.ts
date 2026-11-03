import {
  DestroyRef,
  Injectable,
  Injector,
  computed,
  effect,
  inject,
  signal,
  untracked,
  type Signal,
} from '@angular/core';
import {
  ClaudeRpcService,
  ThemeService,
  VSCodeService,
  type MessageHandler,
} from '@ptah-extension/core';
import {
  DISPLAY_WINDOW_PUSH_TYPES,
  DISPLAY_WINDOW_STATE_MAX_BYTES,
  type DisplayWindowJsonObject,
  type DisplayWindowUnavailableReason,
  type TurnChangeSet,
} from '@ptah-extension/shared';
import { ArtifactStore } from '../artifact.store';
import {
  ChangeSetActionsService,
  runDisplayChangeSetAction,
} from '../change-set/change-set-actions.service';
import type { DisplayDockState } from '../display-dock/display-dock.state';
import {
  DISPLAY_WINDOW_SUMMARY_KEY,
  parseActionPush,
  selectionForKey,
  selectionKey,
  toWire,
  utf8ByteLength,
  type DisplayWindowParsedAction,
  type DisplayWindowView,
} from './display-window-wire';

/** The tab and dock the main ChatView shows; the detached window mirrors it. */
export interface DisplayWindowSource {
  /** The main view's active tab; `null` when no tab is open. */
  readonly tabId: Signal<string | null>;
  readonly dock: DisplayDockState;
}

const UNAVAILABLE_TEXT: Readonly<
  Record<DisplayWindowUnavailableReason, string>
> = {
  'desktop-only':
    'A separate Display window is available in the desktop app only.',
  'not-ready': 'The Display window is not ready yet. Try again in a moment.',
};
const OPEN_FAILED_TEXT = 'Could not open the Display window.';
const CLOSE_FAILED_TEXT = 'Could not close the Display window.';
const TOO_LARGE_TEXT = 'The display is too large to show in a separate window.';
const NO_TAB_TEXT = 'The main window has no chat tab to show right now.';

/**
 * Publish coalescing delay (about one frame). A timer, not
 * `requestAnimationFrame`: rAF stops while the main window is minimized or
 * hidden, and the detached window must keep updating then.
 */
const PUBLISH_DELAY_MS = 16;
/** A failed publish is retried this many times, with a growing delay. */
const PUBLISH_MAX_RETRIES = 3;
const PUBLISH_RETRY_BASE_MS = 500;

/**
 * The main renderer's side of the detached Display window
 * (TASK_2026_853_3401, D4). The main renderer stays authoritative.
 *
 * - `detach()` opens the window (`displayWindow:open`), `focus()` raises it
 *   (the same RPC), `attach()` closes it (`displayWindow:close`).
 * - `bindSource` is called only by the main ChatView. While detached, one
 *   effect builds the bound tab's display view; it is published with
 *   `displayWindow:publishState` at most once per ~16 ms timer tick (not
 *   rAF, which stops while the main window is minimized), and only when its
 *   JSON changed. A failed publish is retried a bounded number of times.
 *   With no bound tab, or a snapshot over the size limit, a `notice` view
 *   is published so the window never keeps showing stale content.
 * - Message handler for `displayWindow:closed` (the user closed the window)
 *   and `displayWindow:action` (a user action in the window). An action is
 *   applied to the dock only when its `tabId` is the bound tab; `attach`
 *   always applies. A dropped action republishes so the window resyncs.
 * - On Electron it asks `displayWindow:status` once, so a reload of the main
 *   renderer finds an open window again.
 *
 * The detached window itself never injects this service.
 */
@Injectable({ providedIn: 'root' })
export class DisplayWindowSync implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly theme = inject(ThemeService);
  private readonly artifacts = inject(ArtifactStore);
  // Resolved on the first change-set action from the window, not at boot.
  private readonly injector = inject(Injector);

  readonly handledMessageTypes = [
    DISPLAY_WINDOW_PUSH_TYPES.closed,
    DISPLAY_WINDOW_PUSH_TYPES.action,
  ] as const;

  private readonly _detached = signal(false);
  private readonly _error = signal<string | null>(null);
  /** The Display panel is shown in the separate window. */
  readonly detached = this._detached.asReadonly();
  /** The last open, close or publish failure, for the main view to show. */
  readonly error = this._error.asReadonly();

  private readonly source = signal<DisplayWindowSource | null>(null);
  /** A failed open-file or review run from the window, shown in its panel. */
  private readonly actionFailure = signal<{
    tabId: string;
    message: string;
  } | null>(null);

  /** The bound tab's display view, or `null` with no source or no tab. */
  private readonly view = computed(
    (): { tabId: string; view: DisplayWindowView } | null => {
      const source = this.source();
      const tabId = source?.tabId() ?? null;
      if (source === null || tabId === null) return null;
      return { tabId, view: this.buildView(source.dock, tabId) };
    },
  );

  /** Number of strip items of the bound tab, for the main view's detached rail. */
  readonly count = computed(() => this.view()?.view.count ?? 0);

  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastPublished: string | null = null;
  /** The tab of the last published snapshot; a notice is sent for it. */
  private lastTabId: string | null = null;
  private revision = 0;
  private retries = 0;

  constructor() {
    effect(() => {
      if (!this._detached()) return;
      // Read inside the effect so any change schedules one publish.
      this.view();
      untracked(() => this.schedulePublish());
    });
    inject(DestroyRef).onDestroy(() => this.cancelTimer());
    if (this.vscode.isElectron) void this.restoreStatus();
  }

  /**
   * Binds the main view's tab and dock. Returns the unbind function; it
   * clears the binding only if it is still this source.
   */
  bindSource(source: DisplayWindowSource): () => void {
    this.source.set(source);
    return () => {
      if (untracked(this.source) === source) this.source.set(null);
    };
  }

  /** Opens the separate window; on success the panel moves there. */
  async detach(): Promise<void> {
    await this.open();
  }

  /** Raises the open window. */
  async focus(): Promise<void> {
    await this.open();
  }

  /** Closes the window; the panel returns to the main window. */
  async attach(): Promise<void> {
    try {
      const result = await this.rpc.call('displayWindow:close', {});
      if (!result.success) {
        this._error.set(CLOSE_FAILED_TEXT);
        return;
      }
      this._error.set(null);
      this.markAttached();
    } catch {
      // degradation-audit: reported — the window stays as it was; `error` tells the user.
      this._error.set(CLOSE_FAILED_TEXT);
    }
  }

  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type === DISPLAY_WINDOW_PUSH_TYPES.closed) {
      this.markAttached();
      return;
    }
    if (message.type !== DISPLAY_WINDOW_PUSH_TYPES.action) return;
    const push = parseActionPush(message.payload);
    if (push === null) {
      console.warn('[DisplayWindowSync] invalid displayWindow:action payload');
      return;
    }
    if (push.action.type === 'attach') {
      // Re-attach never depends on which tab the window last saw.
      void this.attach();
      return;
    }
    const source = untracked(this.source);
    if (source === null || untracked(source.tabId) !== push.tabId) {
      // Stale: the window acted on an older tab. Send it the current view.
      this.lastPublished = null;
      this.schedulePublish();
      return;
    }
    this.applyAction(source.dock, push.tabId, push.action);
  }

  private async open(): Promise<void> {
    try {
      const result = await this.rpc.call('displayWindow:open', {});
      if (!result.success || result.data === undefined) {
        this._error.set(OPEN_FAILED_TEXT);
        return;
      }
      if (!result.data.ok) {
        this._error.set(UNAVAILABLE_TEXT[result.data.reason]);
        return;
      }
      this._error.set(null);
      this.markDetached();
    } catch {
      // degradation-audit: reported — the panel stays in the main window; `error` tells the user.
      this._error.set(OPEN_FAILED_TEXT);
    }
  }

  private async restoreStatus(): Promise<void> {
    try {
      const result = await this.rpc.call('displayWindow:status', {});
      if (result.success && result.data?.supported && result.data.open)
        this.markDetached();
    } catch {
      // degradation-audit: optional-capability — an unknown status keeps the panel attached.
    }
  }

  private markDetached(): void {
    // A new window holds no state yet: publish the current view once.
    this.lastPublished = null;
    this.retries = 0;
    this._detached.set(true);
  }

  private markAttached(): void {
    this._detached.set(false);
    this.cancelTimer();
    this.lastPublished = null;
    this.lastTabId = null;
    this.retries = 0;
  }

  private applyAction(
    dock: DisplayDockState,
    tabId: string,
    action: DisplayWindowParsedAction,
  ): void {
    switch (action.type) {
      case 'select':
        dock.select(tabId, selectionForKey(action.key));
        return;
      case 'fullscreen-closed':
        dock.clearFullscreenArtifact(tabId);
        return;
      case 'view-state':
        dock.setViewState(tabId, action.surfaceKey, action.viewState);
        return;
      case 'open-file':
        void this.runChangeSetAction(dock, tabId, (changeSet) =>
          this.injector
            .get(ChangeSetActionsService)
            .openFile(changeSet, action.path),
        );
        return;
      case 'review':
        void this.runChangeSetAction(dock, tabId, (changeSet) =>
          this.injector.get(ChangeSetActionsService).review(changeSet),
        );
        return;
      case 'attach':
        // Handled before the tab check in `handleMessage`.
        return;
    }
  }

  /** The display sheet's change-set rule: the shown summary's change set, or an error. */
  private async runChangeSetAction(
    dock: DisplayDockState,
    tabId: string,
    action: (changeSet: TurnChangeSet) => Promise<void>,
  ): Promise<void> {
    this.actionFailure.set(null);
    await runDisplayChangeSetAction(
      dock.summaryFor(tabId)?.changeSet ?? null,
      action,
      (message) => this.actionFailure.set({ tabId, message }),
    );
  }

  private buildView(dock: DisplayDockState, tabId: string): DisplayWindowView {
    const state = dock.tab(tabId);
    const selection = state.selection;
    const summary = dock.summaryFor(tabId);
    const artifacts = this.artifacts.panelArtifacts(
      tabId,
      selection?.kind === 'artifact' ? selection.artifactId : null,
    );
    const failure = this.actionFailure();
    const themeName = this.theme.currentTheme();
    return {
      theme: {
        name: themeName,
        mode: this.theme.isDarkMode() ? 'dark' : 'light',
      },
      open: true,
      pinned: state.pinned,
      count:
        (summary === null ? 0 : 1) + state.surfaces.length + artifacts.length,
      selectedKey: selectionKey(selection),
      scrollToSelectedOnMount:
        (selection?.kind ?? DISPLAY_WINDOW_SUMMARY_KEY) !==
        DISPLAY_WINDOW_SUMMARY_KEY,
      fullscreenArtifactId: dock.fullscreenArtifact(tabId),
      summary: summary?.model ?? null,
      summaryTurnKey: dock.summaryKeyFor(tabId) ?? '',
      surfaces: state.surfaces,
      viewStates: state.viewStates,
      artifacts,
      actionError: failure?.tabId === tabId ? failure.message : null,
      notice: null,
    };
  }

  /** The panel replaced by a message, for a tab the window last showed. */
  private noticeView(notice: string): DisplayWindowView {
    return {
      theme: {
        name: this.theme.currentTheme(),
        mode: this.theme.isDarkMode() ? 'dark' : 'light',
      },
      open: true,
      pinned: false,
      count: 0,
      selectedKey: null,
      scrollToSelectedOnMount: false,
      fullscreenArtifactId: null,
      summary: null,
      summaryTurnKey: '',
      surfaces: [],
      viewStates: new Map(),
      artifacts: [],
      actionError: null,
      notice,
    };
  }

  private schedulePublish(delayMs = PUBLISH_DELAY_MS): void {
    if (this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.publish();
    }, delayMs);
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private publish(): void {
    if (!untracked(this._detached)) return;
    const current = untracked(this.view);
    if (current === null) {
      // Unbound (ChatView gone or no tab): replace what the window shows.
      if (this.lastTabId !== null)
        this.send(this.lastTabId, this.noticeView(NO_TAB_TEXT));
      return;
    }
    if (!this.send(current.tabId, current.view)) {
      this._error.set(TOO_LARGE_TEXT);
      this.send(current.tabId, this.noticeView(TOO_LARGE_TEXT));
    }
  }

  /**
   * Publishes one view unless its JSON equals the last one. Returns `false`
   * only when the snapshot is over `DISPLAY_WINDOW_STATE_MAX_BYTES`.
   */
  private send(tabId: string, view: DisplayWindowView): boolean {
    const state: DisplayWindowJsonObject = toWire(view);
    const text = JSON.stringify({ tabId, state });
    if (text === this.lastPublished) return true;
    if (utf8ByteLength(text) > DISPLAY_WINDOW_STATE_MAX_BYTES) return false;
    this.lastPublished = text;
    this.lastTabId = tabId;
    this.revision += 1;
    this.rpc
      .call('displayWindow:publishState', {
        tabId,
        revision: this.revision,
        state,
      })
      .then((result) => {
        if (!result.success) {
          this.publishFailed(text, 'displayWindow:publishState failed');
          return;
        }
        this.retries = 0;
        if (
          view.notice !== TOO_LARGE_TEXT &&
          untracked(this._error) === TOO_LARGE_TEXT
        ) {
          this._error.set(null);
        }
      })
      .catch(() => {
        // degradation-audit: reported — logged and retried (bounded); the window keeps its last state meanwhile.
        this.publishFailed(text, 'displayWindow:publishState request failed');
      });
    return true;
  }

  /** Forgets the failed text and retries it a bounded number of times. */
  private publishFailed(text: string, reason: string): void {
    if (this.lastPublished !== text) return; // A newer publish already went out.
    this.lastPublished = null;
    console.warn(`[DisplayWindowSync] ${reason}`);
    if (this.retries >= PUBLISH_MAX_RETRIES) return;
    this.retries += 1;
    this.schedulePublish(PUBLISH_RETRY_BASE_MS * this.retries);
  }
}
