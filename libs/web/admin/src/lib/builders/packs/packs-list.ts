import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Package } from 'lucide-angular';

import {
  AdminBuildersApiService,
  Pack,
} from '../../services/admin-builders-api.service';
import { EmptyState } from '../../components/empty-state/empty-state';
import { StatusBadge } from '../../components/status-badge/status-badge';
import { DeletePackModal } from './components/delete-pack-modal/delete-pack-modal';
import { PackFormModal } from './components/pack-form-modal/pack-form-modal';

/** One selectable cohort option in the list filter. */
interface CohortFilterOption {
  key: string;
  name: string;
}

/**
 * PacksList — admin registry of the GitHub repositories shared with Builders
 * cohorts. Route: `/admin/builders/packs`.
 *
 * ⚠️ THIS VIEW IS A RECORD, NOT A DISTRIBUTION TOOL. Ptah never serves pack
 * content and never decides who may read a repo — access is granted on GitHub
 * (collaborator invite, GitHub team, or the repo link posted in that cohort's
 * Discourse group). The cohort column is a bookkeeping label: editing it grants
 * and revokes nothing. The header subtitle and the form's helper text say so
 * explicitly, because an operator who believes otherwise would mis-administer
 * the feature (TASK_2026_169 risk L12).
 *
 * Deliberately NOT wired through the generic `DataTable` — that component needs
 * a `FieldSpec[]` from `admin-models.config` and has no action-column slot, and
 * `builders/packs` is not an `AdminModelKey`. Hand-rolled `<table class="table">`
 * mirroring `groups-list.html`, the same call `GroupsList` made.
 */
@Component({
  selector: 'ptah-admin-packs-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [EmptyState, StatusBadge, PackFormModal, DeletePackModal],
  templateUrl: './packs-list.html',
})
export class PacksList {
  private readonly api = inject(AdminBuildersApiService);

  protected readonly PackageIcon = Package;

  protected readonly packs = signal<Pack[]>([]);
  protected readonly loading = signal<boolean>(false);
  protected readonly error = signal<string | null>(null);

  /** Draft search text — applied to the server query on submit, not per keystroke. */
  protected readonly searchDraft = signal<string>('');
  /** Search term currently reflected in `packs()`. */
  protected readonly appliedSearch = signal<string>('');
  /** Active cohort filter (`''` = every cohort). */
  protected readonly cohortFilter = signal<string>('');

  /** Form modal state — `null` pack means create mode. */
  protected readonly formOpen = signal<boolean>(false);
  protected readonly formTarget = signal<Pack | null>(null);

  /** Delete confirmation state. */
  protected readonly deleteOpen = signal<boolean>(false);
  protected readonly deleteTarget = signal<Pack | null>(null);

  /**
   * Cohort options for the filter, derived from the rows already loaded rather
   * than a second `listGroups()` call. A cohort with no packs is not offered —
   * selecting it could only ever yield an empty table. The form modal still
   * needs the full group list, and is the only place that fetches it.
   */
  protected readonly cohortOptions = computed<CohortFilterOption[]>(() => {
    const seen = new Map<string, string>();
    for (const p of this.packs()) {
      if (p.cohortKey && !seen.has(p.cohortKey)) {
        seen.set(p.cohortKey, p.cohortName ?? p.cohortKey);
      }
    }
    return [...seen.entries()]
      .map(([key, name]) => ({ key, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  /** True when a filter is narrowing the list — changes the empty-state copy. */
  protected readonly isFiltered = computed<boolean>(
    () => this.appliedSearch().length > 0 || this.cohortFilter().length > 0,
  );

  public constructor() {
    this.fetch();
  }

  protected fetch(): void {
    this.loading.set(true);
    this.error.set(null);
    const search = this.appliedSearch();
    const cohortKey = this.cohortFilter();
    this.api
      .listPacks({
        search: search.length > 0 ? search : undefined,
        cohortKey: cohortKey.length > 0 ? cohortKey : undefined,
      })
      .subscribe({
        next: (packs) => {
          this.packs.set(packs);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.error.set(this.extractErrorMessage(err));
        },
      });
  }

  protected onSearchInput(event: Event): void {
    this.searchDraft.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
  }

  protected onSearchSubmit(event: Event): void {
    event.preventDefault();
    this.appliedSearch.set(this.searchDraft().trim());
    this.fetch();
  }

  protected onCohortFilterChange(event: Event): void {
    this.cohortFilter.set(
      (event.target as HTMLSelectElement | null)?.value ?? '',
    );
    this.fetch();
  }

  protected clearFilters(): void {
    this.searchDraft.set('');
    this.appliedSearch.set('');
    this.cohortFilter.set('');
    this.fetch();
  }

  protected openCreate(): void {
    this.formTarget.set(null);
    this.formOpen.set(true);
  }

  protected openEdit(pack: Pack): void {
    this.formTarget.set(pack);
    this.formOpen.set(true);
  }

  protected onFormClose(): void {
    this.formOpen.set(false);
  }

  protected onFormSaved(): void {
    this.formOpen.set(false);
    this.fetch();
  }

  protected openDelete(pack: Pack): void {
    this.deleteTarget.set(pack);
    this.deleteOpen.set(true);
  }

  protected onDeleteClose(): void {
    this.deleteOpen.set(false);
  }

  protected onDeleted(): void {
    this.deleteOpen.set(false);
    this.fetch();
  }

  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const anyErr = err as { error?: { message?: string }; message?: string };
      return anyErr.error?.message ?? anyErr.message ?? 'Failed to load packs.';
    }
    return 'Failed to load packs.';
  }
}
