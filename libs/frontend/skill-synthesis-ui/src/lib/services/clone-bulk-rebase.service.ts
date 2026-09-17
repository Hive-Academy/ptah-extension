/**
 * CloneBulkRebaseService — run the EXISTING per-clone rebase once per eligible
 * entry, sequentially, surviving individual failures.
 *
 * There is no bulk RPC and deliberately no second rebase implementation: this
 * loops over `skillSynthesis:rebaseClone`, the same call the per-card Rebase
 * button makes. Eligibility is not decided here — that lives in
 * `clone-action-gating.ts` and arrives as the argument. Rendering and the
 * post-batch list refresh belong to the caller.
 *
 * SEQUENTIAL BY DESIGN. `Promise.all` is rejected: the backend's `withSlugLock`
 * serialises only per slug, so N parallel rebases run N full tree hashes and
 * tree copies at once for no wall-clock win, and they destroy deterministic
 * per-entry progress.
 *
 * NEVER ABORTS EARLY. Each iteration is individually try/caught. A thrown
 * transport error and a soft `failed: true` result both become an outcome
 * naming the slug, and the loop continues to the next entry. `running` clears
 * in a `finally`, so an unexpected throw cannot leave the surface permanently
 * disabled.
 */
import { Injectable, computed, inject, signal } from '@angular/core';
import type { CloneSummary } from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

/** What happened to one member of the batch. */
export interface BulkRebaseOutcome {
  readonly slug: string;
  readonly ok: boolean;
  /** User-facing failure reason, or `null` on success. */
  readonly reason: string | null;
}

/** How far through the batch we are, or `null` when idle. */
export interface BulkRebaseProgress {
  readonly done: number;
  readonly total: number;
}

function failureReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/*
 * ⚠️ NO `providedIn`, DELIBERATELY, AND THE RULE IS DISABLED FOR ONE LINE
 * RATHER THAN LOOSENED. This service holds ONE SURFACE'S batch state —
 * `running`, `progress`, `outcomes` — and is listed in the clones view's own
 * `providers`. `providedIn: 'root'` would make a finished batch's outcomes
 * outlive the surface and reappear on the next visit; `providedIn: 'any'`
 * would hand each lazy route a separate copy while looking global.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- per-surface, provided by SkillClonesViewComponent; see the note above.
@Injectable()
export class CloneBulkRebaseService {
  private readonly rpc = inject(SkillSynthesisRpcService);

  private readonly _running = signal(false);
  private readonly _progress = signal<BulkRebaseProgress | null>(null);
  private readonly _outcomes = signal<readonly BulkRebaseOutcome[]>([]);

  /** A batch is in flight. The caller locks conflicting controls on this. */
  public readonly running = this._running.asReadonly();
  public readonly progress = this._progress.asReadonly();
  public readonly outcomes = this._outcomes.asReadonly();

  /** Slugs that failed, in attempt order — the summary toast names these. */
  public readonly failedSlugs = computed(() =>
    this._outcomes()
      .filter((o) => !o.ok)
      .map((o) => o.slug),
  );

  /**
   * Rebase every supplied clone, one at a time.
   *
   * @param clones the already-filtered eligible set (see `eligibleForBulkRebase`)
   * @returns one outcome per supplied clone, in the order they were attempted
   */
  public async run(
    clones: readonly CloneSummary[],
  ): Promise<readonly BulkRebaseOutcome[]> {
    const outcomes: BulkRebaseOutcome[] = [];
    this._outcomes.set([]);
    this._progress.set({ done: 0, total: clones.length });
    this._running.set(true);

    try {
      for (const clone of clones) {
        outcomes.push(await this.rebaseOne(clone));
        this._outcomes.set([...outcomes]);
        this._progress.set({ done: outcomes.length, total: clones.length });
      }
      return outcomes;
    } finally {
      this._running.set(false);
    }
  }

  /** One attempt. Never throws — both failure channels become an outcome. */
  private async rebaseOne(clone: CloneSummary): Promise<BulkRebaseOutcome> {
    try {
      const result = await this.rpc.rebaseClone(clone.kind, clone.slug);
      if (result.failed) {
        return {
          slug: clone.slug,
          ok: false,
          reason: result.reason ?? 'Rebase failed.',
        };
      }
      return { slug: clone.slug, ok: true, reason: null };
    } catch (error: unknown) {
      return { slug: clone.slug, ok: false, reason: failureReason(error) };
    }
  }
}
