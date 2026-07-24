import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  signal,
} from '@angular/core';

import {
  AdminApiService,
  AssignGroupMembersResponse,
  MemberGroup,
} from '../../../../services/admin-api.service';
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
 * No group-members drill-down: the backend only exposes
 * `DELETE /groups/:id/members/:userId` (remove-by-id), not a
 * "list members of group X" endpoint, so there is nothing to browse to pick
 * a user to unassign from. Flagged for the server owner.
 */
@Component({
  selector: 'ptah-admin-groups-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, GroupFormModal, AssignMembersModal],
  templateUrl: './groups-list.html',
})
export class GroupsList {
  private readonly api = inject(AdminApiService);

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

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as { error?: { message?: string }; message?: string };
      return (
        anyErr.error?.message ?? anyErr.message ?? 'Failed to load groups.'
      );
    }
    return 'Failed to load groups.';
  }
}
