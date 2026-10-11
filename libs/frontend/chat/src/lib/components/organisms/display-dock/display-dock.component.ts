import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Pin, X } from 'lucide-angular';
import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import type { TurnChangeSet } from '@ptah-extension/shared';
// This file is reached only through ChatView's `@defer (when panelOpen())`
// (its own import declaration there, referenced only in `imports` and the
// deferred block), so the lazy `display-panel` entry below stays out of the
// eager chunk (D14, decisions #84, #89).
import {
  DisplayPanelComponent,
  DISPLAY_PANEL_SUMMARY_KEY,
  type DisplayPanelViewStateChange,
} from '@ptah-extension/chat-ui/display-panel';
import {
  DisplayDockState,
  type DisplayDockTab,
} from '../../../services/display-dock/display-dock.state';
import { ChangeSetActionsService } from '../../../services/change-set/change-set-actions.service';
import { AgentMonitorPanelComponent } from '../agent-monitor-panel.component';

/** Shown when a summary action runs on a turn with no recorded change set. */
const NO_CHANGE_SET_TEXT = 'This turn has no recorded file changes to open.';

/** The actions service rejects with a user-facing `Error`; anything else. */
const ACTION_FAILED_TEXT = 'The review action failed.';

const DOCK_TABS: readonly DisplayDockTab[] = ['displays', 'agents'];

let nextDisplayDockInstance = 0;

/**
 * DisplayDockComponent - the per-tab right-side dock of the Electron chat
 * view, with `Displays | Agents` tabs (TASK_2026_623, component 8; R1, design
 * section 2; decisions #11, #84, #100-#102).
 *
 * - Header: a segmented `role="tablist"` "Displays (n)" / "Agents (n)" with
 *   roving tabindex, wrapping arrows, Home and End and automatic activation;
 *   a tab with unseen content carries an `aria-hidden` dot and a visually
 *   hidden "New: " prefix. Then pin (`aria-pressed`) and close.
 * - Two `role="tabpanel"` elements, always present, only the active one
 *   shown. Displays hosts `ptah-display-panel` bound to the dock store;
 *   Agents hosts the monitor in docked mode, whose empty state reads "No
 *   agents in this session" (R1.13).
 * - Summary actions go through `ChangeSetActionsService` on the change set
 *   stored beside the summary (#101); a rejection or a missing change set
 *   shows inline in the summary. No Source Control action (#84).
 *
 * All state lives in `DisplayDockState` (ChatView-provided), keyed by
 * `tabId`. Close is reported to ChatView, which owns focus return. Focus
 * moves to the close button only on a user open in overlay mode
 * (`focusRequest`), never on an auto-open (R1.7).
 */
@Component({
  selector: 'ptah-display-dock',
  standalone: true,
  imports: [LucideAngularModule, DisplayPanelComponent, AgentMonitorPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'flex flex-col min-w-0 min-h-0 h-full bg-base-200',
    '[class.hidden]': '!state().open',
    '[class.flex-shrink-0]': '!isOverlay()',
    '[class.border-l]': '!isOverlay()',
    '[class.border-base-content/10]': '!isOverlay()',
    '[class.absolute]': 'isOverlay()',
    '[class.inset-0]': 'isOverlay()',
    '[class.w-full]': 'isOverlay()',
    '[class.z-20]': 'isOverlay()',
    '[style.width.px]': 'isOverlay() ? null : widthPx()',
    'data-testid': 'display-dock',
  },
  styles: `
    .dd-tab { height: 1.75rem; }
    .dd-tab:focus-visible,
    .dd-icon-btn:focus-visible {
      outline: 2px solid oklch(var(--bc));
      outline-offset: 2px;
    }
    .dd-icon-btn { width: 1.75rem; height: 1.75rem; }
    .dd-new-dot { width: 0.5rem; height: 0.5rem; border-radius: 9999px; background: oklch(var(--s)); }
  `,
  template: `
    <aside class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Display panel">
      <div
        class="flex shrink-0 items-center gap-2 border-b border-base-content/15 px-2 py-1.5"
      >
        <div
          class="flex min-w-0 items-center gap-0.5 rounded-full bg-base-300/70 p-0.5"
          role="tablist"
          aria-label="Display panel sections"
          data-testid="display-dock-tablist"
        >
          @for (tab of tabs; track tab) {
            <button
              type="button"
              role="tab"
              class="dd-tab inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 text-xs text-base-content"
              [class.bg-base-100]="state().activeTab === tab"
              [class.shadow-sm]="state().activeTab === tab"
              [class.font-semibold]="state().activeTab === tab"
              [id]="tabElementId(tab)"
              [attr.aria-selected]="state().activeTab === tab"
              [attr.aria-controls]="panelElementId(tab)"
              [attr.tabindex]="state().activeTab === tab ? 0 : -1"
              [attr.data-tab]="tab"
              (click)="selectTab(tab)"
              (keydown)="onTabKeydown($event, tab)"
              data-testid="display-dock-tab"
            >
              @if (hasNew(tab)) {
                <span class="sr-only">New: </span>
                <span
                  class="dd-new-dot shrink-0"
                  aria-hidden="true"
                  data-testid="display-dock-tab-new"
                ></span>
              }
              @if (tab === 'displays') {
                Displays ({{ state().surfaces.length }})
              } @else {
                Agents ({{ agents().length }})
                @if (runningCount() > 0) {
                  <span class="sr-only">, {{ runningCount() }} running</span>
                }
              }
            </button>
          }
        </div>
        <div class="ml-auto flex items-center gap-1">
          <button
            type="button"
            class="dd-icon-btn btn btn-ghost btn-square btn-xs"
            aria-label="Pin panel"
            [attr.aria-pressed]="state().pinned"
            [class.text-primary]="state().pinned"
            [title]="state().pinned ? 'Unpin panel' : 'Pin panel'"
            (click)="togglePin()"
            data-testid="display-dock-pin"
          >
            <lucide-angular [img]="PinIcon" class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            #closeButton
            type="button"
            class="dd-icon-btn btn btn-ghost btn-square btn-xs"
            aria-label="Close panel"
            title="Close panel"
            (click)="closed.emit()"
            data-testid="display-dock-close"
          >
            <lucide-angular [img]="CloseIcon" class="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div
        role="tabpanel"
        class="flex min-h-0 min-w-0 flex-1 flex-col"
        [id]="panelElementId('displays')"
        [attr.aria-labelledby]="tabElementId('displays')"
        [hidden]="state().activeTab !== 'displays'"
        data-testid="display-dock-displays"
      >
        <ptah-display-panel
          class="min-h-0 flex-1"
          [surfaces]="state().surfaces"
          [summary]="summary()?.model ?? null"
          [selectedKey]="selectedKey()"
          [pinned]="state().pinned"
          [viewStates]="state().viewStates"
          [actionError]="actionError()"
          (selectedKeyChange)="onSelectedKeyChange($event)"
          (viewStateChange)="onViewStateChange($event)"
          (openFile)="onOpenFile($event)"
          (review)="onReview()"
        />
      </div>

      <div
        role="tabpanel"
        class="flex min-h-0 min-w-0 flex-1 flex-col"
        [id]="panelElementId('agents')"
        [attr.aria-labelledby]="tabElementId('agents')"
        [hidden]="state().activeTab !== 'agents'"
        data-testid="display-dock-agents"
      >
        <ptah-agent-monitor-panel
          class="flex min-h-0 flex-1 flex-col"
          [docked]="true"
          [embeddedAgents]="agents()"
          [embeddedOpen]="state().open"
          [sessionId]="sessionId()"
        />
      </div>
    </aside>
  `,
})
export class DisplayDockComponent {
  private readonly dock = inject(DisplayDockState);
  private readonly actions = inject(ChangeSetActionsService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** The chat tab this dock shows. */
  readonly tabId = input.required<string>();
  /** The host is below the overlay breakpoint: the dock covers the chat. */
  readonly isOverlay = input(false);
  /** The dock width beside the chat, already clamped by ChatView. */
  readonly widthPx = input<number | null>(null);
  /** The session's agents, as ChatView scopes them for the monitor. */
  readonly agents = input<MonitoredAgent[]>([]);
  /** The monitor's session scope (`null` on the unscoped main panel). */
  readonly sessionId = input<string | null>(null);
  /** Increments when the user opens the dock as an overlay. */
  readonly focusRequest = input(0);

  /** The user closed the dock (header close button). */
  readonly closed = output<void>();

  protected readonly PinIcon = Pin;
  protected readonly CloseIcon = X;
  protected readonly tabs = DOCK_TABS;

  private readonly instance = nextDisplayDockInstance++;
  private readonly closeButton =
    viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private handledFocusRequest = 0;

  protected readonly state = computed(() => this.dock.tab(this.tabId()));
  protected readonly summary = computed(() =>
    this.dock.summaryFor(this.tabId()),
  );

  /** The store selection as the panel's single strip key (decision #102). */
  protected readonly selectedKey = computed((): string | null => {
    const selection = this.state().selection;
    if (selection === null) return null;
    return selection.kind === 'summary'
      ? DISPLAY_PANEL_SUMMARY_KEY
      : selection.surfaceKey;
  });

  protected readonly runningCount = computed(
    () => this.agents().filter((agent) => agent.status === 'running').length,
  );

  /** Highest `updatedSeq` the user saw on the Displays tab, per chat tab. */
  private readonly seenDisplaySeq = signal<ReadonlyMap<string, number>>(
    new Map(),
  );
  private readonly latestDisplaySeq = computed(() =>
    this.state().surfaces.reduce(
      (latest, surface) => Math.max(latest, surface.updatedSeq),
      0,
    ),
  );

  /** The last failed summary action, kept for the tab it ran in. */
  private readonly actionFailure = signal<{
    readonly tabId: string;
    readonly message: string;
  } | null>(null);
  protected readonly actionError = computed(() => {
    const failure = this.actionFailure();
    return failure !== null && failure.tabId === this.tabId()
      ? failure.message
      : null;
  });

  constructor() {
    // An open Displays tab shows its surfaces: record them as seen.
    effect(() => {
      const tabId = this.tabId();
      const state = this.state();
      const latest = this.latestDisplaySeq();
      if (!state.open || state.activeTab !== 'displays') return;
      untracked(() => {
        if ((this.seenDisplaySeq().get(tabId) ?? 0) >= latest) return;
        this.seenDisplaySeq.update((seen) => new Map(seen).set(tabId, latest));
      });
    });

    // Only a user open in overlay mode moves focus (R1.2); an auto-open never
    // does (R1.7), because it does not raise `focusRequest`.
    afterRenderEffect(() => {
      const request = this.focusRequest();
      const button = this.closeButton();
      if (request <= this.handledFocusRequest || !button) return;
      if (!this.state().open || !this.isOverlay()) return;
      this.handledFocusRequest = request;
      button.nativeElement.focus();
    });
  }

  protected tabElementId(tab: DisplayDockTab): string {
    return `display-dock-${this.instance}-tab-${tab}`;
  }

  protected panelElementId(tab: DisplayDockTab): string {
    return `display-dock-${this.instance}-panel-${tab}`;
  }

  protected hasNew(tab: DisplayDockTab): boolean {
    if (this.state().activeTab === tab) return false;
    if (tab === 'agents') return this.runningCount() > 0;
    return (
      this.latestDisplaySeq() >
      (this.seenDisplaySeq().get(this.tabId()) ?? 0)
    );
  }

  protected selectTab(tab: DisplayDockTab): void {
    this.dock.selectTab(this.tabId(), tab);
  }

  /** Two tabs: every arrow wraps to the other one; Home and End are fixed. */
  protected onTabKeydown(event: KeyboardEvent, tab: DisplayDockTab): void {
    const index = DOCK_TABS.indexOf(tab);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = (index + 1) % DOCK_TABS.length;
        break;
      case 'ArrowLeft':
        next = (index - 1 + DOCK_TABS.length) % DOCK_TABS.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = DOCK_TABS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = DOCK_TABS[next];
    this.selectTab(target);
    this.host.nativeElement
      .querySelector<HTMLElement>(`#${this.tabElementId(target)}`)
      ?.focus();
  }

  protected togglePin(): void {
    const tabId = this.tabId();
    this.dock.setPinned(tabId, !this.dock.tab(tabId).pinned);
  }

  protected onSelectedKeyChange(key: string): void {
    this.dock.select(
      this.tabId(),
      key === DISPLAY_PANEL_SUMMARY_KEY
        ? { kind: 'summary' }
        : { kind: 'surface', surfaceKey: key },
    );
  }

  protected onViewStateChange(change: DisplayPanelViewStateChange): void {
    this.dock.setViewState(this.tabId(), change.surfaceKey, change.viewState);
  }

  protected onOpenFile(path: string): void {
    void this.runSummaryAction((changeSet) =>
      this.actions.openFile(changeSet, path),
    );
  }

  protected onReview(): void {
    void this.runSummaryAction((changeSet) => this.actions.review(changeSet));
  }

  /**
   * Runs a summary action on the shown summary's change set (#101). A turn
   * without one, or a rejection, leaves its text inline in the summary.
   */
  private async runSummaryAction(
    action: (changeSet: TurnChangeSet) => Promise<void>,
  ): Promise<void> {
    const tabId = this.tabId();
    const changeSet = this.dock.summaryFor(tabId)?.changeSet ?? null;
    this.actionFailure.set(null);
    if (changeSet === null) {
      this.actionFailure.set({ tabId, message: NO_CHANGE_SET_TEXT });
      return;
    }
    try {
      await action(changeSet);
    } catch (error: unknown) {
      this.actionFailure.set({
        tabId,
        message:
          error instanceof Error && error.message
            ? error.message
            : ACTION_FAILED_TEXT,
      });
    }
  }
}
