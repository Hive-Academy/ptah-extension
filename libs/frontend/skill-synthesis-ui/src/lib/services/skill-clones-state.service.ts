import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  AgentScorecard,
  CloneSummary,
  SkillCloneHistoryEntry,
  SkillCloneKind,
  SkillSynthesisGetScorecardDetailResult,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

export interface SkillCloneDetail {
  readonly clone: CloneSummary | null;
  readonly body: string | null;
  readonly history: SkillCloneHistoryEntry[];
}

@Injectable({
  providedIn: 'root',
})
export class SkillClonesStateService {
  private readonly rpc = inject(SkillSynthesisRpcService);

  public readonly clones = signal<CloneSummary[]>([]);
  public readonly loading = signal<boolean>(false);
  public readonly error = signal<string | null>(null);

  public readonly selectedSlug = signal<string | null>(null);
  public readonly selectedKind = signal<SkillCloneKind | null>(null);
  public readonly detail = signal<SkillCloneDetail | null>(null);
  public readonly detailLoading = signal<boolean>(false);

  /**
   * Slug-keyed batched scorecards for agent-kind clones, populated by ONE
   * `getScorecards` call after each `refreshClones`. A slug absent from the
   * map has no data yet — consumers must treat missing as "no data yet",
   * never as zeros (R6.3).
   */
  public readonly scorecards = signal<Record<string, AgentScorecard>>({});
  /** Lazily-loaded, per-slug scorecard detail (rows + findings excerpt). */
  public readonly scorecardDetails = signal<
    Record<string, SkillSynthesisGetScorecardDetailResult>
  >({});
  /** Slug whose detail is currently being fetched, or `null` when idle. */
  public readonly scorecardDetailLoading = signal<string | null>(null);

  public readonly divergedCount = computed(
    () => this.clones().filter((c) => c.diverged).length,
  );

  public async refreshClones(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const list = await this.rpc.listClones();
      this.clones.set(list);
      await this.loadScorecards(list);
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * One batched scorecard fetch for every agent-kind slug in the list. Runs
   * after the clone list lands; a failure here degrades to no scorecards
   * (usage-only cards) rather than blanking the whole Library — the clone
   * table has already rendered successfully.
   */
  private async loadScorecards(list: CloneSummary[]): Promise<void> {
    const slugs = list.filter((c) => c.kind === 'agent').map((c) => c.slug);
    if (slugs.length === 0) {
      this.scorecards.set({});
      return;
    }
    try {
      const map = await this.rpc.getScorecards(slugs);
      this.scorecards.set(map);
    } catch {
      this.scorecards.set({});
    }
  }

  /**
   * Lazily fetch the detail for a single agent slug on card expansion.
   * Cached per slug: a re-expansion of an already-loaded slug is a no-op.
   */
  public async loadScorecardDetail(
    slug: string,
    limit?: number,
  ): Promise<void> {
    if (this.scorecardDetails()[slug]) return;
    this.scorecardDetailLoading.set(slug);
    try {
      const detail = await this.rpc.getScorecardDetail(slug, limit);
      this.scorecardDetails.update((m) => ({ ...m, [slug]: detail }));
    } catch (err) {
      this.error.set(this.toMessage(err));
    } finally {
      this.scorecardDetailLoading.set(null);
    }
  }

  public async loadDetail(slug: string, kind: SkillCloneKind): Promise<void> {
    this.selectedSlug.set(slug);
    this.selectedKind.set(kind);
    this.detailLoading.set(true);
    this.error.set(null);
    try {
      const detail = await this.rpc.getClone(slug, kind);
      this.detail.set(detail);
    } catch (err) {
      this.error.set(this.toMessage(err));
      this.detail.set(null);
    } finally {
      this.detailLoading.set(false);
    }
  }

  public clearDetail(): void {
    this.selectedSlug.set(null);
    this.selectedKind.set(null);
    this.detail.set(null);
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
