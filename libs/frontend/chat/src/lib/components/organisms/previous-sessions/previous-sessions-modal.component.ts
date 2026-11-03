/**
 * PreviousSessionsModalComponent — the "Previous sessions" dialog
 * (TASK_2026_679, plan component 7, design 3-4).
 *
 * Smart organism: it has no inputs or outputs and talks only to services.
 * The shell creates it per open (`@if (previousSessions.isOpen())`), so it
 * holds only per-open state: the inline rename draft, the status line and
 * focus bookkeeping. The query (search, filters, sort, grouping, dates,
 * loaded pages) lives in `SessionListViewStore` and `ChatStore`, so closing
 * and reopening keeps it without a new `session:list` request (Req 2.9).
 *
 * Layers: the organization editor and the delete confirm are siblings at the
 * shell root, above this modal; the panel is `inert` while either is open,
 * and their Escape never reaches this one. Focus returns after the render in
 * which the panel lost `inert` (R2): every focus move here runs in
 * `afterNextRender`.
 */
import {
  ChangeDetectionStrategy,
  Component,
  DOCUMENT,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  type AfterRenderRef,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import {
  CalendarX,
  ChevronDown,
  CircleAlert,
  History,
  LucideAngularModule,
  MessageSquare,
  Search,
  X,
} from 'lucide-angular';
import { BootStatusService, LoggingService } from '@ptah-extension/core';
import {
  ConfirmationDialogService,
  TabManagerService,
} from '@ptah-extension/chat-state';
import { SkeletonBlockComponent } from '@ptah-extension/chat-ui';
import type { WorkflowKind } from '@ptah-extension/chat-types';
import type { ChatSessionSummary } from '@ptah-extension/shared';
import { ChatStore } from '../../../services/chat.store';
import { SessionDisplayUtils } from '../../../services/session-display-utils.service';
import { PreviousSessionsDialogService } from '../../../services/session-list/previous-sessions-dialog.service';
import { SessionListViewStore } from '../../../services/session-list/session-list-view.store';
import { SessionOrganizerService } from '../../../services/session-list/session-organizer.service';
import {
  SessionRowActionsService,
  type SessionOpenResult,
} from '../../../services/session-list/session-row-actions.service';
import { wrapTabWithin } from '../../../utils/focus-wrap.utils';
import { PreviousSessionsToolbarComponent } from '../../molecules/previous-sessions-toolbar/previous-sessions-toolbar.component';
import {
  SessionListRowComponent,
  type SessionRenameCommitTrigger,
} from '../../molecules/session-list-row/session-list-row.component';
import { groupSessionRows } from './session-row-groups';

type SessionId = ChatSessionSummary['id'];
/** The `data-action` buttons of a session row. */
type RowAction = 'open' | 'organize' | 'rename' | 'delete';

const LOG_CONTEXT = 'PreviousSessionsModal';

/**
 * The search field of either toolbar variant (organization, plain): a
 * behaviour attribute both inputs carry, not their test IDs (FU-3).
 */
const SEARCH_FIELD = '[data-previous-sessions-search]';

/** Shown and announced when From is after To (FU-2). */
const INVALID_RANGE_MESSAGE = 'The From date is after the To date.';

/** Inline error and announcement after a failed rename (FU-6, design 8.7). */
const RENAME_FAILED_MESSAGE = "Couldn't rename. Try again.";
/** A failed open whose row may have left the list after a query change. */
const OPEN_FAILED_MESSAGE = "Couldn't open the session. Try again.";

/**
 * Tooltip on `transcript expired`: the Claude CLI's `cleanupPeriodDays`
 * retention pruned the SDK transcript. The metadata row survives, so the
 * session still lists; it opens with no history.
 */
const EXPIRED_TRANSCRIPT_HINT =
  'Claude removed this session’s transcript after its retention period, so it will open empty. Raise "cleanupPeriodDays" in ~/.claude/settings.json to keep transcripts longer.';

const EASE_SOFT = 'var(--ptah-ease-soft, cubic-bezier(0.22, 0.61, 0.36, 1))';

/**
 * Scrim, entrance and spinner motion (design 3.2, 6). Only `opacity` and
 * `transform` animate; nothing is left on the panel at rest.
 */
const PREVIOUS_SESSIONS_MODAL_STYLES = `
  :host {
    display: contents;
  }
  /* daisyUI paints its own backdrop on an open .modal (#0006 with
     modal-pop). The scrim below replaces it: its own fade, a lighter tint
     on the light theme, none on the sheet. (0,3,1) beats daisyUI's (0,2,1). */
  :host dialog.psm-dialog {
    background-color: transparent;
    animation: none;
  }
  .psm-scrim {
    background-color: rgb(0 0 0 / 0.5);
    animation: psm-fade 160ms ${EASE_SOFT} backwards;
  }
  :host-context([data-theme='anubis-light']) .psm-scrim {
    background-color: rgb(0 0 0 / 0.3);
  }
  /* No transform, filter, contain or will-change at rest: the Filters
     popover is position: fixed inside the panel and must not be clipped.
     fill-mode backwards leaves no transform once the entrance ends. */
  .psm-panel {
    animation: psm-in 180ms ${EASE_SOFT} backwards;
  }
  /* Below 640 px the panel is a full-screen sheet: no visible scrim. */
  @media (max-width: 639.98px) {
    .psm-scrim {
      display: none;
    }
    .psm-panel {
      animation-name: psm-sheet-in;
      animation-duration: 200ms;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .psm-scrim,
    .psm-panel {
      animation: none;
    }
  }
  @keyframes psm-fade {
    from {
      opacity: 0;
    }
  }
  @keyframes psm-in {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }
  @keyframes psm-sheet-in {
    from {
      opacity: 0;
      transform: translateY(16px);
    }
  }
`;

function sessionCount(count: number): string {
  return `${count} ${count === 1 ? 'session' : 'sessions'}`;
}

@Component({
  selector: 'ptah-previous-sessions-modal',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    LucideAngularModule,
    SkeletonBlockComponent,
    PreviousSessionsToolbarComponent,
    SessionListRowComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './previous-sessions-modal.component.html',
  styles: PREVIOUS_SESSIONS_MODAL_STYLES,
})
export class PreviousSessionsModalComponent {
  protected readonly view = inject(SessionListViewStore);
  protected readonly chatStore = inject(ChatStore);
  protected readonly bootStatus = inject(BootStatusService);
  private readonly tabManager = inject(TabManagerService);
  private readonly dialog = inject(PreviousSessionsDialogService);
  private readonly organizer = inject(SessionOrganizerService);
  private readonly confirmDialog = inject(ConfirmationDialogService);
  private readonly actions = inject(SessionRowActionsService);
  private readonly displayUtils = inject(SessionDisplayUtils);
  private readonly logger = inject(LoggingService);
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);

  protected readonly HistoryIcon = History;
  protected readonly XIcon = X;
  protected readonly SearchIcon = Search;
  protected readonly MessageSquareIcon = MessageSquare;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly CalendarXIcon = CalendarX;
  protected readonly CircleAlertIcon = CircleAlert;
  protected readonly invalidRangeMessage = INVALID_RANGE_MESSAGE;
  protected readonly expiredTranscriptHint = EXPIRED_TRANSCRIPT_HINT;

  private readonly panel = viewChild.required<ElementRef<HTMLElement>>('panel');
  private readonly scrim = viewChild.required<ElementRef<HTMLElement>>('scrim');
  private readonly list = viewChild.required<ElementRef<HTMLElement>>('list');
  private readonly loadMoreButton =
    viewChild<ElementRef<HTMLButtonElement>>('loadMoreButton');

  /**
   * The rows as the list draws them. Without organization this is one
   * headerless group; with it, headers follow the query's `groupBy` and
   * children nest under parents for `parent`.
   */
  protected readonly sessionGroups = computed(() =>
    groupSessionRows(
      this.view.filteredSessions(),
      this.view.organizationAvailable()
        ? (this.view.listQuery().groupBy ?? 'none')
        : 'none',
    ),
  );

  /** Rows on screen, over every group. */
  private readonly rowCount = computed(() =>
    this.sessionGroups().reduce((count, group) => count + group.rows.length, 0),
  );

  /** The editor or the delete confirm sits above the modal: the panel is inert. */
  protected readonly nestedLayerOpen = computed(
    () => this.organizer.isOpen() || this.confirmDialog.isOpen(),
  );

  /** An empty list caused by filters (not an empty history). */
  protected readonly showNoMatch = computed(
    () =>
      this.view.hasServerFilters() ||
      (this.view.hasClientFilters() && this.chatStore.sessions().length > 0),
  );

  /**
   * From is after To, so no session can match. Same day is valid. The
   * `<input type="date">` values are `YYYY-MM-DD`, which order as strings.
   * Derived here: the store keeps both dates as entered (FU-2).
   */
  protected readonly dateRangeReversed = computed(() => {
    const from = this.view.dateFrom();
    const to = this.view.dateTo();
    return from !== '' && to !== '' && from > to;
  });

  /** Hidden when client filters leave no row: another page may not match either. */
  protected readonly canLoadMore = computed(
    () =>
      this.chatStore.hasMoreSessions() &&
      (!this.view.hasClientFilters() || this.rowCount() > 0),
  );

  protected readonly remainingSessions = computed(() =>
    Math.max(
      0,
      this.chatStore.totalSessions() - this.chatStore.sessions().length,
    ),
  );

  /** The session whose inline rename field is open, and its draft. */
  protected readonly editingSessionId = signal<SessionId | null>(null);
  protected readonly editingSessionName = signal('');
  /** Inline error on the editing row after a failed save; '' for none. */
  protected readonly renameError = signal('');

  /** Visible notice after a failed open; cleared on the next open or query change. */
  protected readonly openError = signal('');

  /** Text of the polite status line; set per announcement, cleared before the next. */
  protected readonly statusMessage = signal('');

  private pendingStatus: AfterRenderRef | null = null;
  /** Row count last announced or accounted for; null until the first read. */
  private lastRowCount: number | null = null;
  /** Reversed-range state last announced or accounted for. */
  private lastRangeReversed = false;
  /**
   * Bumped when a rename starts, is cancelled or is committed; a save's
   * failure reopens its field only while its own commit is still the latest.
   */
  private renameGeneration = 0;
  /** Bumped on every query change (list query, search, dates). */
  private queryGeneration = 0;
  /** The last pointerdown in the modal landed on the scrim. */
  private pointerDownOnScrim = false;
  /** A row's open is in flight; further opens are ignored until it settles. */
  private opening = false;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.pendingStatus?.destroy();
    });

    // Initial focus: the search field, caret at the end, so a query kept
    // from the last open can be extended.
    afterNextRender(() => this.focusSearch());

    // A changed query makes a failed-open notice stale.
    effect(() => {
      this.view.listQuery();
      this.view.searchQuery();
      this.view.dateFrom();
      this.view.dateTo();
      untracked(() => {
        this.queryGeneration++;
        this.openError.set('');
      });
    });

    // "N sessions" after the list a query asked for has arrived, or why
    // there are none when the date range turns reversed (also 0 -> 0).
    effect(() => {
      const count = this.rowCount();
      const reversed = this.dateRangeReversed();
      untracked(() => this.onRowCountChange(count, reversed));
    });
  }

  protected groupHeaderId(key: string): string {
    return `psm-group-${key}`;
  }

  protected isCurrent(sessionId: SessionId): boolean {
    return this.chatStore.currentSession()?.id === sessionId;
  }

  protected isOpenInTab(sessionId: SessionId): boolean {
    return this.tabManager.findTabBySessionId(sessionId) !== null;
  }

  protected workflowFor(sessionId: SessionId): WorkflowKind | null {
    return this.tabManager.workflowForSession(
      sessionId,
      this.tabManager.activeWorkspacePath ?? '',
    );
  }

  protected close(): void {
    this.dialog.close();
  }

  /** Escape closes the modal; the inner layers stop their own Escape first. */
  protected onDialogKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.isComposing || event.defaultPrevented) {
      return;
    }
    if (this.nestedLayerOpen()) return;
    event.preventDefault();
    // A document-level Escape listener (canvas) must not also run (R4).
    event.stopPropagation();
    this.close();
  }

  protected onPanelKeydown(event: KeyboardEvent): void {
    wrapTabWithin(this.panel().nativeElement, event);
  }

  protected onDialogPointerDown(event: Event): void {
    this.pointerDownOnScrim = event.target === this.scrim().nativeElement;
  }

  /**
   * Backdrop click: only when the press also started on the scrim, so a text
   * selection dragged out of the panel does not close it (design 4.4).
   */
  protected onScrimClick(): void {
    const startedOnScrim = this.pointerDownOnScrim;
    this.pointerDownOnScrim = false;
    if (startedOnScrim && !this.nestedLayerOpen()) this.close();
  }

  /**
   * A header button that removes itself when used (the search clear X,
   * `Clear`) leaves focus on `<body>`, outside the Tab trap and out of reach
   * of Escape. Give it to the search field after the render.
   */
  protected onHeaderClick(event: Event): void {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest('button')) return;
    this.afterRender(() => {
      const active = this.document.activeElement;
      if (active === null || active === this.document.body) {
        this.focusSearch();
      }
    });
  }

  /** "Clear filters" in the no-match state; its button goes away with the state. */
  protected onClearFilters(): void {
    this.view.clearFilters();
    this.focusAfterRender(() => null);
  }

  protected onOpened(session: ChatSessionSummary): void {
    void this.openRow(session);
  }

  protected onOrganize(session: ChatSessionSummary): void {
    const sessionId = session.id;
    // Runs after the editor's close renders and the panel is no longer
    // inert. The editor then focuses its own opener, which is this same
    // button, or leaves this focus alone when the row is gone (D30).
    this.organizer.open(sessionId, () => {
      if (this.destroyed) return;
      const target = this.rowAction(sessionId, 'organize');
      if (target) target.focus();
      else this.focusSearch();
    });
  }

  protected onRenameRequested(session: ChatSessionSummary): void {
    // The row focuses and selects its own field (D34).
    this.renameGeneration++;
    this.editingSessionId.set(session.id);
    this.editingSessionName.set(session.name || '');
    this.renameError.set('');
  }

  /** The draft as typed; editing it clears a failed-save error. */
  protected onRenameNameChange(name: string): void {
    this.editingSessionName.set(name);
    this.renameError.set('');
  }

  protected onRenameCommitted(
    session: ChatSessionSummary,
    trigger: SessionRenameCommitTrigger,
  ): void {
    // Guarded against a double fire (Enter, then the field's blur) (D33).
    if (this.editingSessionId() !== session.id) return;
    const requested = this.editingSessionName();
    this.endRename();
    const attempt = ++this.renameGeneration;
    // After a blur the user clicked elsewhere: focus stays there (D32).
    if (trigger === 'enter') {
      this.afterRender(() => {
        // A fast failure has reopened a field, which holds focus: moving it
        // would blur the field and save again.
        if (this.editingSessionId() !== null) return;
        const target = this.rowAction(session.id, 'rename');
        if (target) target.focus();
        else this.focusSearch();
      });
    }
    void this.renameRow(session, requested, attempt);
  }

  protected onRenameCancelled(session: ChatSessionSummary): void {
    if (this.editingSessionId() !== session.id) return;
    this.renameGeneration++;
    this.endRename();
    this.focusAfterRender(() => this.rowAction(session.id, 'rename'));
  }

  protected onDeleteRequested(session: ChatSessionSummary): void {
    void this.deleteRow(session);
  }

  protected onLoadMore(): void {
    void this.loadMore();
  }

  private endRename(): void {
    this.editingSessionId.set(null);
    this.editingSessionName.set('');
    this.renameError.set('');
  }

  /**
   * Save a rename. The service logs a failure and the row keeps its name;
   * here the field opens again with the user's draft and the inline error,
   * and the same text is announced (FU-6, design 8.7). A result that comes
   * back after the user started, cancelled or committed another rename
   * (`attempt` is no longer the latest), or after the row left the list,
   * changes nothing.
   */
  private async renameRow(
    session: ChatSessionSummary,
    requested: string,
    attempt: number,
  ): Promise<void> {
    const result = await this.actions.rename(
      session.id,
      session.name || '',
      requested,
    );
    if (this.destroyed || result !== 'failed') return;
    if (attempt !== this.renameGeneration) return;
    const stillListed = this.view
      .filteredSessions()
      .some((row) => row.id === session.id);
    if (!stillListed) return;
    // The row focuses and selects its own field again.
    this.editingSessionId.set(session.id);
    this.editingSessionName.set(requested);
    this.renameError.set(RENAME_FAILED_MESSAGE);
    this.announce(RENAME_FAILED_MESSAGE);
  }

  /**
   * Open a row's session, one at a time. The modal closes only once the
   * session opened; a grid open the canvas dropped keeps it open and says so
   * on the status line. A failure that arrives after the query changed is
   * only announced, without the row's name, notice or focus move: the row
   * may no longer be on screen.
   */
  private async openRow(session: ChatSessionSummary): Promise<void> {
    if (this.opening) return;
    this.opening = true;
    this.openError.set('');
    const queryAtOpen = this.queryGeneration;
    let result: SessionOpenResult;
    try {
      result = await this.actions.openSession(session);
    } finally {
      this.opening = false;
    }
    if (this.destroyed || !this.dialog.isOpen()) return;
    if (result === 'opened') {
      this.close();
      return;
    }
    if (queryAtOpen !== this.queryGeneration) {
      this.announce(OPEN_FAILED_MESSAGE);
      return;
    }
    const name = this.displayUtils.getSessionDisplayName(session);
    const message = `Couldn't open "${name}". Try again.`;
    this.openError.set(message);
    this.announce(message);
    // Focus is left where it is unless it fell out of the panel (e.g. to
    // <body>); a layer above the modal keeps its own focus.
    this.afterRender(() => {
      if (this.nestedLayerOpen()) return;
      const active = this.document.activeElement;
      if (active !== null && this.panel().nativeElement.contains(active)) {
        return;
      }
      const target = this.rowAction(session.id, 'open');
      if (target) target.focus();
      else this.focusSearch();
    });
  }

  private async deleteRow(session: ChatSessionSummary): Promise<void> {
    const order = this.visibleRowIds();
    const result = await this.actions.deleteSession(session);
    if (this.destroyed) return;
    if (result === 'deleted') {
      // The row count fell because of the delete, not a query: no "N sessions".
      this.lastRowCount = this.rowCount();
      this.focusAfterRender(() => this.neighbourOpenButton(order, session.id));
      return;
    }
    // Cancelled, or failed and kept: back to the row's Delete button.
    this.focusAfterRender(() => this.rowAction(session.id, 'delete'));
  }

  private async loadMore(): Promise<void> {
    if (this.chatStore.isLoadingMoreSessions()) return;
    const loadedBefore = new Set(this.chatStore.sessions().map((s) => s.id));
    this.clearStatus();
    try {
      await this.chatStore.loadMoreSessions();
    } catch (error) {
      // A list load error has no UI (parity E-5).
      this.logger.error(LOG_CONTEXT, 'Failed to load more sessions', error);
    }
    if (this.destroyed) return;

    const sessions = this.chatStore.sessions();
    const loaded = sessions.filter((s) => !loadedBefore.has(s.id)).length;
    if (loaded > 0) {
      // The page is announced below; the count effect must not repeat it.
      this.lastRowCount = this.rowCount();
      const remaining = Math.max(
        0,
        this.chatStore.totalSessions() - sessions.length,
      );
      const noun = loaded === 1 ? 'session' : 'sessions';
      this.announce(`Loaded ${loaded} more ${noun}. ${remaining} remaining.`);
    }
    this.afterRender(() => this.restoreLoadMoreFocus(loadedBefore));
  }

  /**
   * Focus stays on Load More while it exists. When the last page removed it,
   * the first newly loaded row takes focus. If the user moved elsewhere in the
   * modal while the page loaded, focus is left there.
   */
  private restoreLoadMoreFocus(loadedBefore: ReadonlySet<string>): void {
    const button = this.loadMoreButton()?.nativeElement ?? null;
    const active = this.document.activeElement;
    const movedOn =
      active !== null &&
      active !== this.document.body &&
      active !== button &&
      this.panel().nativeElement.contains(active);
    if (movedOn) return;
    if (button) {
      button.focus();
      return;
    }
    const firstNew = this.rowElements().find((row) => {
      const id = row.getAttribute('data-session-id');
      return id !== null && !loadedBefore.has(id);
    });
    const target = firstNew?.querySelector<HTMLElement>('[data-action="open"]');
    if (target) target.focus();
    else this.focusSearch();
  }

  private onRowCountChange(count: number, reversed: boolean): void {
    // The first read, and rows still arriving at boot, are not a query result.
    if (this.lastRowCount === null || this.bootStatus.isBooting()) {
      this.lastRowCount = count;
      this.lastRangeReversed = reversed;
      return;
    }
    if (count === this.lastRowCount && reversed === this.lastRangeReversed) {
      return;
    }
    this.lastRowCount = count;
    this.lastRangeReversed = reversed;
    this.announce(reversed ? INVALID_RANGE_MESSAGE : sessionCount(count));
  }

  /**
   * Set the status line. It is emptied first and filled after the render, so
   * a message equal to the last one is still a change a screen reader reads.
   */
  private announce(message: string): void {
    this.clearStatus();
    this.pendingStatus = afterNextRender(
      () => {
        this.pendingStatus = null;
        this.statusMessage.set(message);
      },
      { injector: this.injector },
    );
  }

  private clearStatus(): void {
    this.pendingStatus?.destroy();
    this.pendingStatus = null;
    this.statusMessage.set('');
  }

  /** Session ids in on-screen order, across groups. */
  private visibleRowIds(): string[] {
    return this.sessionGroups().flatMap((group) =>
      group.rows.map((row) => row.session.id),
    );
  }

  /** After a delete: the next row's open button, else the previous one's. */
  private neighbourOpenButton(
    order: readonly string[],
    deletedId: string,
  ): HTMLElement | null {
    const index = order.indexOf(deletedId);
    const after = order.slice(index + 1);
    const before = order.slice(0, Math.max(index, 0)).reverse();
    for (const id of [...after, ...before]) {
      const button = this.rowAction(id, 'open');
      if (button) return button;
    }
    return null;
  }

  private rowElements(): HTMLElement[] {
    return Array.from(
      this.list().nativeElement.querySelectorAll<HTMLElement>(
        'li[data-session-id]',
      ),
    );
  }

  private rowAction(sessionId: string, action: RowAction): HTMLElement | null {
    const row = this.rowElements().find(
      (element) => element.getAttribute('data-session-id') === sessionId,
    );
    return row?.querySelector<HTMLElement>(`[data-action="${action}"]`) ?? null;
  }

  private searchField(): HTMLInputElement | null {
    return this.panel().nativeElement.querySelector<HTMLInputElement>(
      SEARCH_FIELD,
    );
  }

  private focusSearch(): void {
    const field = this.searchField();
    if (!field) return;
    field.focus();
    const end = field.value.length;
    field.setSelectionRange(end, end);
  }

  /** Focus `target()` after the next render, else the search field. */
  private focusAfterRender(target: () => HTMLElement | null): void {
    this.afterRender(() => {
      const element = target();
      if (element) element.focus();
      else this.focusSearch();
    });
  }

  private afterRender(callback: () => void): void {
    if (this.destroyed) return;
    afterNextRender(
      () => {
        if (!this.destroyed) callback();
      },
      { injector: this.injector },
    );
  }
}
