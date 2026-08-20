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
} from '../../services/admin-api.service';
import { ADMIN_MODEL_SPECS } from '../../admin-models.config';
import type { BadgeVariant } from '@ptah-web/panel-ui';
import { DeleteUserModalComponent } from '../../components/delete-user-modal/delete-user-modal';
import { IssueCompLicenseModalComponent } from '../../components/issue-comp-license-modal/issue-comp-license-modal';
import { StatusBadge } from '@ptah-web/panel-ui';
import {
  Entitlement,
  LicenseRecord,
  SubscriptionRecord,
  UserWithBilling,
  deriveEntitlement,
  isExpiringSoon,
} from '../entitlement';

type RelatedStatus = 'loading' | 'ok' | 'error';

interface RelatedState {
  status: RelatedStatus;
  rows: Record<string, unknown>[];
  total: number;
}

const EMPTY_RELATED: RelatedState = { status: 'loading', rows: [], total: 0 };

/**
 * UserProfile — the single billing surface for one user. Route
 * `/admin/users/:id`.
 *
 * This view ABSORBED the former standalone Licenses and Subscriptions tabs.
 * Where the previous version showed a three-column strip of related-record
 * chips (plan name + status, nothing more) and punted to two other pages, the
 * billing section is now the destination: full license rows, full Paddle
 * subscription rows, and — the point of the merge — an explicit reconciliation
 * between them, since the schema has no FK to make that link for us.
 *
 * ONE REQUEST, NOT THREE. `ADMIN_MODELS.users.include` ships `licenses` and
 * `subscriptions` on `GET /records/users/:id`, so the old "poor man's join"
 * (three `list(model, {search: userId})` calls, each capped at 5 rows and
 * matching on a free-text id) is gone for both billing relations. Session
 * requests are not part of the merge and keep their existing lookup.
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

  protected readonly user = signal<UserWithBilling | null>(null);
  protected readonly loading = signal<boolean>(false);
  protected readonly loadError = signal<string | null>(null);

  protected readonly sessions = signal<RelatedState>(EMPTY_RELATED);

  /** The license ↔ subscription join, derived from the single user payload. */
  protected readonly entitlement = computed<Entitlement | null>(() => {
    const u = this.user();
    return u ? deriveEntitlement(u) : null;
  });

  protected readonly licenses = computed<readonly LicenseRecord[]>(
    () => this.user()?.licenses ?? [],
  );
  protected readonly subscriptions = computed<readonly SubscriptionRecord[]>(
    () => this.user()?.subscriptions ?? [],
  );

  // Status badge maps borrowed from the shared model config so the merged
  // billing rows keep the exact color semantics the old dedicated lists used.
  protected readonly licenseStatusMap = this.badgeMapFor('licenses', 'status');
  protected readonly licenseSourceMap = this.badgeMapFor('licenses', 'source');
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
      this.loadRelatedList('session-requests', id, this.sessions);
    });
  }

  private loadUser(id: string): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.user.set(null);
    this.api.get<UserWithBilling>('users', id).subscribe({
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

  protected isExpiringSoon = isExpiringSoon;

  /**
   * The subscription a license is attributable to, or null.
   *
   * There is no FK to follow: a license only claims a Paddle origin via its
   * `source`, and the user's subscriptions are the only candidates. So a
   * Paddle-sourced license resolves to the live subscription (falling back to
   * the most recent one when none is live), and anything else — complimentary,
   * manual, signup — resolves to null BY DESIGN. Those licenses were never
   * paid for, and pairing them with an unrelated subscription would invent a
   * link the data does not support.
   */
  protected linkedSubscription(
    license: LicenseRecord,
  ): SubscriptionRecord | null {
    if (license.source !== 'paddle') return null;
    const e = this.entitlement();
    return e?.liveSubscription ?? this.subscriptions()[0] ?? null;
  }

  /** Explains a null `linkedSubscription` in the license row's own terms. */
  protected unlinkedReason(license: LicenseRecord): string {
    if (license.source === 'paddle') {
      return 'No Paddle subscription on file';
    }
    return `Not a Paddle sale (${license.source})`;
  }

  // --- Actions -------------------------------------------------------------
  protected openIssueLicense(): void {
    this.compLicenseModal()?.open();
  }

  protected openDelete(): void {
    this.deleteUserModal()?.open();
  }

  /** Re-reads the user so the merged billing section picks up the new license. */
  protected onLicenseIssued(): void {
    const id = this.userId();
    if (id) this.loadUser(id);
  }

  protected onUserDeleted(): void {
    this.router.navigate(['/admin', 'users']);
  }

  protected back(): void {
    this.router.navigate(['/admin', 'users']);
  }
}
