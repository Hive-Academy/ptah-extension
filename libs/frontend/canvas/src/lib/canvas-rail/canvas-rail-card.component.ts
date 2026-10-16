import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CompactSessionCardComponent,
  SESSION_CARD_ACTIONS,
  SESSION_FORCED_CARD,
  TabManagerService,
  SessionOrganizerService,
  SessionRowActionsService,
  SESSION_NAME_MAX_LENGTH,
  WorkflowBadgeComponent,
  type SessionCardActions,
} from '@ptah-extension/chat';
import {
  COMPACT_RAIL_CARD_HEIGHT,
  type CompactRailDensity,
  type CompactRailState,
} from '@ptah-extension/chat-ui';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { isIgnoredCardClick } from '../canvas-card-click';
import { railMoveKey } from './canvas-rail-keyboard';

/** B6: the board has fewer than two sessions, so there is nothing to split with. */
export const SPLIT_NEEDS_TWO_SESSIONS_REASON =
  'Open another session first to split';
/** B6: the card's session is the one already shown in the focused pane. */
export const SPLIT_ALREADY_FOCUSED_REASON =
  'This session is already in the focused pane';

@Component({
  // A native li keeps the rail's role=list semantics without a wrapper node.
  // eslint-disable-next-line @angular-eslint/component-selector
  selector: 'li[ptah-canvas-rail-card]',
  standalone: true,
  imports: [
    CompactSessionCardComponent,
    NativePopoverComponent,
    WorkflowBadgeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: SESSION_CARD_ACTIONS,
      useExisting: forwardRef(() => CanvasRailCardComponent),
    },
    { provide: SESSION_FORCED_CARD, useFactory: () => signal(true) },
  ],
  host: {
    'data-rail-card': '',
    '[attr.data-tab-id]': 'tabId()',
    '[attr.data-state]': 'state()',
    '[style.height.px]':
      'collapsed() ? 56 : cardHeight() + (tab()?.workflow ? 20 : 0)',
    // The host click is a pointer shortcut; its keyboard equivalent is the
    // card's select button (or the collapsed button), so the li stays a listitem.
    role: 'listitem',
    class: 'flex relative cursor-pointer',
    '[class.flex-col]': '!collapsed() && !!tab()?.workflow',
    '(click)': 'onClick($event)',
    '(keydown)': 'onKeydown($event)',
  },
  styles: [
    `
      :host {
        --rail-state-ink: var(--state-ink-idle, oklch(var(--bc)));
      }
      :host([data-state='running']) {
        --rail-state-ink: var(--state-ink-run, oklch(var(--in)));
      }
      :host([data-state='needs']) {
        --rail-state-ink: var(--state-ink-need, oklch(var(--wa)));
      }
      :host([data-state='error']) {
        --rail-state-ink: var(--state-ink-err, oklch(var(--er)));
      }
      :host([data-state='done']) {
        --rail-state-ink: var(--state-ink-done, oklch(var(--su)));
      }
      :host(:has(.rc-select:focus-visible)) {
        outline: 2px solid var(--ring, oklch(var(--bc)));
        outline-offset: 2px;
      }
      /* The collapsed li fills the 56 px rail, so its rings sit inside. */
      .rail-collapsed:focus-visible,
      .rail-actions-trigger:focus-visible {
        outline: 2px solid var(--ring, oklch(var(--bc)));
        outline-offset: -2px;
      }
      /* Paint-only hover: the 56 px collapsed control never changes size. */
      .rail-collapsed:hover {
        border-color: var(--rail-state-ink);
      }
    `,
  ],
  template: `
    @if (tab(); as current) {
      @if (collapsed()) {
        <ptah-compact-session-card
          style="display: none"
          aria-hidden="true"
          [tab]="current"
          variant="rail"
          [density]="density()"
          [focused]="false"
          [holdText]="holdText()"
          (railState)="onRailState($event)"
        />
        <button
          type="button"
          class="rail-collapsed flex h-14 w-8 shrink-0 items-center justify-center gap-1 rounded-lg border border-base-content/10 bg-base-200 text-xs"
          [attr.aria-label]="
            current.title + ', ' + state() + (focused() ? ', in focus' : '')
          "
          [attr.aria-current]="focused() ? 'true' : null"
          [attr.title]="current.title + ', ' + state()"
          [tabIndex]="focused() ? 0 : -1"
          (click)="openSession()"
        >
          <span
            class="h-2 w-2 rounded-full"
            [style.background]="'var(--rail-state-ink)'"
          ></span
          >{{ index() }}
        </button>
      } @else {
        @if (current.workflow) {
          <ptah-workflow-badge
            class="ml-4 shrink-0 self-start"
            [workflow]="current.workflow"
          />
        }
        <ptah-compact-session-card
          class="min-w-0 flex-1"
          [tab]="current"
          variant="rail"
          [density]="density()"
          [focused]="focused()"
          [holdText]="holdText()"
          [reserveActionCorner]="true"
          (expandToFull)="openSession()"
          (railState)="onRailState($event)"
          (staleAction)="onStaleAction()"
          (lanesRequested)="lanesRequested.emit(tabId())"
        />
      }
      <!-- Expanded: the full-width card's top-right corner, 6 px inside its
           frame over the title line it reserves; a sibling of the card, so it
           is never inside its select button and never clipped by it.
           Collapsed: the 24 px second cell after the 32 px select button. -->
      <div
        #actions
        data-rail-actions
        [class]="
          collapsed()
            ? 'flex w-6 shrink-0 items-center justify-center'
            : tab()?.workflow
              ? 'absolute right-1.5 top-[26px] z-10 flex'
              : 'absolute right-1.5 top-1.5 z-10 flex'
        "
      >
        <!-- A block trigger wrapper adds no inline baseline gap to the cell. -->
        <ptah-native-popover
          class="[&>.popover-trigger]:block"
          [isOpen]="renameOpen()"
          placement="right-start"
          [hasBackdrop]="true"
          backdropClass="transparent"
          (opened)="onRenameOpened()"
          (closed)="cancelRename()"
        >
          <div trigger>
        <ptah-native-popover
          class="[&>.popover-trigger]:block"
          [isOpen]="menuOpen()"
          placement="right-start"
          [hasBackdrop]="true"
          backdropClass="transparent"
          (opened)="onMenuOpened()"
          (closed)="closeMenu()"
        >
          <button
            #trigger
            trigger
            type="button"
            class="rail-actions-trigger flex w-6 items-center justify-center rounded-md text-base-content-muted hover:bg-base-content/10 hover:text-base-content"
            [class.h-6]="!collapsed()"
            [class.h-14]="collapsed()"
            aria-label="Session actions"
            title="Session actions"
            aria-haspopup="menu"
            [attr.aria-expanded]="menuOpen()"
            [tabIndex]="focused() ? 0 : -1"
            (click)="menuOpen.set(!menuOpen())"
          >
            <span aria-hidden="true">⋮</span>
          </button>
          <div
            content
            role="menu"
            aria-label="Session actions"
            class="flex w-60 flex-col gap-0.5"
            (keydown)="onMenuKeydown($event)"
          >
            <button
              type="button"
              role="menuitem"
              data-action="open-beside"
              class="btn btn-ghost btn-sm h-auto min-h-8 flex-col items-start justify-center py-1 text-left font-normal"
              [class.opacity-60]="!!splitDisabledReason()"
              [attr.aria-disabled]="splitDisabledReason() ? 'true' : null"
              [attr.aria-describedby]="
                splitDisabledReason() ? reasonId() : null
              "
              [attr.title]="splitDisabledReason()"
              (click)="openBeside()"
            >
              <span>Open beside</span>
              @if (splitDisabledReason(); as reason) {
                <span
                  aria-hidden="true"
                  class="text-xs text-base-content-muted"
                  [id]="reasonId()"
                  >{{ reason }}</span
                >
              }
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="rename"
              class="btn btn-ghost btn-sm h-auto min-h-8 flex-col items-start justify-center py-1 text-left font-normal"
              aria-haspopup="dialog"
              [attr.aria-disabled]="sessionId() ? null : 'true'"
              [attr.aria-describedby]="sessionId() ? null : 'rail-rename-reason-' + tabId()"
              (click)="startRename()"
            >
              <span>Rename</span>
              @if (!sessionId()) { <span [id]="'rail-rename-reason-' + tabId()" aria-hidden="true" class="text-xs text-base-content-muted">{{ draftReason }}</span> }
            </button>
            @if (organizer.available()) {
              <button
                type="button"
                role="menuitem"
                data-action="organize"
                class="btn btn-ghost btn-sm h-auto min-h-8 flex-col items-start justify-center py-1 text-left font-normal"
                [attr.aria-disabled]="sessionId() ? null : 'true'"
                [attr.aria-describedby]="sessionId() ? null : 'rail-organize-reason-' + tabId()"
                (click)="startOrganize()"
              >
                <span>Organize</span>
                @if (!sessionId()) { <span [id]="'rail-organize-reason-' + tabId()" aria-hidden="true" class="text-xs text-base-content-muted">{{ draftReason }}</span> }
              </button>
            }
            <div role="separator" class="my-1 border-t border-base-content/10"></div>
            <button
              type="button"
              role="menuitem"
              data-action="move-up"
              class="btn btn-ghost btn-sm justify-start font-normal"
              [class.opacity-60]="!canMoveUp()"
              [attr.aria-disabled]="canMoveUp() ? null : 'true'"
              (click)="moveUp()"
            >
              Move up
            </button>
            <button
              type="button"
              role="menuitem"
              data-action="move-down"
              class="btn btn-ghost btn-sm justify-start font-normal"
              [class.opacity-60]="!canMoveDown()"
              [attr.aria-disabled]="canMoveDown() ? null : 'true'"
              (click)="moveDown()"
            >
              Move down
            </button>
          </div>
        </ptah-native-popover>
          </div>
          <div content class="w-72 p-3" role="dialog" aria-label="Rename session">
            <h3 class="mb-2 text-sm font-semibold">Rename session</h3>
            <input #renameInput type="text" class="input input-bordered w-full" aria-label="Session name" [maxLength]="nameMaxLength" [value]="renameDraft()" (input)="renameDraft.set(renameInput.value)" (keydown.enter)="saveRename()" />
            <div class="mt-3 flex justify-end gap-2">
              <button type="button" class="btn btn-ghost btn-sm" (click)="cancelRename()">Cancel</button>
              <button type="button" class="btn btn-primary btn-sm" (click)="saveRename()">Save</button>
            </div>
          </div>
        </ptah-native-popover>
      </div>
    }
    <span class="sr-only" aria-live="polite">{{ announcement() }}</span>
  `,
})
export class CanvasRailCardComponent implements SessionCardActions {
  private readonly tabs = inject(TabManagerService);
  private readonly canvasStore = inject(CanvasStore);
  private readonly detail = inject(CanvasDetailService);
  readonly organizer = inject(SessionOrganizerService);
  private readonly rowActions = inject(SessionRowActionsService);
  private readonly injector = inject(Injector);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly actions = viewChild<ElementRef<HTMLElement>>('actions');
  private readonly trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
  readonly tabId = input.required<string>();
  readonly density = input<CompactRailDensity>('comfortable');
  readonly focused = input(false);
  readonly collapsed = input(false);
  readonly index = input(1);
  readonly holdText = input(false);
  readonly state = input<CompactRailState>('idle');
  readonly canMoveUp = input(false);
  readonly canMoveDown = input(false);
  /** Why Open beside is unavailable for this card; null when it is available. */
  readonly splitDisabledReason = input<string | null>(null);
  readonly focusRequested = output<string>();
  readonly railState = output<CompactRailState>();
  readonly staleAction = output<string>();
  readonly lanesRequested = output<string>();
  readonly openBesideRequested = output<string>();
  readonly moveUpRequested = output<string>();
  readonly moveDownRequested = output<string>();
  readonly announcement = signal('');
  readonly menuOpen = signal(false);
  readonly renameOpen = signal(false);
  readonly renameDraft = signal('');
  readonly nameMaxLength = SESSION_NAME_MAX_LENGTH;
  readonly draftReason = 'Send a first message to save this session.';
  readonly cardHeight = computed(
    () => COMPACT_RAIL_CARD_HEIGHT[this.density()],
  );
  readonly tab = computed(
    () => this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.tab ?? null,
  );
  readonly sessionId = computed(() => this.tab()?.claudeSessionId ?? null);
  readonly reasonId = computed(() => `rail-split-reason-${this.tabId()}`);

  openLane(key: string): void {
    this.detail.open(this.tabId(), key);
  }
  openSession(): void {
    this.canvasStore.focusTile(this.tabId());
    this.focusRequested.emit(this.tabId());
  }
  onRailState(state: CompactRailState): void {
    this.railState.emit(state);
  }
  onStaleAction(): void {
    this.announcement.set(
      'This request has changed. Open the current request.',
    );
    this.staleAction.emit(this.tabId());
  }
  onClick(event: MouseEvent): void {
    // The trigger and menu items are buttons (the interactive-target rule);
    // the corner cell, menu panel and backdrop are action surface, never a select.
    const target = event.target;
    if (
      target instanceof Node &&
      this.actions()?.nativeElement.contains(target)
    )
      return;
    if (!isIgnoredCardClick(event, this.host.nativeElement)) this.openSession();
  }
  onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const onSelect =
      target === this.host.nativeElement ||
      (target instanceof Element &&
        target.matches('.rc-select, .rail-collapsed'));
    const move = railMoveKey(event);
    if (move && onSelect) {
      if (move === 'up' && this.canMoveUp()) {
        this.moveUpRequested.emit(this.tabId());
        event.preventDefault();
      } else if (move === 'down' && this.canMoveDown()) {
        this.moveDownRequested.emit(this.tabId());
        event.preventDefault();
      }
      return;
    }
    if (event.key === 'Enter' && target === this.host.nativeElement) {
      this.openSession();
      event.preventDefault();
    }
  }

  openBeside(): void {
    if (this.splitDisabledReason()) return;
    this.closeMenu();
    this.openBesideRequested.emit(this.tabId());
  }
  moveUp(): void {
    if (!this.canMoveUp()) return;
    this.closeMenu();
    this.moveUpRequested.emit(this.tabId());
  }
  moveDown(): void {
    if (!this.canMoveDown()) return;
    this.closeMenu();
    this.moveDownRequested.emit(this.tabId());
  }
  startRename(): void {
    if (!this.sessionId()) return;
    this.renameDraft.set(this.tab()?.title ?? '');
    this.closeMenu();
    afterNextRender(() => {
      if (!this.menuOpen()) this.renameOpen.set(true);
    }, { injector: this.injector });
  }
  onRenameOpened(): void {
    const input = this.renameInput()?.nativeElement;
    input?.focus();
    input?.select();
  }
  cancelRename(): void {
    this.renameOpen.set(false);
    queueMicrotask(() => this.focusActionTrigger());
  }
  async saveRename(): Promise<void> {
    const id = this.sessionId();
    const current = this.tab();
    if (!id || !current) return;
    await this.rowActions.rename(id, current.title, this.renameDraft());
    this.cancelRename();
  }
  async startOrganize(): Promise<void> {
    const id = this.sessionId();
    const current = this.tab();
    if (!id || !current || !this.organizer.available()) return;
    this.closeMenu();
    const restore = () => queueMicrotask(() => this.focusActionTrigger());
    if (this.organizer.rowFor(id)) {
      this.organizer.open(id, restore);
      return;
    }
    const result = await this.organizer.openForSession(id, current.title, restore);
    if (result === 'failed') this.announcement.set("Could not load this session's organization.");
  }
  private focusActionTrigger(): void {
    const trigger = this.trigger()?.nativeElement;
    if (trigger?.isConnected) trigger.focus();
    else (this.host.nativeElement.querySelector<HTMLElement>('.rail-collapsed')
      ?? this.host.nativeElement.querySelector<HTMLElement>('.rc-select'))?.focus();
  }
  /** Escape, a backdrop click or a chosen item: close and return to the trigger. */
  closeMenu(): void {
    this.menuOpen.set(false);
    this.trigger()?.nativeElement.focus();
  }
  /** A late `opened` after the menu already closed must not pull focus back in. */
  onMenuOpened(): void {
    if (this.menuOpen()) this.focusMenuItem(0);
  }
  focusMenuItem(index: number): void {
    const items = this.menuItems();
    items[(index + items.length) % items.length]?.focus();
  }
  onMenuKeydown(event: KeyboardEvent): void {
    const items = this.menuItems();
    const current = items.findIndex(
      (item) => item === item.ownerDocument.activeElement,
    );
    switch (event.key) {
      case 'ArrowDown':
        this.focusMenuItem(current + 1);
        break;
      case 'ArrowUp':
        this.focusMenuItem(current < 0 ? -1 : current - 1);
        break;
      case 'Home':
        this.focusMenuItem(0);
        break;
      case 'End':
        this.focusMenuItem(-1);
        break;
      default:
        return;
    }
    event.preventDefault();
  }
  private menuItems(): HTMLElement[] {
    return [
      ...(this.actions()?.nativeElement.querySelectorAll<HTMLElement>(
        '[role="menuitem"]',
      ) ?? []),
    ];
  }
}
