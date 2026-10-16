import {
  Injectable,
  Injector,
  afterNextRender,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { ClaudeRpcService, LoggingService } from '@ptah-extension/core';
import type {
  ChatSessionSummary,
  SessionGetOrganizationResult,
  SessionId,
} from '@ptah-extension/shared';
import { ChatStore } from '../chat.store';

/**
 * Outcome of {@link SessionOrganizerService.openForSession}.
 *
 * - `opened`: the editor shows the session.
 * - `unavailable`: the host does not serve session organization.
 * - `failed`: the summary could not be read; the editor stays closed.
 * - `cancelled`: a later open, a close or a delete superseded this request
 *   before it resolved; the editor was not opened for it.
 */
export type SessionOrganizerOpenResult =
  | 'opened'
  | 'unavailable'
  | 'failed'
  | 'cancelled';

/** One in-flight `session:getOrganization` read started by `openForSession`. */
interface PendingOpen {
  readonly sessionId: SessionId;
  /** Set by a push for this id while the read is in flight: read again. */
  stale: boolean;
}

/** One in-flight refresh of the fetched (not loaded) session the editor shows. */
interface PendingRefresh {
  readonly sessionId: SessionId;
}

type OrganizationRead = Extract<SessionGetOrganizationResult, { ok: true }>;

type SummaryRead =
  | { kind: 'ok'; result: OrganizationRead }
  | { kind: 'unavailable' }
  | { kind: 'failed' };

const LOG_CONTEXT = 'SessionOrganizer';

/**
 * Which session the organization editor shows (TASK_2026_679).
 *
 * The modal rows and the Rail cards both open the one editor through this
 * service; the shell renders it from {@link session}. A session the loaded
 * list does not contain (paging or a filter) is read with
 * `session:getOrganization` and kept as the one fetched entry while the
 * editor shows it.
 */
@Injectable({ providedIn: 'root' })
export class SessionOrganizerService {
  private readonly chatStore = inject(ChatStore);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly logger = inject(LoggingService);
  // Root injector: `afterNextRender` needs one outside an injection context.
  private readonly injector = inject(Injector);

  /** Whether the host serves session organization. */
  readonly available = this.chatStore.organizationAvailable;

  /** Id of the session whose organization editor is open, or null. */
  private readonly sessionId = signal<SessionId | null>(null);

  /**
   * The summary read for a session outside the loaded list. It holds at most
   * the session being shown and is dropped on close.
   */
  private readonly fetched = signal<ChatSessionSummary | null>(null);

  /** Focus restore for the open editor, run after the close renders. */
  private restoreFocus: (() => void) | null = null;

  /** Latest-request-wins: only this read may open the editor. */
  private pendingOpen: PendingOpen | null = null;

  /** Latest-request-wins: only this read may replace {@link fetched}. */
  private pendingRefresh: PendingRefresh | null = null;

  /**
   * The row the editor shows: the loaded row, else the fetched entry, else
   * the last copy. It follows the list, so a reload after a mutation hands
   * the editor the fresh record; when the row leaves the loaded list (e.g. it
   * was archived under a status filter) the editor keeps the last copy
   * instead of closing under the user.
   */
  readonly session = linkedSignal<
    {
      id: SessionId | null;
      sessions: readonly ChatSessionSummary[];
      fetched: ChatSessionSummary | null;
    },
    ChatSessionSummary | null
  >({
    source: () => ({
      id: this.sessionId(),
      sessions: this.chatStore.sessions(),
      fetched: this.fetched(),
    }),
    computation: ({ id, sessions, fetched }, previous) => {
      if (id === null) return null;
      const row = sessions.find((s) => s.id === id);
      if (row) return row;
      if (fetched?.id === id) return fetched;
      return previous?.value?.id === id ? previous.value : null;
    },
  });

  /** True while the editor shows a session. */
  readonly isOpen = computed(() => this.session() !== null);

  /** The loaded row for a session when it carries organization, else null. */
  rowFor(sessionId: SessionId): ChatSessionSummary | null {
    const row = this.chatStore.sessions().find((s) => s.id === sessionId);
    return row?.organization ? row : null;
  }

  /**
   * Open the editor for a session. It supersedes any read in flight.
   * `restoreFocus` runs after the editor's close has rendered.
   */
  open(sessionId: SessionId, restoreFocus: () => void): void {
    this.pendingOpen = null;
    this.pendingRefresh = null;
    if (this.fetched()?.id !== sessionId) {
      this.fetched.set(null);
    }
    this.restoreFocus = restoreFocus;
    this.sessionId.set(sessionId);
  }

  /**
   * Close the editor and drop the fetched entry. Focus is restored after the
   * next render, once the state change that removes the editor (and with it
   * any `inert` on the content behind it) has reached the DOM. A read in
   * flight is cancelled and never opens the editor.
   */
  close(): void {
    this.pendingOpen = null;
    this.pendingRefresh = null;
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    this.sessionId.set(null);
    this.fetched.set(null);
    if (restore) {
      afterNextRender(() => restore(), { injector: this.injector });
    }
  }

  /** Close the editor when it shows, or is about to show, this session. */
  closeIfShowing(sessionId: SessionId): void {
    if (this.sessionId() === sessionId) {
      this.close();
      return;
    }
    if (this.pendingOpen?.sessionId === sessionId) {
      this.pendingOpen = null;
    }
  }

  /**
   * Open the editor for a session that may not be in the loaded list (the
   * Rail: a persisted session outside the loaded page or filters).
   *
   * A loaded row opens at once. Otherwise the summary is read with
   * `session:getOrganization`. The latest request wins: a later open, a
   * close or a delete of the session cancels this one, and a push for the
   * session while the read is in flight reads it again, so a stale summary
   * never opens the editor.
   */
  async openForSession(
    sessionId: SessionId,
    name: string,
    restoreFocus: () => void,
  ): Promise<SessionOrganizerOpenResult> {
    if (!this.available()) return 'unavailable';
    if (this.rowFor(sessionId)) {
      this.open(sessionId, restoreFocus);
      return 'opened';
    }

    const request: PendingOpen = { sessionId, stale: false };
    this.pendingOpen = request;
    let read: SummaryRead;
    do {
      request.stale = false;
      read = await this.readSummary(sessionId);
      if (this.pendingOpen !== request) return 'cancelled';
    } while (request.stale);
    this.pendingOpen = null;

    if (read.kind !== 'ok') return read.kind;
    // The row may have loaded while the read was in flight; the editor then
    // follows it, as for any loaded row.
    this.open(sessionId, restoreFocus);
    this.fetched.set(
      this.chatStore.sessions().some((s) => s.id === sessionId)
        ? null
        : this.summaryFor(sessionId, name, read.result),
    );
    return 'opened';
  }

  /**
   * An organization push (`session:organizationChanged`) for these ids.
   * The loaded rows refresh through the session-list reload; this keeps a
   * fetched session current: a read in flight for one of the ids reads
   * again, and a fetched session the editor shows is read again.
   */
  onOrganizationChanged(sessionIds: readonly string[]): void {
    const changed = new Set(sessionIds);
    if (this.pendingOpen && changed.has(this.pendingOpen.sessionId)) {
      this.pendingOpen.stale = true;
    }
    const shown = this.fetched();
    if (
      shown &&
      this.sessionId() === shown.id &&
      changed.has(shown.id) &&
      !this.chatStore.sessions().some((s) => s.id === shown.id)
    ) {
      void this.refresh(shown);
    }
  }

  private async refresh(shown: ChatSessionSummary): Promise<void> {
    const request: PendingRefresh = { sessionId: shown.id };
    this.pendingRefresh = request;
    const read = await this.readSummary(shown.id);
    if (this.pendingRefresh !== request) return;
    this.pendingRefresh = null;
    // On a failed read the editor keeps the last copy.
    if (read.kind !== 'ok' || this.fetched()?.id !== shown.id) return;
    this.fetched.set(this.summaryFor(shown.id, shown.name, read.result));
  }

  private async readSummary(sessionId: SessionId): Promise<SummaryRead> {
    try {
      const response = await this.rpc.call('session:getOrganization', {
        sessionId,
      });
      if (!response.isSuccess()) {
        this.logger.error(
          LOG_CONTEXT,
          'Failed to read session organization',
          response.error,
        );
        return { kind: 'failed' };
      }
      const result = response.data;
      if (result.ok) return { kind: 'ok', result };
      this.logger.error(
        LOG_CONTEXT,
        'Failed to read session organization',
        result,
      );
      return result.reason === 'organization-unavailable'
        ? { kind: 'unavailable' }
        : { kind: 'failed' };
    } catch (error) {
      this.logger.error(
        LOG_CONTEXT,
        'Failed to read session organization',
        error,
      );
      return { kind: 'failed' };
    }
  }

  /**
   * The editor input for a fetched session. The editor reads only `id`,
   * `name` and `organization`; the other required fields are neutral.
   */
  private summaryFor(
    sessionId: SessionId,
    name: string,
    result: OrganizationRead,
  ): ChatSessionSummary {
    return {
      id: sessionId,
      name,
      organization: result.organization,
      messageCount: 0,
      createdAt: 0,
      lastActivityAt: 0,
      isActive: false,
    };
  }
}
