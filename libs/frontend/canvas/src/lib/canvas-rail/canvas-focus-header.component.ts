import {
  ChangeDetectionStrategy,
  Component,
  DoCheck,
  ElementRef,
  computed,
  type OutputEmitterRef,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  SendToMessagingComponent,
  WorkflowBadgeComponent,
  TabManagerService,
} from '@ptah-extension/chat';
import { ContextRingComponent, limitAwareDot, type CompactRailState, type SessionLimitSummary } from '@ptah-extension/chat-ui';
import type { TabViewMode } from '@ptah-extension/chat-types';
import { Ellipsis, LucideAngularModule, Maximize2, Minimize2, PanelRight, X } from 'lucide-angular';
import { CanvasLayoutService } from '../canvas-layout.service';

let nextDetailsDescriptionId = 0;

@Component({
  selector: 'ptah-canvas-focus-header',
  standalone: true,
  imports: [SendToMessagingComponent, WorkflowBadgeComponent, ContextRingComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .state-running {
        color: var(--state-ink-run, oklch(var(--in)));
      }
      .state-needs {
        color: var(--state-ink-need, oklch(var(--wa)));
      }
      .state-error {
        color: var(--state-ink-err, oklch(var(--er)));
      }
      .state-done {
        color: var(--state-ink-done, oklch(var(--su)));
      }
      .state-idle {
        color: var(--state-ink-idle, oklch(var(--bc)));
      }
      /*
     * Split only: the active pane's accent, at least 3:1 on the base-100 header in both
     * first-party themes. anubis primary #2563eb is 3.59:1 on base-100, its content ink 4.82:1
     * on it. anubis-light primary teal is 1.40:1 on its cream, so that theme inverts the pair:
     * the deep teal primary-content is 9.59:1 on base-100 and primary is 6.84:1 on it.
     */
      :host {
        --pane-accent: oklch(var(--p));
        --pane-accent-ink: oklch(var(--pc));
      }
      :host-context([data-theme='anubis-light']) {
        --pane-accent: oklch(var(--pc));
        --pane-accent-ink: oklch(var(--p));
      }
      /* The active pane's top bar. Inset, so the 48 px height is unchanged. */
      .pane-active {
        box-shadow: inset 0 2px 0 0 var(--pane-accent);
      }
      .pane-marker-active {
        background-color: var(--pane-accent);
        color: var(--pane-accent-ink);
      }
      /*
     * The inactive pane's secondary-text tier. The app's global anubis-light rule
     * "[data-theme='anubis-light'] .truncate" (0,2,0) beats the utility (0,1,0) and kept the quiet
     * title and chips at full base-content, so this scoped rule restates the muted token.
     * Same value as text-base-content-muted: 6.03:1 / 6.06:1 on base-100, 5.39:1 / 5.66:1 on base-200.
     */
      .pane-quiet .text-base-content-muted {
        color: oklch(var(--bcm, var(--bc)));
      }
      .details-dot {
        position: absolute;
        top: 2px;
        right: 2px;
        width: 7px;
        height: 7px;
        border-radius: 9999px;
        box-shadow: 0 0 0 2px oklch(var(--b1));
        pointer-events: none;
      }
      [data-dot='need'] > .details-dot {
        background-color: var(--state-ink-need, oklch(var(--wa)));
      }
      [data-dot='err'] > .details-dot {
        background-color: var(--state-ink-err, oklch(var(--er)));
      }
      [data-limit='near'] {
        border-color: color-mix(in oklch, var(--state-ink-need, oklch(var(--wa))) 55%, transparent);
      }
      [data-limit='at'] {
        border-color: color-mix(in oklch, var(--state-ink-err, oklch(var(--er))) 55%, transparent);
      }
      /* Glass on (any theme): the title row is part of the chat column's one glass
         surface (see styles.css "Ptah chat column"), so no fill and no rule
         under it. The split pane-active inset bar is a box-shadow and stays. */
      :host-context([data-theme][data-glass='on']) > header {
        background-color: transparent;
        border-bottom-color: transparent;
      }
    `,
  ],
  template: `
    <header
      class="relative flex h-12 min-w-0 items-center gap-2 overflow-visible border-b border-base-content/10 bg-base-100 px-3 whitespace-nowrap"
      [class.pane-active]="splitDisplayed() && paneFocused()"
      [class.pane-quiet]="quiet()"
      [attr.data-pane-active]="splitDisplayed() ? paneFocused() : null"
      (keydown.escape)="escape($event)"
    >
      @if (splitDisplayed() && paneNumber()) {
        <span
          data-pane-marker
          class="inline-flex size-5 shrink-0 items-center justify-center rounded text-xs font-semibold"
          [class.pane-marker-active]="paneFocused()"
          [class.bg-base-200]="!paneFocused()"
          [class.text-base-content-muted]="!paneFocused()"
          ><span aria-hidden="true">{{ paneNumber() }}</span
          ><span class="sr-only"
            >{{ panePlace() }} pane {{ paneNumber() }}</span
          ></span
        >
      }
      <strong
        class="min-w-0 flex-1 truncate text-sm"
        [class.text-base-content-muted]="quiet()"
        [title]="title()"
        >{{ title() }}</strong
      >
      <ptah-workflow-badge [workflow]="workflow()" />
      @if (branch()) {
        <span
          class="max-w-[170px] truncate rounded bg-base-200 px-1.5 text-xs"
          [class.text-base-content-muted]="quiet()"
          [title]="branch()!"
          >{{ branch() }}</span
        >
      }
      <span
        class="rounded bg-base-200 px-1.5 text-xs"
        [class.state-running]="state() === 'running'"
        [class.state-needs]="state() === 'needs'"
        [class.state-error]="state() === 'error'"
        [class.state-done]="state() === 'done'"
        [class.state-idle]="state() === 'idle'"
        >{{ state() }}</span
      >
      @if (running()) {
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          data-stop
          aria-label="Stop session"
          title="Stop session"
          (click)="stop.emit()"
        >
          ■
          @if (!narrow()) {
            Stop
          }
        </button>
      }
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
        data-compact
        [attr.aria-label]="
          viewMode() === 'full'
            ? 'Switch to compact view'
            : 'Switch to full view'
        "
        [attr.title]="
          viewMode() === 'full'
            ? 'Switch to compact view'
            : 'Switch to full view'
        "
        (click)="toggleViewMode.emit()"
      >
        <lucide-angular [img]="viewMode() === 'full' ? Minimize2Icon : Maximize2Icon" class="size-4" aria-hidden="true" />
      </button>
      @if (splitDisplayed() || compactDetails()) {
        @if (shownLimit(); as limit) {
          <span
            role="status"
            class="inline-flex h-[22px] shrink-0 items-center rounded-md border px-2 text-[11px] font-medium"
            [class.text-state-need]="limit.state === 'near'"
            [class.text-state-err]="limit.state === 'at'"
            [attr.data-limit]="limit.state"
            [attr.title]="limit.fullText"
          >
            {{ limit.state === 'at' ? 'At limit' : 'Limit near' }}
            @if (limit.fullText) { <span class="sr-only">: {{ limit.fullText }}</span> }
          </span>
        }
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square relative focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
          data-details
          aria-label="Open details"
          title="Session details"
          aria-haspopup="dialog"
          [attr.aria-expanded]="detailsOpen()"
          [attr.aria-describedby]="shownDescription() ? descriptionId : null"
          [attr.data-dot]="detailsDot()"
          (click)="detailsRequested.emit()"
        >
          @if (detailsDot()) { <span class="details-dot" aria-hidden="true"></span> }
          @let percent = shownRingPercent();
          @if (percent !== null) {
            <ptah-context-ring class="pointer-events-none absolute inset-0" [percent]="percent" [size]="28" />
          }
          <lucide-angular [img]="PanelRightIcon" class="size-4" aria-hidden="true" />
        </button>
        @if (shownDescription()) {
          <span class="sr-only" [id]="descriptionId">{{ shownDescription() }}</span>
        }
      }
      <button
        #overflow
        type="button"
        class="btn btn-ghost btn-xs btn-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
        data-header-menu
        aria-label="More session actions"
        title="More session actions"
        aria-haspopup="menu"
        [attr.aria-expanded]="menuOpen()"
        (click)="menuOpen.set(!menuOpen())"
      >
        <lucide-angular [img]="EllipsisIcon" class="size-4" aria-hidden="true" />
      </button>
      @if (menuOpen()) {
        <div
          role="menu"
          aria-label="Session actions"
          class="absolute right-10 top-10 z-20 flex flex-col gap-0.5 rounded-lg border border-base-content/10 bg-base-200 p-2 shadow-lg"
        >
          <div role="menuitem">
            <ptah-send-to-messaging [tabId]="tabId()" />
          </div>
          @if (splitDisplayed()) {
            <button
              type="button"
              role="menuitem"
              data-action="swap-panes"
              class="btn btn-ghost btn-sm justify-start font-normal"
              (click)="choose(swapPanesRequested)"
            >
              Swap panes
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="close-pane"
              class="btn btn-ghost btn-sm justify-start font-normal"
              (click)="choose(closePaneRequested)"
            >
              Close pane
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="close-split"
              class="btn btn-ghost btn-sm justify-start font-normal"
              (click)="choose(closeSplitRequested)"
            >
              Close split
            </button>
          }
        </div>
      }
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-square focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-base-content"
        aria-label="Close session"
        title="Close session"
        (click)="closeRequested.emit()"
      >
        <lucide-angular [img]="XIcon" class="size-4" aria-hidden="true" />
      </button>
    </header>
  `,
})
export class CanvasFocusHeaderComponent implements DoCheck {
  private readonly tabs = inject(TabManagerService);
  private readonly layout = inject(CanvasLayoutService, { optional: true });
  readonly workflow = computed(
    () => this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.tab.workflow,
  );
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly tabId = input.required<string>();
  readonly title = input('');
  readonly branch = input<string | null>(null);
  readonly Minimize2Icon = Minimize2;
  readonly Maximize2Icon = Maximize2;
  readonly EllipsisIcon = Ellipsis;
  readonly PanelRightIcon = PanelRight;
  readonly XIcon = X;
  readonly state = input<CompactRailState>('idle');
  readonly running = input(false);
  readonly viewMode = input<TabViewMode>('full');
  readonly band = input<'xl' | 'lg' | 'md' | 'sm'>('lg');
  readonly compactDetails = computed(() => {
    const width = this.layout?.containerWidth() ?? 0;
    return width > 0 && width < 400;
  });
  /** Two panes are shown: the header offers Details and the split actions. */
  readonly splitDisplayed = input(false);
  /** The split Details overlay is open on this pane (drives `aria-expanded`). */
  readonly detailsOpen = input(false);
  readonly limitCue = input<SessionLimitSummary | null>(null);
  readonly contextRingPercent = input<number | null>(null);
  readonly toggleDescription = input('');
  readonly descriptionId = `rail-details-description-${++nextDetailsDescriptionId}`;
  readonly shownLimit = computed(() => {
    const cue = this.limitCue();
    return !this.detailsOpen() && cue?.state !== 'none' ? cue : null;
  });
  readonly shownRingPercent = computed(() => this.detailsOpen() ? null : this.contextRingPercent());
  readonly shownDescription = computed(() => this.detailsOpen() ? '' : this.toggleDescription());
  readonly detailsDot = computed(() => limitAwareDot(null, this.detailsOpen(), this.limitCue()));
  /** Split only: this pane is the active one (accent) or not (quiet). */
  readonly paneFocused = input(true);
  /** Split only: the pane's visual position, 1 for left/top, 2 for right/bottom. */
  readonly paneNumber = input<1 | 2 | null>(null);
  /** Split only: the positional word the pane's own label uses (Left, Right, Top, Bottom). */
  readonly panePlace = input('');
  readonly stop = output<void>();
  readonly toggleViewMode = output<void>();
  readonly closeRequested = output<void>();
  readonly closeSplitRequested = output<void>();
  readonly closePaneRequested = output<void>();
  readonly swapPanesRequested = output<void>();
  readonly detailsRequested = output<void>();
  readonly menuOpen = signal(false);
  /** A split pane is at most half the board, so it drops button words like a narrow band. */
  readonly narrow = () =>
    this.band() === 'md' || this.band() === 'sm' || this.splitDisplayed();
  /** The inactive split pane mutes its title and meta chips to the measured secondary-text tier. */
  readonly quiet = () => this.splitDisplayed() && !this.paneFocused();
  private wasRunning = false;

  ngDoCheck(): void {
    if (this.wasRunning && !this.running()) {
      const stop =
        this.host.nativeElement.querySelector<HTMLElement>('[data-stop]');
      if (stop && stop === stop.ownerDocument.activeElement)
        this.host.nativeElement
          .querySelector<HTMLElement>('[data-compact]')
          ?.focus();
    }
    this.wasRunning = this.running();
  }

  /**
   * Escape anywhere in the header (the still-focused trigger, a menu item, or
   * another header control) closes an open menu first and is consumed there,
   * so no pane or board handler sees it. With the menu closed it passes through.
   */
  escape(event: Event): void {
    if (!this.menuOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    this.menuOpen.set(false);
    this.focusTrigger();
  }

  /**
   * Closes the menu and returns focus to its trigger before emitting, so a
   * board that then removes this header finds focus to repair.
   */
  choose(action: OutputEmitterRef<void>): void {
    this.menuOpen.set(false);
    this.focusTrigger();
    action.emit();
  }

  private focusTrigger(): void {
    this.host.nativeElement
      .querySelector<HTMLButtonElement>('[data-header-menu]')
      ?.focus();
  }
}
