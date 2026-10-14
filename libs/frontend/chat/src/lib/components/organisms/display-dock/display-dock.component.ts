import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterRenderEffect,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, Pin, X } from 'lucide-angular';
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
import { DisplayDockState } from '../../../services/display-dock/display-dock.state';
import { ChangeSetActionsService } from '../../../services/change-set/change-set-actions.service';

/** Shown when a summary action runs on a turn with no recorded change set. */
const NO_CHANGE_SET_TEXT = 'This turn has no recorded file changes to open.';

/** The actions service rejects with a user-facing `Error`; anything else. */
const ACTION_FAILED_TEXT = 'The review action failed.';

/** Per-chat-tab display dock. Pin, close, resize and display selection stay in DisplayDockState. */
@Component({
  selector: 'ptah-display-dock',
  standalone: true,
  imports: [LucideAngularModule, DisplayPanelComponent],
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
    .dd-icon-btn:focus-visible {
      outline: 2px solid oklch(var(--bc));
      outline-offset: 2px;
    }
    .dd-icon-btn { width: 1.75rem; height: 1.75rem; }
  `,
  template: `
    <aside class="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Display panel">
      <div
        class="flex shrink-0 items-center gap-2 border-b border-base-content/15 px-2 py-1.5"
      >
        <h2 class="min-w-0 text-xs font-semibold text-base-content" data-testid="display-dock-heading">Displays ({{ state().surfaces.length }})</h2>
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

      <div role="region" aria-label="Displays" class="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="display-dock-displays">
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

    </aside>
  `,
})
export class DisplayDockComponent {
  private readonly dock = inject(DisplayDockState);
  private readonly actions = inject(ChangeSetActionsService);

  /** The chat tab this dock shows. */
  readonly tabId = input.required<string>();
  /** The host is below the overlay breakpoint: the dock covers the chat. */
  readonly isOverlay = input(false);
  /** The dock width beside the chat, already clamped by ChatView. */
  readonly widthPx = input<number | null>(null);
  /** Increments when the user opens the dock as an overlay. */
  readonly focusRequest = input(0);

  /** The user closed the dock (header close button). */
  readonly closed = output<void>();

  protected readonly PinIcon = Pin;
  protected readonly CloseIcon = X;

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
