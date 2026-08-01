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

/**
 * SessionsList — admin view of the Builders session calendar.
 * Route: `/admin/builders/sessions`.
 *
 * Reads the same Google Calendar events as `GET /api/v1/members/sessions`, but
 * through `AdminGuard` instead of the Builders membership gate. That pairing —
 * an admin seeing member content without holding a membership — is the entire
 * premise of TASK_2026_169, and the member endpoint is untouched by it.
 *
 * Two degradations the server drives, both deliberate:
 *
 * 1. `calendarWritable: false` — the server's Google grant carries no calendar
 *    write scope. Every mutation control is hidden (not disabled-and-dead) and
 *    a warning explains that re-consent is required. Reading still works.
 * 2. Recurring master series — `DELETE` is refused server-side with 409
 *    `protected_recurring_event`, because member provisioning maintains that
 *    event's attendee list. The row shows a "series" badge and its delete
 *    button is disabled rather than offering an action that cannot succeed.
 */
@Component({
  selector: 'ptah-admin-sessions-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, EmptyState, StatusBadge, SessionFormModal],
  templateUrl: './sessions-list.html',
})
export class SessionsList {
  private readonly api = inject(AdminBuildersApiService);

  protected readonly CalendarIcon = CalendarDays;

  /** Lookahead window options offered in the toolbar (server accepts 1–365). */
  protected readonly windowOptions = [30, 60, 90, 180, 365] as const;

  protected readonly sessions = signal<AdminSession[]>([]);
  protected readonly calendarWritable = signal<boolean>(false);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);
  protected readonly daysAhead = signal<number>(60);

  /** Form modal state — `null` session means create mode. */
  protected readonly formOpen = signal<boolean>(false);
  protected readonly formTarget = signal<AdminSession | null>(null);

  /** Id of the row awaiting inline delete confirmation, if any. */
  protected readonly pendingDeleteId = signal<string | null>(null);
  protected readonly deletingId = signal<string | null>(null);
  protected readonly deleteError = signal<string | null>(null);

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
    this.deleteError.set(null);
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

  protected onWindowChange(event: Event): void {
    const raw = (event.target as HTMLSelectElement | null)?.value ?? '60';
    const parsed = Number.parseInt(raw, 10);
    this.daysAhead.set(Number.isFinite(parsed) ? parsed : 60);
    this.fetch();
  }

  protected openCreate(): void {
    this.formTarget.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(session: AdminSession): void {
    this.formTarget.set(session);
    this.formOpen.set(true);
  }

  protected onFormClose(): void {
    this.formOpen.set(false);
  }

  protected onFormSaved(): void {
    this.formOpen.set(false);
    this.fetch();
  }

  protected requestDelete(session: AdminSession): void {
    this.deleteError.set(null);
    this.pendingDeleteId.set(session.id);
  }

  protected cancelDelete(): void {
    this.pendingDeleteId.set(null);
  }

  protected confirmDelete(session: AdminSession): void {
    this.deletingId.set(session.id);
    this.deleteError.set(null);
    this.api.deleteSession(session.id).subscribe({
      next: () => {
        this.deletingId.set(null);
        this.pendingDeleteId.set(null);
        this.fetch();
      },
      error: (err: unknown) => {
        this.deletingId.set(null);
        this.pendingDeleteId.set(null);
        this.deleteError.set(
          this.extractErrorMessage(err, 'Failed to delete the session.'),
        );
      },
    });
  }

  private extractErrorMessage(err: unknown, fallback: string): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as {
        error?: { message?: string | string[] };
        message?: string;
      };
      const msg = anyErr.error?.message ?? anyErr.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string') return msg;
    }
    return fallback;
  }
}
