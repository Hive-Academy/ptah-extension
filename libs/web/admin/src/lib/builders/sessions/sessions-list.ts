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
import { EmptyState } from '../../components/empty-state/empty-state';
import { StatusBadge } from '../../components/status-badge/status-badge';
import { SessionFormModal } from './components/session-form-modal/session-form-modal';
import {
  SessionsCalendar,
  type SessionRangeSelection,
  type SessionRescheduleRequest,
} from './components/sessions-calendar/sessions-calendar';

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
 * - **Calendar** (default) — `SessionsCalendar`, a real FullCalendar grid.
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
    SessionsCalendar,
  ],
  templateUrl: './sessions-list.html',
})
export class SessionsList {
  private readonly api = inject(AdminBuildersApiService);

  protected readonly CalendarIcon = CalendarDays;

  /** Lookahead window options offered in the table toolbar (server accepts 1–365). */
  protected readonly windowOptions = [30, 60, 90, 180, 365] as const;

  protected readonly sessions = signal<AdminSession[]>([]);
  protected readonly calendarWritable = signal<boolean>(false);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  protected readonly daysAhead = signal<number>(60);

  protected readonly view = signal<SessionsView>('calendar');

  /** Form modal state — `null` session means create mode. */
  protected readonly formOpen = signal<boolean>(false);
  protected readonly formTarget = signal<AdminSession | null>(null);

  /** Range a grid selection prefills into the create form; `null` for a blank form. */
  protected readonly formRange = signal<SessionRangeSelection | null>(null);

  /** The event the admin clicked in the calendar, shown in the details dialog. */
  protected readonly selectedSession = signal<AdminSession | null>(null);

  /** Id of the session awaiting delete confirmation, if any. */
  protected readonly pendingDeleteId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);

  /** Failure text for delete and reschedule alike — both are row-level actions. */
  protected readonly actionError = signal<string | null>(null);

  /** True once a load has completed, so the read-only notice isn't shown mid-flight. */
  protected readonly loaded = signal<boolean>(false);

  protected readonly showReadOnlyNotice = computed<boolean>(
    () => this.loaded() && !this.calendarWritable(),
  );

  public constructor() {
    this.fetch();
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
    this.formOpen.set(true);
  }

  /** A drag across empty grid space — same create form, times prefilled. */
  protected openCreateForRange(range: SessionRangeSelection): void {
    this.formTarget.set(null);
    this.formRange.set(range);
    this.formOpen.set(true);
  }

  protected openEdit(session: AdminSession): void {
    this.formTarget.set(session);
    this.formRange.set(null);
    this.formOpen.set(true);
    this.selectedSession.set(null);
  }

  protected onFormClose(): void {
    this.formOpen.set(false);
  }

  protected onFormSaved(): void {
    this.formOpen.set(false);
    this.fetch();
  }

  protected onSessionSelected(session: AdminSession): void {
    this.actionError.set(null);
    this.pendingDeleteId.set(null);
    this.selectedSession.set(session);
  }

  protected closeDetails(): void {
    if (this.deletingId() !== null) return;
    this.selectedSession.set(null);
    this.pendingDeleteId.set(null);
  }

  /**
   * A drag or resize on the grid. FullCalendar has already moved the event
   * optimistically, so a rejected PATCH must call `revert()` — otherwise the
   * grid would keep showing a time the server refused.
   */
  protected onRescheduled(request: SessionRescheduleRequest): void {
    this.actionError.set(null);
    this.api
      .updateSession(request.session.id, {
        startsAt: request.startsAt,
        endsAt: request.endsAt,
      })
      .subscribe({
        next: () => this.fetch(),
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
