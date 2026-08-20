import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CalendarDays } from 'lucide-angular';

import {
  AdminBuildersApiService,
  AdminSession,
} from '../../services/admin-builders-api.service';
import { AdminApiService } from '../../services/admin-api.service';
import { EmptyState } from '@ptah-web/panel-ui';
import { StatusBadge } from '@ptah-web/panel-ui';
import { SessionFormModal } from './components/session-form-modal/session-form-modal';
import { SessionTemplatePalette } from './components/session-template-palette/session-template-palette';
import {
  SessionCalendar,
  type SessionRangeSelection,
  type SessionRescheduleRequest,
} from '@ptah-web/ui';
import { toSessionTemplates, type SessionTemplate } from './session-templates';

/** Which surface is showing. The calendar is the primary view; the table is the scan view. */
type SessionsView = 'calendar' | 'table';

/**
 * SessionsList — admin view of the Builders session calendar.
 * Route: `/admin/builders/sessions`.
 *
 * Reads the same Google Calendar events as `GET /api/v1/members/sessions`, but
 * through `AdminGuard` instead of the Builders membership gate. That pairing —
 * an admin seeing member content without holding a membership — is the entire
 * premise of TASK_2026_169, and the member endpoint is untouched by it.
 *
 * Two surfaces over one fetch:
 *
 * - **Calendar** (default) — the shared `SessionCalendar` grid, the same
 *   component the members' area renders read-only.
 *   Sessions are a *schedule*; a flat table made the reader reconstruct the
 *   week in their head. Drag/resize reschedules, dragging empty space creates.
 * - **Table** — the scan/audit view, and the only place with a bulk-readable
 *   list plus an explicit lookahead window.
 *
 * The two views disagree about the fetch window on purpose. The table's window
 * is an explicit choice (`daysAhead` select); the calendar's is implied by
 * wherever the admin navigated. `widenWindow()` reconciles them by only ever
 * growing the window, so paging back through the calendar never discards
 * sessions the table already had.
 *
 * Two degradations the server drives, both deliberate:
 *
 * 1. `calendarWritable: false` — the server's Google grant carries no calendar
 *    write scope. Every mutation control is hidden (not disabled-and-dead) and
 *    a warning explains that re-consent is required. Reading still works.
 * 2. Recurring master series — `DELETE` and `PATCH` are refused server-side
 *    with 409 `protected_recurring_event`, because member provisioning
 *    maintains that event's attendee list. Those events are not draggable and
 *    their row/detail actions are disabled rather than offering an action that
 *    cannot succeed.
 */
@Component({
  selector: 'ptah-admin-sessions-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    EmptyState,
    StatusBadge,
    SessionFormModal,
    SessionCalendar,
    SessionTemplatePalette,
  ],
  templateUrl: './sessions-list.html',
})
export class SessionsList {
  private readonly api = inject(AdminBuildersApiService);
  private readonly adminApi = inject(AdminApiService);

  protected readonly CalendarIcon = CalendarDays;

  /** Lookahead window options offered in the table toolbar (server accepts 1–365). */
  protected readonly windowOptions = [30, 60, 90, 180, 365] as const;

  protected readonly sessions = signal<AdminSession[]>([]);
  protected readonly calendarWritable = signal<boolean>(false);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  protected readonly daysAhead = signal<number>(60);

  protected readonly view = signal<SessionsView>('calendar');

  /**
   * Draggable session types, derived from cohorts. Loaded independently of the
   * session fetch and failing silently to `[]`: cohorts are a convenience for
   * scheduling, and a groups-endpoint hiccup must not make the calendar itself
   * look broken. The "New Session" button still works with no palette at all.
   */
  protected readonly templates = signal<SessionTemplate[]>([]);

  /** The session awaiting invite confirmation, if any. */
  protected readonly pendingInviteId = signal<string | null>(null);
  protected readonly invitingId = signal<string | null>(null);

  /** Form modal state — `null` session means create mode. */
  protected readonly formOpen = signal<boolean>(false);
  protected readonly formTarget = signal<AdminSession | null>(null);

  /** Range a grid selection prefills into the create form; `null` for a blank form. */
  protected readonly formRange = signal<SessionRangeSelection | null>(null);

  /** Title a dropped/clicked template seeds into the create form. */
  protected readonly formTitleSeed = signal<string | null>(null);

  /** The event the admin clicked in the calendar, shown in the details dialog. */
  protected readonly selectedSession = signal<AdminSession | null>(null);

  /** Id of the session awaiting delete confirmation, if any. */
  protected readonly pendingDeleteId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);

  /** Failure text for delete, reschedule, and invite alike — all row-level actions. */
  protected readonly actionError = signal<string | null>(null);

  /** Confirmation text after a successful send, so the outcome isn't silent. */
  protected readonly inviteNotice = signal<string | null>(null);

  /**
   * Shown after a drag moved a session that has guests, stating that they were
   * NOT told. Cleared by the next fetch, so it never lingers past its subject.
   */
  protected readonly rescheduleNotice = signal<string | null>(null);

  /** True once a load has completed, so the read-only notice isn't shown mid-flight. */
  protected readonly loaded = signal<boolean>(false);

  protected readonly showReadOnlyNotice = computed<boolean>(
    () => this.loaded() && !this.calendarWritable(),
  );

  /**
   * Sessions with the grid's per-event drag permission attached.
   *
   * `SessionCalendar` is shared with the members' area and knows nothing about
   * provisioning-owned series, so the permission is supplied here rather than
   * inferred there from `recurring`. Only the master itself refuses a PATCH;
   * every instance — including instances OF the protected series — is movable,
   * which is what "reschedule next week's session" requires.
   */
  protected readonly calendarSessions = computed<AdminSession[]>(() =>
    this.sessions().map((session) => ({
      ...session,
      editable: !session.isProtectedMaster,
    })),
  );

  public constructor() {
    this.fetch();
    this.fetchTemplates();
  }

  private fetchTemplates(): void {
    this.adminApi.listGroups().subscribe({
      next: (cohorts) => this.templates.set(toSessionTemplates(cohorts)),
      // Deliberately silent. A missing palette is a smaller failure than an
      // error banner over a calendar that loaded perfectly well.
      error: () => this.templates.set([]),
    });
  }

  protected fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.pendingDeleteId.set(null);
    this.actionError.set(null);
    this.api.listSessions({ daysAhead: this.daysAhead() }).subscribe({
      next: (res) => {
        this.sessions.set(res.sessions);
        this.calendarWritable.set(res.calendarWritable);
        this.loading.set(false);
        this.loaded.set(true);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(
          this.extractErrorMessage(err, 'Failed to load sessions.'),
        );
      },
    });
  }

  protected setView(view: SessionsView): void {
    this.view.set(view);
    // A confirmation the admin never answered should not follow them across —
    // it would reappear pre-armed on the other surface's row.
    this.selectedSession.set(null);
    this.pendingDeleteId.set(null);
    this.pendingInviteId.set(null);
    this.inviteNotice.set(null);
    this.rescheduleNotice.set(null);
  }

  protected onWindowChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement | null)?.value ?? '60';
    const parsed = Number.parseInt(raw, 10);
    this.daysAhead.set(Number.isFinite(parsed) ? parsed : 60);
    this.fetch();
  }

  /**
   * The calendar navigated to a range ending `days` from now. Only a range
   * reaching past the loaded window costs a fetch — paging back through months
   * already covered re-renders from what is in memory.
   */
  protected widenWindow(days: number): void {
    if (days <= this.daysAhead()) return;
    this.daysAhead.set(days);
    this.fetch();
  }

  protected openCreate(): void {
    this.formTarget.set(null);
    this.formRange.set(null);
    this.formTitleSeed.set(null);
    this.formOpen.set(true);
  }

  /**
   * A drag across empty grid space, or a template chip dropped on it.
   *
   * Both land here because both mean the same thing — "create a session in this
   * slot". A dropped chip additionally carries `templateId`, which seeds the
   * title so the admin confirms rather than types.
   */
  protected openCreateForRange(range: SessionRangeSelection): void {
    this.formTarget.set(null);
    this.formRange.set(range);
    this.formTitleSeed.set(this.titleForTemplate(range.templateId));
    this.formOpen.set(true);
  }

  /**
   * A chip was clicked instead of dragged — the keyboard and touch path to the
   * same outcome. There is no slot to infer, so the form opens with the title
   * seeded and the times blank for the admin to fill in.
   */
  protected onTemplatePicked(template: SessionTemplate): void {
    this.formTarget.set(null);
    this.formRange.set(null);
    this.formTitleSeed.set(template.title);
    this.formOpen.set(true);
  }

  private titleForTemplate(templateId: string | undefined): string | null {
    if (!templateId) return null;
    return this.templates().find((t) => t.id === templateId)?.title ?? null;
  }

  protected openEdit(session: AdminSession): void {
    this.formTarget.set(session);
    this.formRange.set(null);
    this.formTitleSeed.set(null);
    this.formOpen.set(true);
    this.selectedSession.set(null);
  }

  /**
   * Arm the invite confirmation. Deliberately two-step, and deliberately NOT
   * reusing `pendingDeleteId`: an admin mid-confirmation should never be one
   * mis-click from the other action, and the two confirmations render in the
   * same corner of the same dialog.
   */
  protected requestInvite(session: AdminSession): void {
    this.actionError.set(null);
    this.pendingDeleteId.set(null);
    this.pendingInviteId.set(session.id);
  }

  protected cancelInvite(): void {
    this.pendingInviteId.set(null);
  }

  /**
   * ⚠️ SENDS EMAIL. Google mails every guest on the event — including ones
   * already invited, who get it again. The confirmation this follows states the
   * exact recipient count, which is the number `selectedInviteCount` renders.
   */
  protected confirmInvite(session: AdminSession): void {
    this.invitingId.set(session.id);
    this.actionError.set(null);
    this.api.sendInvitations(session.id).subscribe({
      next: (updated) => {
        this.invitingId.set(null);
        this.pendingInviteId.set(null);
        this.selectedSession.set(updated);
        this.inviteNotice.set(
          `Invitations sent to ${updated.attendees.length} ${
            updated.attendees.length === 1 ? 'guest' : 'guests'
          }.`,
        );
        this.fetch();
      },
      error: (err: unknown) => {
        this.invitingId.set(null);
        this.pendingInviteId.set(null);
        this.actionError.set(
          this.extractErrorMessage(err, 'Failed to send invitations.'),
        );
      },
    });
  }

  protected onFormClose(): void {
    this.formOpen.set(false);
  }

  protected onFormSaved(): void {
    this.formOpen.set(false);
    // The form owns the notify decision, so whatever the drag warned about has
    // now been answered one way or the other.
    this.rescheduleNotice.set(null);
    this.fetch();
  }

  protected onSessionSelected(session: AdminSession): void {
    this.actionError.set(null);
    this.inviteNotice.set(null);
    this.rescheduleNotice.set(null);
    this.pendingDeleteId.set(null);
    this.pendingInviteId.set(null);
    this.selectedSession.set(session);
  }

  protected closeDetails(): void {
    if (this.deletingId() !== null || this.invitingId() !== null) return;
    this.selectedSession.set(null);
    this.pendingDeleteId.set(null);
    this.pendingInviteId.set(null);
    this.inviteNotice.set(null);
  }

  /**
   * A drag or resize on the grid. FullCalendar has already moved the event
   * optimistically, so a rejected PATCH must call `revert()` — otherwise the
   * grid would keep showing a time the server refused.
   */
  protected onRescheduled(
    request: SessionRescheduleRequest<AdminSession>,
  ): void {
    this.actionError.set(null);
    this.rescheduleNotice.set(null);
    this.api
      .updateSession(request.session.id, {
        startsAt: request.startsAt,
        endsAt: request.endsAt,
      })
      .subscribe({
        next: () => {
          // A drag has no moment to ask about notifying, so it stays silent —
          // consistent with every other routine write. Saying so is the point:
          // an admin who moved a session with guests on it should not have to
          // infer that nobody was told.
          const guests = request.session.attendees.length;
          if (guests > 0) {
            this.rescheduleNotice.set(
              `Moved. ${guests} ${guests === 1 ? 'guest was' : 'guests were'} not notified — reopen it with Edit and tick “Notify guests” to tell them.`,
            );
          }
          this.fetch();
        },
        error: (err: unknown) => {
          request.revert();
          this.actionError.set(
            this.extractErrorMessage(err, 'Failed to reschedule the session.'),
          );
        },
      });
  }

  protected requestDelete(session: AdminSession): void {
    this.actionError.set(null);
    this.pendingDeleteId.set(session.id);
  }

  protected cancelDelete(): void {
    this.pendingDeleteId.set(null);
  }

  protected confirmDelete(session: AdminSession): void {
    this.deletingId.set(session.id);
    this.actionError.set(null);
    this.api.deleteSession(session.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.pendingDeleteId.set(null);
        this.selectedSession.set(null);
        this.fetch();
      },
      error: (err: unknown) => {
        this.deletingId.set(null);
        this.pendingDeleteId.set(null);
        this.actionError.set(
          this.extractErrorMessage(err, 'Failed to delete the session.'),
        );
      },
    });
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as {
        error?: { message?: string | string[]; reason?: string };
        message?: string;
      };
      if (anyErr.error?.reason === 'protected_recurring_event') {
        return 'That is the recurring Builders series member provisioning depends on. Manage it in Google Calendar directly.';
      }
      const msg = anyErr.error?.message ?? anyErr.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }
    return fallback;
  }
}
