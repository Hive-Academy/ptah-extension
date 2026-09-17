import { Injectable, computed, signal } from '@angular/core';

import { AdminApproveWaitlistResponse } from '../services/admin-api.service';
import {
  WaitlistEligibleIdsResponse,
  WaitlistListRow,
} from './waitlist-query-state';

export type SelectionScope = 'explicit' | 'matching';
export type PageSelectionStatus = 'none' | 'all' | 'mixed';

/**
 * Component-scoped, signal-based selection state for the Waitlist Pipeline.
 *
 * Enforces:
 * - Only approvalEligible rows can be selected.
 * - Supports explicit individual and page-level selection across pages.
 * - Supports capped "select matching" (at most 50 ids) with 50-of-N disclosure.
 * - Handles partial approval outcomes (retains failed & not_found, clears approved).
 * - Transport failures are non-events that preserve selection.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- component-scoped, provided by WaitlistPipeline.
@Injectable()
export class WaitlistSelectionState {
  public readonly limit = 50 as const;

  private readonly _ids = signal<ReadonlySet<string>>(new Set<string>());
  public readonly ids = this._ids.asReadonly();

  private readonly _scope = signal<SelectionScope>('explicit');
  public readonly scope = this._scope.asReadonly();

  private readonly _eligibleMatching = signal<number | null>(null);
  public readonly eligibleMatching = this._eligibleMatching.asReadonly();

  public readonly count = computed<number>(() => this._ids().size);
  public readonly selectedIds = computed<readonly string[]>(() =>
    Array.from(this._ids()),
  );

  public readonly limitReached = computed<boolean>(
    () => this._ids().size >= this.limit,
  );
  public readonly selectionLimitReached = this.limitReached;

  public readonly isTruncatedMatching = computed<boolean>(() => {
    const matching = this._eligibleMatching();
    return (
      this._scope() === 'matching' &&
      matching !== null &&
      matching > this.count()
    );
  });

  /**
   * Accessible disclosure label for SelectionToolbar:
   * e.g. "50 selected of 120 matching" or "3 selected"
   */
  public readonly disclosureLabel = computed<string>(() => {
    const c = this.count();
    if (c === 0) return '0 selected';
    if (this._scope() === 'matching' && this._eligibleMatching() !== null) {
      const matching = this._eligibleMatching();
      if (matching !== null && matching > c) {
        return `${c} selected of ${matching} matching`;
      }
    }
    return `${c} selected`;
  });

  public isSelected(id: string): boolean {
    return this._ids().has(id);
  }

  /**
   * Toggles a single row's selection. Ineligible rows are strictly ignored.
   * Caps selection at 50 IDs.
   */
  public toggleRow(row: WaitlistListRow): void {
    if (!row.approvalEligible) return;

    const next = new Set(this._ids());
    if (next.has(row.id)) {
      next.delete(row.id);
    } else {
      if (next.size >= this.limit) {
        return;
      }
      next.add(row.id);
    }

    this._ids.set(next);
    this._scope.set('explicit');
    this._eligibleMatching.set(null);
  }

  /**
   * Calculates selection state for the provided page of rows:
   * 'none' = 0 eligible selected
   * 'all'  = all eligible rows selected
   * 'mixed'= some eligible rows selected
   */
  public pageStatus(rows: readonly WaitlistListRow[]): PageSelectionStatus {
    const eligible = rows.filter((r) => r.approvalEligible);
    if (eligible.length === 0) return 'none';

    const selectedCount = eligible.filter((r) => this._ids().has(r.id)).length;
    if (selectedCount === 0) return 'none';
    if (selectedCount === eligible.length) return 'all';
    return 'mixed';
  }

  /**
   * Selects or deselects all eligible rows on the current page.
   * If all eligible rows are currently selected, deselects them.
   * Otherwise selects eligible rows up to the 50 limit.
   */
  public selectPage(rows: readonly WaitlistListRow[]): void {
    const eligible = rows.filter((r) => r.approvalEligible);
    if (eligible.length === 0) return;

    const next = new Set(this._ids());
    const allSelected = eligible.every((r) => next.has(r.id));

    if (allSelected) {
      for (const r of eligible) {
        next.delete(r.id);
      }
    } else {
      for (const r of eligible) {
        if (next.size >= this.limit) {
          break;
        }
        next.add(r.id);
      }
    }

    this._ids.set(next);
    this._scope.set('explicit');
    this._eligibleMatching.set(null);
  }

  /**
   * Replaces selection with up to 50 server-resolved eligible matching IDs.
   */
  public selectMatching(res: WaitlistEligibleIdsResponse): void {
    this._ids.set(new Set(res.ids));
    this._scope.set('matching');
    this._eligibleMatching.set(res.eligibleMatching);
  }

  /**
   * Clears selection completely.
   */
  public clear(): void {
    this._ids.set(new Set());
    this._scope.set('explicit');
    this._eligibleMatching.set(null);
  }

  /**
   * After a bulk approval response (HTTP 200), retain only 'failed' and 'not_found'
   * ids for retry; remove 'approved', 'already_approved', and 'already_paid'.
   */
  public handleApprovalResult(res: AdminApproveWaitlistResponse): void {
    const next = new Set(this._ids());

    for (const result of res.results) {
      if (
        result.outcome === 'approved' ||
        result.outcome === 'already_approved' ||
        result.outcome === 'already_paid'
      ) {
        next.delete(result.id);
      }
      // 'failed' and 'not_found' are retained
    }

    this._ids.set(next);
    this._scope.set('explicit');
    this._eligibleMatching.set(null);
  }

  /**
   * Transport error does not alter selection (R3.5 / R9.6).
   */
  public handleTransportFailure(): void {
    // Deliberate no-op: preserve current selection for retry
  }
}
