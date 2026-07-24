import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ArrowLeft, LucideAngularModule } from 'lucide-angular';

import {
  AdminApiService,
  AdminModelKey,
} from '../../../../services/admin-api.service';
import { ADMIN_MODEL_SPECS, BadgeVariant } from '../../admin-models.config';
import { DeleteUserModalComponent } from '../../components/delete-user-modal/delete-user-modal';
import { IssueCompLicenseModalComponent } from '../../components/issue-comp-license-modal/issue-comp-license-modal';
import { StatusBadge } from '../../components/status-badge/status-badge';

interface UserRecord {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  emailVerified: boolean;
  workosId: string | null;
  paddleCustomerId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

type RelatedStatus = 'loading' | 'ok' | 'error';

interface RelatedState {
  status: RelatedStatus;
  rows: Record<string, unknown>[];
  total: number;
}

const EMPTY_RELATED: RelatedState = { status: 'loading', rows: [], total: 0 };

/**
 * UserProfile — bespoke detail surface for a single user (design spec §4.4.2),
 * replacing the generic `AdminDetail` for the `users` route only. Route
 * `/admin/users/:id`.
 *
 * Three stacked cards instead of a flat `<dl>`:
 *   1. Identity — avatar-initial, verified `StatusBadge`, demoted mono IDs.
 *   2. Related records — Licenses / Subscriptions / Session Requests, each a
 *      poor-man's join via `AdminApiService.list(model, {search: userId})`
 *      (those models advertise "…user ID…" as a searched field) with a
 *      "View all →" handoff.
 *   3. Danger zone — Issue Comp License (bound `userId`) + Delete User,
 *      visually separated so a destructive action never sits at equal weight.
 */
@Component({
  selector: 'ptah-admin-user-profile',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    DatePipe,
    RouterLink,
    LucideAngularModule,
    StatusBadge,
    IssueCompLicenseModalComponent,
    DeleteUserModalComponent,
  ],
  templateUrl: './user-profile.html',
})
export class UserProfile {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly api = inject(AdminApiService);

  protected readonly compLicenseModal = viewChild(
    IssueCompLicenseModalComponent,
  );
  protected readonly deleteUserModal = viewChild(DeleteUserModalComponent);

  protected readonly ArrowLeftIcon = ArrowLeft;

  private readonly idParam = toSignal(this.route.paramMap, {
    initialValue: this.route.snapshot.paramMap,
  });

  protected readonly userId = computed<string | null>(
    () => this.idParam()?.get('id') ?? null,
  );

  protected readonly user = signal<UserRecord | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadError = signal<string | null>(null);

  protected readonly licenses = signal<RelatedState>(EMPTY_RELATED);
  protected readonly subscriptions = signal<RelatedState>(EMPTY_RELATED);
  protected readonly sessions = signal<RelatedState>(EMPTY_RELATED);

  // Status badge maps borrowed from the shared model config so related-record
  // chips match the color semantics used on the dedicated list views.
  protected readonly licenseStatusMap = this.badgeMapFor('licenses', 'status');
  protected readonly subStatusMap = this.badgeMapFor('subscriptions', 'status');
  protected readonly sessionStatusMap = this.badgeMapFor(
    'session-requests',
    'status',
  );

  protected readonly initials = computed<string>(() => {
    const u = this.user();
    if (!u) return '?';
    const first = u.firstName?.trim();
    const last = u.lastName?.trim();
    if (first || last) {
      return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
    }
    return (u.email?.[0] ?? '?').toUpperCase();
  });

  protected readonly fullName = computed<string>(() => {
    const u = this.user();
    if (!u) return '';
    const name = [u.firstName, u.lastName].filter(Boolean).join(' ').trim();
    return name || u.email;
  });

  public constructor() {
    effect(() => {
      const id = this.userId();
      if (!id) {
        this.user.set(null);
        return;
      }
      this.loadUser(id);
      this.loadRelated(id);
    });
  }

  private loadUser(id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.user.set(null);
    this.api.get<UserRecord>('users', id).subscribe({
      next: (u) => {
        this.user.set(u);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
        this.loadError.set('Failed to load user.');
      },
    });
  }

  private loadRelated(id: string): void {
    this.loadRelatedList('licenses', id, this.licenses);
    this.loadRelatedList('subscriptions', id, this.subscriptions);
    this.loadRelatedList('session-requests', id, this.sessions);
  }

  private loadRelatedList(
    model: AdminModelKey,
    id: string,
    target: ReturnType<typeof signal<RelatedState>>,
  ): void {
    target.set({ status: 'loading', rows: [], total: 0 });
    this.api.list(model, { search: id, pageSize: 5 }).subscribe({
      next: (res) =>
        target.set({ status: 'ok', rows: res.data, total: res.total }),
      error: () => target.set({ status: 'error', rows: [], total: 0 }),
    });
  }

  private badgeMapFor(
    modelKey: string,
    fieldKey: string,
  ): Record<string, BadgeVariant> | undefined {
    return ADMIN_MODEL_SPECS.find((s) => s.key === modelKey)?.fields.find(
      (f) => f.key === fieldKey,
    )?.badgeMap;
  }

  // --- Template helpers ----------------------------------------------------
  protected asString(value: unknown): string {
    if (value == null || value === '') return '—';
    return String(value);
  }

  // --- Actions -------------------------------------------------------------
  protected openIssueLicense(): void {
    this.compLicenseModal()?.open();
  }

  protected openDelete(): void {
    this.deleteUserModal()?.open();
  }

  protected onLicenseIssued(): void {
    const id = this.userId();
    if (id) this.loadRelatedList('licenses', id, this.licenses);
  }

  protected onUserDeleted(): void {
    this.router.navigate(['/admin', 'users']);
  }

  protected back(): void {
    this.router.navigate(['/admin', 'users']);
  }
}
