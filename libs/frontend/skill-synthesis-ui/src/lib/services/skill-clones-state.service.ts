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

  /**
   * Which entry the value in `detail` describes, or `null` when none is held.
   *
   * A plain field, not a signal: nothing renders it, it exists only to keep
   * `detail` from ever being read as belonging to an entry it was not fetched
   * for. See {@link loadDetail} for why that matters.
   */
  private detailKey: string | null = null;

  /**
   * Fetch the detail for one entry, holding `detail` COHERENT with the
   * selection for the whole round trip.
   *
   * Two rules, both about the same hazard — a body from entry A being read as
   * entry B's. The editor seeds its draft from `detail.body`, so a stale body
   * surviving a selection change is a wrong-content write that reports success:
   *
   * - Switching entries clears `detail` BEFORE the await. Between the click and
   *   the reply the body is `null`, which is what the edit gating already
   *   refuses, and `detailLoading` is what the drawer renders instead.
   * - A reply is applied only while it is still the selected entry's. Two
   *   loads in flight can land out of order, and the loser must not overwrite
   *   the winner — `detailLoading` stays true for the request that is still
   *   outstanding.
   *
   * A repeat load of the SAME entry (the post-save reload) keeps the held
   * detail on screen, so nothing blanks on a refresh.
   */
  public async loadDetail(slug: string, kind: SkillCloneKind): Promise<void> {
    const key = `${kind}/${slug}`;
    this.selectedSlug.set(slug);
    this.selectedKind.set(kind);
    if (this.detailKey !== key) {
      this.detailKey = key;
      this.detail.set(null);
    }
    this.detailLoading.set(true);
    this.error.set(null);
    try {
      const detail = await this.rpc.getClone(slug, kind);
      if (this.detailKey !== key) return;
      this.detail.set(detail);
    } catch (err) {
      // degradation-audit: reported — the live request's failure IS surfaced,
      // through `error` below, which the view renders as a toast. The bare
      // return above drops only a SUPERSEDED request's error: the user has
      // already selected a different entry, and reporting the loser of the
      // race would blame the wrong clone.
      if (this.detailKey !== key) return;
      this.error.set(this.toMessage(err));
      this.detail.set(null);
    } finally {
      if (this.detailKey === key) this.detailLoading.set(false);
    }
  }

  /**
   * Write a user-edited body for one clone, then reload the open detail.
   *
   * The reload is not cosmetic: the drawer leaves edit mode only once its
   * `body` input matches the text it submitted, so a save that did not reload
   * would keep the editor open over already-written content. Errors PROPAGATE
   * — the caller owns the toast, and swallowing here would look like success.
   */
  public async saveCloneBody(
    kind: SkillCloneKind,
    slug: string,
    body: string,
  ): Promise<void> {
    await this.rpc.saveCloneBody(kind, slug, body);
    await this.loadDetail(slug, kind);
  }

  public clearDetail(): void {
    this.selectedSlug.set(null);
    this.selectedKind.set(null);
    this.detailKey = null;
    this.detail.set(null);
    // Any reply still in flight is now orphaned by the key reset, so its
    // `finally` will not clear this — closing must, or a later reopen inherits
    // a stuck spinner.
    this.detailLoading.set(false);
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
