import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
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
import type { AttentionItem } from '@ptah-extension/core';
import { CircleAlert, LucideAngularModule } from 'lucide-angular';
import { CanvasStore } from '../canvas.store';
import { CanvasDetailService } from '../canvas-detail/canvas-detail.service';
import { isIgnoredCardClick } from '../canvas-card-click';
import { railMoveKey } from './canvas-rail-keyboard';
import { isPrimaryAttentionAction } from './rail-attention-action';

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
    LucideAngularModule,
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
    '[attr.data-attention-count]': 'attentionItems().length',
    '[attr.data-state]': 'state()',
    '[style.height.px]':
      'collapsed() ? 56 : cardHeight() + (tab()?.workflow ? 20 : 0) + (attentionItems().length ? 88 : 0)',
    // The host click is a pointer shortcut; its keyboard equivalent is the
    // card's select button (or the collapsed button), so the li stays a listitem.
    role: 'listitem',
    class: 'flex relative cursor-pointer',
    '[class.flex-col]': '!collapsed() && (!!tab()?.workflow || !!attentionItems().length)',
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
            current.title + ', ' + (attentionItems().length ? 'Needs you, ' + attentionItems().length : state()) + (focused() ? ', in focus' : '')
          "
          [attr.aria-current]="focused() ? 'true' : null"
          [attr.title]="current.title + ', ' + state()"
          [tabIndex]="focused() ? 0 : -1"
          (click)="openSession()"
        >
          <span
            class="h-2 w-2 rounded-full"
            [style.background]="attentionItems().length ? 'var(--state-ink-need)' : 'var(--rail-state-ink)'"
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
        @if (attentionItems().length) {
          <div class="relative z-10 min-w-0 px-2 pb-1 text-xs" data-testid="rail-card-needs-you">
            <span class="inline-flex items-center gap-1 font-semibold text-state-need"><lucide-angular [img]="needIcon" class="size-3.5" aria-hidden="true" />Needs you</span>
            <span class="ml-1 truncate text-base-content-muted" [title]="attentionItems()[0].detail ?? attentionItems()[0].context ?? attentionItems()[0].title">{{ attentionItems()[0].detail ?? attentionItems()[0].context ?? attentionItems()[0].title }}</span>
            <div class="mt-1 flex flex-wrap gap-1">
              @for (action of attentionItems()[0].actions; track action.id) {
                @if (action.id.toLowerCase() === 'answer' || action.id.toLowerCase() === 'allow' || action.id.toLowerCase() === 'deny' || action.id.toLowerCase() === 'open') {
                  <button type="button" class="btn btn-ghost btn-xs min-h-11" [class.btn-primary]="isPrimaryAttentionAction(attentionItems()[0], action)" [disabled]="!!action.disabledReason || submittingKeys().has(attentionItems()[0].key) || blockedKeys().has(attentionItems()[0].key)"
                    [attr.title]="action.disabledReason ?? null"
                    [attr.aria-describedby]="action.disabledReason ? 'rail-card-attention-reason-' + tabId() : null"
                    [attr.aria-label]="action.label + ' for ' + (attentionItems()[0].sessionTitle ?? current.title) + ' in ' + (attentionItems()[0].workspaceName || 'Workspace unavailable')"
                    (click)="attentionAction.emit({item: attentionItems()[0], actionId: action.id})">{{ action.label }}</button>
                }
              }
              @if (attentionItems().length > 1) { <button type="button" class="btn btn-ghost btn-xs min-h-11" (click)="otherRequests.emit()">+{{ attentionItems().length - 1 }} more</button> }
            </div>
            @if (firstDisabledReason(); as reason) { <span class="sr-only" [id]="'rail-card-attention-reason-' + tabId()">{{ reason }}</span> }
          </div>
        }
      }
      <!-- Expanded: the full-width card's top-right corner, 6 px inside its
           frame over the title line it reserves; a sibling of the card, so it
           is never inside its select button and never clipped by it.
           Collapsed: the 24 px second cell after the 32 px select button. -->
      <div
        #actions
        data-rail-actions
        [class]="actionsClass()"
      >
        <!-- A block trigger wrapper adds no inline baseline gap to the cell.
             Rename opens below the trigger: Floating UI's shift moves a
             bottom placement along x, so a narrow rail beside the Workspaces
             panel keeps the panel inside the viewport (a right/left placement
             only shifts vertically and clipped at 400 px). -->
        <ptah-native-popover
          class="[&>.popover-trigger]:block [&>.popover-panel]:p-0"
          [isOpen]="renameOpen()"
          placement="bottom-end"
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
                  class="max-w-full truncate text-xs text-base-content-muted"
                  [id]="reasonId()"
                  [title]="reason"
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
                aria-haspopup="dialog"
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
          <div content class="w-72 max-w-[calc(100vw-1rem)] p-4" role="dialog" aria-label="Rename session">
            <h3 class="mb-3 text-sm font-semibold text-base-content-muted">Rename session</h3>
            <input #renameInput type="text" class="input input-sm input-bordered mb-3 w-full bg-base-100 border-base-content/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-1px] focus-visible:outline-[oklch(var(--s))]" aria-label="Session name" [attr.aria-describedby]="renameError() ? 'rail-rename-error-' + tabId() : null" [maxLength]="nameMaxLength" [value]="renameDraft()" [readOnly]="renaming()" (input)="onRenameInput(renameInput.value)" (keydown.enter)="onRenameEnter($event)" />
            @if (renameError(); as error) {
              <p class="mb-3 text-xs text-error" [id]="'rail-rename-error-' + tabId()">{{ error }}</p>
            }
            <!-- Equal grid columns: ghost and primary borders differ per theme, so flex-1 skewed them. -->
            <div class="grid grid-cols-2 gap-2">
              <button type="button" class="btn btn-sm btn-ghost w-full" (click)="cancelRename()">Cancel</button>
              <button type="button" class="btn btn-sm btn-primary w-full" [disabled]="renaming()" (click)="saveRename()">Save</button>
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
  private readonly destroyRef = inject(DestroyRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renameKeydown = (event: KeyboardEvent) => this.onRenameKeydown(event);
  private readonly actions = viewChild<ElementRef<HTMLElement>>('actions');
  private readonly trigger =
    viewChild<ElementRef<HTMLButtonElement>>('trigger');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');
  readonly tabId = input.required<string>();
  readonly attentionItems = input<readonly AttentionItem[]>([]);
  readonly submittingKeys = input<ReadonlySet<string>>(new Set());
  readonly blockedKeys = input<ReadonlySet<string>>(new Set());
  readonly isPrimaryAttentionAction = isPrimaryAttentionAction;
  readonly needIcon = CircleAlert;
  readonly attentionAction = output<{item: AttentionItem; actionId: string}>();
  readonly otherRequests = output<void>();
  readonly firstDisabledReason = computed(() => this.attentionItems()[0]?.actions.find(action => action.disabledReason)?.disabledReason);
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
  private announcementTimer: ReturnType<typeof setTimeout> | undefined;
  constructor() {
    this.destroyRef.onDestroy(() => {
      clearTimeout(this.announcementTimer);
      this.host.nativeElement.ownerDocument.removeEventListener('keydown', this.renameKeydown);
    });
  }
  readonly menuOpen = signal(false);
  readonly renameOpen = signal(false);
  readonly renameDraft = signal('');
  readonly renameError = signal('');
  /** A `session:rename` is in flight: Enter and Save are ignored, the field is read-only (D74). */
  readonly renaming = signal(false);
  /** Bumped per Rename open, so a late save result never closes a later popover. */
  private renameOpenCount = 0;
  readonly nameMaxLength = SESSION_NAME_MAX_LENGTH;
  readonly draftReason = 'Send a first message to save this session.';
  readonly cardHeight = computed(
    () => COMPACT_RAIL_CARD_HEIGHT[this.density()],
  );
  readonly tab = computed(
    () => this.tabs.findTabByIdAcrossWorkspaces(this.tabId())?.tab ?? null,
  );
  readonly sessionId = computed(() => this.tab()?.claudeSessionId ?? null);
  /**
   * The expanded actions cell is absolute with a z-index, so it is a stacking
   * context that traps its popovers' z-50 (and their backdrop). While the
   * menu or Rename panel is open it rises to z-50, so the panel paints above
   * later page content (the chat welcome emblem, later rail cards); closed it
   * stays at z-10 over its own card only.
   */
  readonly actionsClass = computed(() => {
    if (this.collapsed()) return 'flex w-6 shrink-0 items-center justify-center';
    const top = this.tab()?.workflow ? 'top-[26px]' : 'top-1.5';
    const layer = this.menuOpen() || this.renameOpen() ? 'z-50' : 'z-10';
    return `absolute right-1.5 ${top} ${layer} flex`;
  });
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
    this.announce('This request has changed. Open the current request.');
    this.staleAction.emit(this.tabId());
  }
  private announce(message: string): void {
    clearTimeout(this.announcementTimer);
    this.announcement.set('');
    this.announcementTimer = setTimeout(() => {
      this.announcement.set(message);
      this.announcementTimer = undefined;
    });
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
    clearTimeout(this.announcementTimer);
    this.announcement.set('');
    this.renameError.set('');
    this.renameDraft.set(this.tab()?.title ?? '');
    this.renameOpenCount++;
    this.closeMenu();
    afterNextRender(() => {
      if (!this.menuOpen()) this.renameOpen.set(true);
    }, { injector: this.injector });
  }
  onRenameOpened(): void {
    if (!this.renameOpen()) return;
    this.host.nativeElement.ownerDocument.addEventListener('keydown', this.renameKeydown);
    const input = this.renameInput()?.nativeElement;
    input?.focus();
    input?.select();
  }
  cancelRename(): void {
    this.host.nativeElement.ownerDocument.removeEventListener('keydown', this.renameKeydown);
    this.renameOpen.set(false);
    this.renameError.set('');
    queueMicrotask(() => this.focusActionTrigger());
  }
  onRenameInput(value: string): void {
    this.renameDraft.set(value);
    this.renameError.set('');
  }
  onRenameEnter(event: Event): void {
    if (
      event instanceof KeyboardEvent &&
      (event.isComposing || event.keyCode === 229)
    ) {
      return;
    }
    void this.saveRename();
  }
  onRenameKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    const document = this.host.nativeElement.ownerDocument;
    const panel = this.renameInput()?.nativeElement.closest<HTMLElement>('[role="dialog"]');
    if (!this.renameOpen() || !panel?.isConnected) return;
    const controls = [...panel.querySelectorAll<HTMLElement>('input, button:not(:disabled)')];
    const first = controls[0];
    const last = controls.at(-1);
    if (!panel.contains(document.activeElement)) {
      (event.shiftKey ? last : first)?.focus();
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === first) {
      last?.focus();
      event.preventDefault();
    } else if (!event.shiftKey && document.activeElement === last) {
      first?.focus();
      event.preventDefault();
    }
  }
  async saveRename(): Promise<void> {
    // Enter repeat, or Enter then Save, must not send overlapping renames:
    // their write order and resolve order can disagree (D74).
    if (this.renaming()) return;
    const id = this.sessionId();
    const current = this.tab();
    if (!id || !current) return;
    const openCount = this.renameOpenCount;
    this.renaming.set(true);
    try {
      const result = await this.rowActions.rename(id, current.title, this.renameDraft());
      // Closed meanwhile (Cancel, Escape, backdrop) or reopened: leave focus alone.
      if (this.renameOpen() && openCount === this.renameOpenCount) {
        if (result === 'failed') {
          this.renameError.set("Couldn't rename. Try again.");
          this.announce("Couldn't rename. Try again.");
          this.renameInput()?.nativeElement.focus();
          return;
        }
        this.cancelRename();
      }
    } finally {
      this.renaming.set(false);
    }
  }
  async startOrganize(): Promise<void> {
    const id = this.sessionId();
    const current = this.tab();
    if (!id || !current || !this.organizer.available()) return;
    clearTimeout(this.announcementTimer);
    this.announcement.set('');
    this.closeMenu();
    const restore = () => queueMicrotask(() => this.focusActionTrigger());
    if (this.organizer.rowFor(id)) {
      this.organizer.open(id, restore);
      return;
    }
    const result = await this.organizer.openForSession(id, current.title, restore);
    if (result === 'failed') this.announce("Could not load this session's organization.");
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
    const trigger = this.trigger()?.nativeElement;
    if (trigger?.isConnected) trigger.focus();
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
