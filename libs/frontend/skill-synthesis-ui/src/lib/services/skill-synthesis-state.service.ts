import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  SkillSuggestionSummary,
  SkillSynthesisCandidateSummary,
  SkillSynthesisInvocationEntry,
  SkillSynthesisSettingsDto,
  SkillSynthesisStatsResult,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

/**
 * Coalesce a raw suggestion summary to safe defaults so a missing field
 * from a stale or partial RPC payload can never throw inside a computed
 * (a thrown computed poisons the entire Skills tab).
 */
function normalizeSuggestion(
  raw: Partial<SkillSuggestionSummary> | null | undefined,
): SkillSuggestionSummary {
  return {
    id: raw?.id ?? '',
    name: raw?.name ?? '(unnamed skill)',
    description: raw?.description ?? '',
    clusterSize: raw?.clusterSize ?? 0,
    technologyFingerprint: raw?.technologyFingerprint ?? '',
    judgeScore: raw?.judgeScore ?? 0,
    memberSessionIds: raw?.memberSessionIds ?? [],
    status: raw?.status ?? 'pending',
    createdAt: raw?.createdAt ?? 0,
  };
}

/** Status filter values for the candidates table. */
export type SkillStatusFilter = 'all' | 'pending' | 'promoted' | 'rejected';

/**
 * Map a UI-facing status filter to the backend `status` parameter
 * accepted by `skillSynthesis:listCandidates`.
 *
 * The backend uses `'candidate'` to mean the pending/awaiting-review
 * state; we surface it to the user as `'pending'` for clarity.
 */
function statusFilterToBackend(
  filter: SkillStatusFilter,
): 'candidate' | 'promoted' | 'rejected' | 'all' {
  return filter === 'pending' ? 'candidate' : filter;
}

/**
 * SkillSynthesisStateService
 *
 * Signal-based state container for the Skills tab. Owns the candidate
 * list, the active filter, the selected candidate's invocation history,
 * and aggregate stats. All mutations route through
 * {@link SkillSynthesisRpcService}.
 */
@Injectable({
  providedIn: 'root',
})
export class SkillSynthesisStateService {
  private readonly rpc = inject(SkillSynthesisRpcService);

  public readonly candidates = signal<SkillSynthesisCandidateSummary[]>([]);
  public readonly statusFilter = signal<SkillStatusFilter>('all');
  public readonly selectedCandidateId = signal<string | null>(null);
  public readonly invocations = signal<SkillSynthesisInvocationEntry[]>([]);
  public readonly stats = signal<SkillSynthesisStatsResult | null>(null);
  public readonly settings = signal<SkillSynthesisSettingsDto | null>(null);
  public readonly loading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);

  public readonly suggestions = signal<SkillSuggestionSummary[]>([]);
  public readonly suggestionsLoading = signal<boolean>(false);

  public readonly selectedCandidate = computed(() => {
    const id = this.selectedCandidateId();
    if (!id) return null;
    return this.candidates().find((c) => c.id === id) ?? null;
  });

  public readonly pendingSuggestionCount = computed(
    () => this.suggestions().filter((s) => s.status === 'pending').length,
  );

  /** Refresh the candidate list using the current `statusFilter()`. */
  public async refreshCandidates(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.rpc.listCandidates({
        status: statusFilterToBackend(this.statusFilter()),
      });
      this.candidates.set(list);
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Select a candidate (or clear selection with `null`) and load its
   * invocation history. The detail body itself isn't required for the
   * tab's drill-down panel — only invocations.
   */
  public async selectCandidate(id: string | null): Promise<void> {
    this.selectedCandidateId.set(id);
    if (!id) {
      this.invocations.set([]);
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    try {
      const entries = await this.rpc.invocations(id);
      this.invocations.set(entries);
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Promote a candidate. The optional `reason` is currently advisory —
   * the backend `skillSynthesis:promote` shape stores its own reason on
   * the result, but we accept one here to keep the modal UX symmetric
   * with reject. Refreshes the list on success.
   */
  public async promote(id: string, reason?: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.rpc.promote(id);
      void reason;
      await this.refreshCandidates();
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Reject a candidate, optionally with a reason. Refreshes on success. */
  public async reject(id: string, reason?: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      await this.rpc.reject(id, reason);
      await this.refreshCandidates();
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Refresh aggregate stats. */
  public async loadStats(): Promise<void> {
    try {
      const next = await this.rpc.stats();
      this.stats.set(next);
    } catch (err) {
      this.error.set(this.toMessage(err));
    }
  }

  /** Load settings from the backend into the settings signal. */
  public async loadSettings(): Promise<void> {
    try {
      const s = await this.rpc.getSettings();
      this.settings.set(s);
    } catch (err) {
      this.error.set(this.toMessage(err));
    }
  }

  /** Update the status filter and reload the list. */
  public async setStatusFilter(filter: SkillStatusFilter): Promise<void> {
    this.statusFilter.set(filter);
    await this.refreshCandidates();
  }

  /** Refresh the cluster-derived suggestion list. */
  public async refreshSuggestions(): Promise<void> {
    this.suggestionsLoading.set(true);
    this.error.set(null);
    try {
      const list = await this.rpc.listSuggestions();
      this.suggestions.set(list.map(normalizeSuggestion));
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.suggestionsLoading.set(false);
    }
  }

  /** Accept a suggestion (materializes a skill), then refresh the list. */
  public async accept(id: string): Promise<void> {
    this.suggestionsLoading.set(true);
    this.error.set(null);
    try {
      await this.rpc.acceptSuggestion(id);
      await this.refreshSuggestions();
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.suggestionsLoading.set(false);
    }
  }

  /** Dismiss a suggestion (optionally with a reason), then refresh. */
  public async dismiss(id: string, reason?: string): Promise<void> {
    this.suggestionsLoading.set(true);
    this.error.set(null);
    try {
      await this.rpc.dismissSuggestion(id, reason);
      await this.refreshSuggestions();
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.suggestionsLoading.set(false);
    }
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
