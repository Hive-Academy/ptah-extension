import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import {
  AdminApiService,
  AssignGroupMembersResponse,
  MemberGroup,
} from '../../services/admin-api.service';
import {
  AdminBuildersApiService,
  GroupMember,
} from '../../services/admin-builders-api.service';
import { DetailDrawer } from '../../components/detail-drawer/detail-drawer';
import { AssignMembersModal } from '../components/assign-members-modal/assign-members-modal';
import { GroupFormModal } from '../components/group-form-modal/group-form-modal';

/**
 * GroupsList — dedicated management view for member cohorts (`MemberGroup`).
 *
 * Route: `/admin/groups`. Intentionally NOT wired through the generic
 * `ADMIN_MODEL_SPECS` / `AdminList` table — groups have bespoke endpoints
 * (`/api/v1/admin/groups/*`) and actions (create/edit/assign) rather than
 * the generic list/patch CRUD contract.
 *
 * Group-members drill-down (TASK_2026_169 / F3d): this view previously noted
 * that the backend exposed `DELETE /groups/:id/members/:userId` (remove-by-id)
 * with no way to list a group's members, so there was nothing to browse in
 * order to pick someone to unassign. `GET /admin/groups/:id/members` closes
 * that gap; the "Members" action opens a `DetailDrawer` with a paginated,
 * email-searchable roster and a per-row Remove.
 */
@Component({
  selector: 'ptah-admin-groups-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, DetailDrawer, GroupFormModal, AssignMembersModal],
  templateUrl: './groups-list.html',
})
export class GroupsList {
  private readonly api = inject(AdminApiService);
  private readonly buildersApi = inject(AdminBuildersApiService);

  protected readonly groups = signal<MemberGroup[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);

  /** Form modal state — `null` group means create mode. */
  protected readonly formOpen = signal<boolean>(false);
  protected readonly formTarget = signal<MemberGroup | null>(null);

  /** Assign-members modal state. */
  protected readonly assignOpen = signal<boolean>(false);
  protected readonly assignTarget = signal<MemberGroup | null>(null);

  /** Most recent assign result — drives the success toast. */
  protected readonly assignToast = signal<AssignGroupMembersResponse | null>(
    null,
  );

  /** Members drill-down drawer state. */
  protected readonly membersOpen = signal<boolean>(false);
  protected readonly membersTarget = signal<MemberGroup | null>(null);
  protected readonly members = signal<GroupMember[]>([]);
  protected readonly membersTotal = signal<number>(0);
  protected readonly membersPage = signal<number>(1);
  protected readonly membersLoading = signal<boolean>(false);
  protected readonly membersError = signal<string | null>(null);
  /** Draft search text — applied on submit, not per keystroke. */
  protected readonly memberSearchDraft = signal<string>('');
  protected readonly memberSearch = signal<string>('');
  /** User id currently being removed, so only that row shows a spinner. */
  protected readonly removingUserId = signal<string | null>(null);

  protected readonly membersPageSize = 25;

  protected readonly membersTotalPages = computed<number>(() =>
    Math.max(1, Math.ceil(this.membersTotal() / this.membersPageSize)),
  );

  public constructor() {
    this.fetch();
  }

  protected fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.listGroups().subscribe({
      next: (groups) => {
        this.groups.set(groups);
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.error.set(this.extractErrorMessage(err));
      },
    });
  }

  protected openCreate(): void {
    this.formTarget.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(group: MemberGroup): void {
    this.formTarget.set(group);
    this.formOpen.set(true);
  }

  protected onFormClose(): void {
    this.formOpen.set(false);
  }

  protected onFormSaved(): void {
    this.formOpen.set(false);
    this.fetch();
  }

  protected openAssign(group: MemberGroup): void {
    this.assignToast.set(null);
    this.assignTarget.set(group);
    this.assignOpen.set(true);
  }

  protected onAssignClose(): void {
    this.assignOpen.set(false);
  }

  protected onAssignSubmitted(result: AssignGroupMembersResponse): void {
    this.assignToast.set(result);
    this.fetch();
    setTimeout(() => {
      this.assignOpen.set(false);
    }, 1200);
    setTimeout(() => {
      if (this.assignToast() === result) {
        this.assignToast.set(null);
      }
    }, 6000);
  }

  protected openMembers(group: MemberGroup): void {
    this.membersTarget.set(group);
    this.membersOpen.set(true);
    this.members.set([]);
    this.membersTotal.set(0);
    this.membersPage.set(1);
    this.memberSearchDraft.set('');
    this.memberSearch.set('');
    this.membersError.set(null);
    this.fetchMembers();
  }

  protected closeMembers(): void {
    this.membersOpen.set(false);
  }

  protected fetchMembers(): void {
    const group = this.membersTarget();
    if (!group) return;
    this.membersLoading.set(true);
    this.membersError.set(null);
    const search = this.memberSearch();
    this.buildersApi
      .listGroupMembers(group.id, {
        page: this.membersPage(),
        pageSize: this.membersPageSize,
        search: search.length > 0 ? search : undefined,
      })
      .subscribe({
        next: (res) => {
          this.members.set(res.members);
          this.membersTotal.set(res.total);
          this.membersLoading.set(false);
        },
        error: (err: unknown) => {
          this.membersLoading.set(false);
          this.membersError.set(
            this.extractErrorMessage(err, 'Failed to load group members.'),
          );
        },
      });
  }

  protected onMemberSearchInput(event: Event): void {
    this.memberSearchDraft.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
  }

  protected onMemberSearchSubmit(event: Event): void {
    event.preventDefault();
    this.memberSearch.set(this.memberSearchDraft().trim());
    this.membersPage.set(1);
    this.fetchMembers();
  }

  protected goToMembersPage(page: number): void {
    if (page < 1 || page > this.membersTotalPages()) return;
    this.membersPage.set(page);
    this.fetchMembers();
  }

  /**
   * Removes one user from the open cohort. Idempotent server-side, so a
   * double-click cannot fail; the list and the group's member count are both
   * refreshed afterwards so the table behind the drawer stays truthful.
   */
  protected removeMember(member: GroupMember): void {
    const group = this.membersTarget();
    if (!group || this.removingUserId() !== null) return;
    this.removingUserId.set(member.userId);
    this.membersError.set(null);
    this.api.unassignGroupMember(group.id, member.userId).subscribe({
      next: () => {
        this.removingUserId.set(null);
        // Stepping back a page when the last row of a non-first page is
        // removed avoids landing on an empty page.
        if (this.members().length === 1 && this.membersPage() > 1) {
          this.membersPage.update((p) => p - 1);
        }
        this.fetchMembers();
        this.fetch();
      },
      error: (err: unknown) => {
        this.removingUserId.set(null);
        this.membersError.set(
          this.extractErrorMessage(err, 'Failed to remove the member.'),
        );
      },
    });
  }

  protected memberName(member: GroupMember): string {
    const parts = [member.firstName, member.lastName].filter(
      (p): p is string => !!p && p.length > 0,
    );
    return parts.length > 0 ? parts.join(' ') : '—';
  }

  private extractErrorMessage(
    err: unknown,
    fallback = 'Failed to load groups.',
  ): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as { error?: { message?: string }; message?: string };
      return anyErr.error?.message ?? anyErr.message ?? fallback;
    }
    return fallback;
  }
}
