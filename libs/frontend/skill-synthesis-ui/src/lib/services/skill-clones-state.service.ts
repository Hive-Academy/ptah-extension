import {
  Injectable,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import {
  LibraryChangeFeed,
  type LibraryChange,
} from '@ptah-extension/marketplace/services';
import { provenanceLabel } from '@ptah-extension/shared';
import type {
  AgentOutcomeSignals,
  AgentScorecard,
  CloneSummary,
  SkillCloneHistoryEntry,
  SkillCloneKind,
  SkillSynthesisGetScorecardDetailResult,
  SkillSynthesisSaveCloneBodyResult,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from './skill-synthesis-rpc.service';

export interface SkillCloneDetail {
  readonly clone: CloneSummary | null;
  readonly body: string | null;
  readonly history: SkillCloneHistoryEntry[];
}

/**
 * The one line the Library shows after a `library:changed` push.
 *
 * `updated` is a `role=status` line ("Library updated: ..."); `failed` is the
 * C10 refresh-failure notice (`role=alert`). Both clear on the next push, on a
 * harness-root change and when a card is opened.
 */
export interface LibraryChangeNotice {
  readonly kind: 'updated' | 'failed';
  readonly message: string;
}

/** Design-spec 5, "refresh" failure string (C10). */
export const LIBRARY_REFRESH_FAILED_COPY =
  'Could not refresh the Library. The agents on disk are unchanged. It will update on the next refresh.';

/**
 * Design-spec 5, "refresh": "Library updated: <n> agents added by the setup
 * wizard." / "... by plugin <name>." The origin comes from the ADDED clones'
 * recorded provenance, never from the push's reasons, so the line only names
 * what the current list actually gained. Mixed or unrecorded origins name no
 * origin.
 */
export function libraryUpdatedCopy(added: readonly CloneSummary[]): string {
  const noun = added.length === 1 ? 'agent' : 'agents';
  const labels = new Set(added.map((c) => provenanceLabel(c.provenance)));
  const first = added[0]?.provenance;
  let origin = '';
  if (labels.size === 1 && first?.kind === 'setup-wizard') {
    origin = ' by the setup wizard';
  } else if (labels.size === 1 && first?.kind === 'plugin') {
    origin = ` by plugin ${first.name}`;
  }
  return `Library updated: ${added.length} ${noun} added${origin}.`;
}

const cloneKey = (c: CloneSummary): string => `${c.kind}:${c.slug}`;

/**
 * A list reply that was applied, with the list it replaced. `previous` is
 * `null` when no list for the same harness root was on screen before.
 */
interface AppliedList {
  readonly previous: readonly CloneSummary[] | null;
  readonly list: readonly CloneSummary[];
}

@Injectable({
  providedIn: 'root',
})
export class SkillClonesStateService {
  private readonly rpc = inject(SkillSynthesisRpcService);
  private readonly feed = inject(LibraryChangeFeed);

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
  /**
   * Slug-keyed outcome signals for agent-kind clones, populated by ONE
   * `getAgentOutcomeSignals` call after each `refreshClones`. A slug absent
   * from the map has no records in the window — consumers must treat
   * missing as "no data yet", never as a rate (Req 9.2).
   */
  public readonly agentOutcomeSignals = signal<
    Record<string, AgentOutcomeSignals>
  >({});
  /** Window echoed by that call. `null` until it succeeds. */
  public readonly outcomeWindowDays = signal<number | null>(null);
  public readonly outcomeStatus = signal<
    'loading' | 'ready' | 'unavailable' | 'not-persistent'
  >('loading');
  /** Count failed reads without retaining or displaying their raw messages. */
  public readonly outcomeReadFailures = signal(0);
  /** Lazily-loaded, per-slug scorecard detail (rows + findings excerpt). */
  public readonly scorecardDetails = signal<
    Record<string, SkillSynthesisGetScorecardDetailResult>
  >({});
  /** Slug whose detail is currently being fetched, or `null` when idle. */
  public readonly scorecardDetailLoading = signal<string | null>(null);

  public readonly divergedCount = computed(
    () => this.clones().filter((c) => c.diverged).length,
  );

  /**
   * The "Library updated" / C10 line for the current list, or `null`. Set only
   * by a `library:changed` push (see the constructor), never by a manual
   * refresh.
   */
  public readonly libraryNotice = signal<LibraryChangeNotice | null>(null);

  /**
   * Monotonically increasing id of the most recently STARTED list request
   * (8.2b). A push, the view's workspace-switch refresh and a manual Refresh
   * can overlap, and their replies can land out of order; only the reply whose
   * epoch is still current touches any state: the list, the scorecards, the
   * outcome signals, `error` and `loading`.
   */
  private listEpoch = 0;

  /**
   * Harness root the last APPLIED list was scoped to (`scopeRoot`, B13).
   * `null` before the first list lands, and on hosts that do not send it.
   */
  private lastScopeRoot: string | null = null;

  /** True once any list request started: the Library has been opened. */
  private listRequested = false;

  /** True once a list reply was applied; until then there is nothing to diff. */
  private listApplied = false;

  public constructor() {
    // Every `library:changed` push re-reads the CURRENT workspace's list,
    // whichever root the push names: the list call is scoped by the host, not
    // by the push. Before the Library was ever opened there is no list to keep
    // current, and the first open reads it anyway.
    //
    // The first run only records the value the feed already held: that push
    // predates this service, and the list read that follows the first open
    // already reflects it. Acting on it would refresh twice and diff the
    // first list against an empty one.
    let firstRun = true;
    effect(() => {
      const change = this.feed.latest();
      if (firstRun) {
        firstRun = false;
        return;
      }
      if (change === null) return;
      untracked(() => {
        if (!this.listRequested) return;
        void this.onLibraryChanged(change);
      });
    });
  }

  public async refreshClones(): Promise<void> {
    await this.reloadList();
  }

  /** Hide the push line (a card was opened). */
  public clearLibraryNotice(): void {
    this.libraryNotice.set(null);
  }

  /**
   * One push: drop the previous line, refresh, then say what changed.
   *
   * - `updated`: a line only when the CURRENT list gained agents. The diff is
   *   between the list on screen when the reply landed and that reply, so a
   *   push for another root, or one that added nothing here, says nothing.
   * - `failed`: the C10 notice only when the push names the root the current
   *   list is scoped to. A failure for another root is not this Library's.
   */
  private async onLibraryChanged(change: LibraryChange): Promise<void> {
    this.libraryNotice.set(null);
    const applied = await this.reloadList();
    if (applied === null) return;
    if (change.status === 'failed') {
      if (
        this.lastScopeRoot !== null &&
        change.workspaceRoot === this.lastScopeRoot
      ) {
        this.libraryNotice.set({
          kind: 'failed',
          message: LIBRARY_REFRESH_FAILED_COPY,
        });
      }
      return;
    }
    // No earlier list for this root: nothing to diff against, so no claim.
    if (applied.previous === null) return;
    const before = new Set(applied.previous.map(cloneKey));
    const added = applied.list.filter(
      (c) => c.kind === 'agent' && !before.has(cloneKey(c)),
    );
    if (added.length === 0) return;
    this.libraryNotice.set({
      kind: 'updated',
      message: libraryUpdatedCopy(added),
    });
  }

  /**
   * Read the list under a fresh epoch. Resolves with the list it applied and
   * the one it replaced, or `null` when the request failed or a newer one
   * superseded it.
   */
  private async reloadList(): Promise<AppliedList | null> {
    const epoch = ++this.listEpoch;
    this.listRequested = true;
    this.loading.set(true);
    this.error.set(null);
    try {
      const result = await this.rpc.listClones();
      if (epoch !== this.listEpoch) return null;
      const scopeRoot = result.scopeRoot ?? null;
      const sameRoot = this.listApplied && scopeRoot === this.lastScopeRoot;
      const previous = sameRoot ? this.clones() : null;
      if (!sameRoot) {
        // Another harness root: the last line described the previous one.
        this.libraryNotice.set(null);
      }
      this.lastScopeRoot = scopeRoot;
      this.listApplied = true;
      this.clones.set(result.clones);
      await Promise.all([
        this.loadScorecards(result.clones, epoch),
        this.loadAgentOutcomeSignals(result.clones, epoch),
      ]);
      return epoch === this.listEpoch
        ? { previous, list: result.clones }
        : null;
    } catch (err) {
      if (epoch === this.listEpoch) this.error.set(this.toMessage(err));
      return null;
    } finally {
      if (epoch === this.listEpoch) this.loading.set(false);
    }
  }

  /**
   * One batched scorecard fetch for every agent-kind slug in the list. Runs
   * after the clone list lands; a failure here degrades to no scorecards
   * (usage-only cards) rather than blanking the whole Library — the clone
   * table has already rendered successfully.
   */
  private async loadScorecards(
    list: CloneSummary[],
    epoch: number,
  ): Promise<void> {
    const slugs = list.filter((c) => c.kind === 'agent').map((c) => c.slug);
    if (slugs.length === 0) {
      this.scorecards.set({});
      return;
    }
    try {
      const map = await this.rpc.getScorecards(slugs);
      if (epoch === this.listEpoch) this.scorecards.set(map);
    } catch {
      if (epoch === this.listEpoch) this.scorecards.set({});
    }
  }

  /**
   * One batched outcome-signal fetch for every agent-kind slug. Runs in
   * the same post-list step as {@link loadScorecards}.
   * Skills and commands are not part of the request.
   */
  private async loadAgentOutcomeSignals(
    list: CloneSummary[],
    epoch: number,
  ): Promise<void> {
    const slugs = list.filter((c) => c.kind === 'agent').map((c) => c.slug);
    if (slugs.length === 0) {
      this.agentOutcomeSignals.set({});
      this.outcomeWindowDays.set(null);
      this.outcomeStatus.set('ready');
      return;
    }
    this.outcomeStatus.set('loading');
    try {
      const result = await this.rpc.getAgentOutcomeSignals(slugs);
      if (epoch !== this.listEpoch) return;
      this.agentOutcomeSignals.set(result.signals);
      this.outcomeWindowDays.set(result.windowDays);
      this.outcomeStatus.set(result.persistent ? 'ready' : 'not-persistent');
    } catch {
      // degradation-audit: reported — outcomeStatus and outcomeReadFailures
      // carry the failure; keep the last good figures during a transient read.
      if (epoch !== this.listEpoch) return;
      this.outcomeReadFailures.update((count) => count + 1);
      this.outcomeStatus.set('unavailable');
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
   * Monotonically increasing id of the most recently STARTED detail request.
   *
   * The key alone is not enough to identify the winner: two loads of the SAME
   * entry (a click plus the post-save reload) share a key, so a key check
   * passes for both and the slower one still overwrites the faster one's
   * result — and clears `detailLoading` while the newer request is still in
   * flight. The token makes "is this reply still the current one?" exact.
   */
  private detailRequestToken = 0;

  /** True only for the request that is still the outstanding one. */
  private isCurrentDetailRequest(key: string, token: number): boolean {
    return this.detailKey === key && this.detailRequestToken === token;
  }

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
   * - A reply — success OR failure — is applied only while it is still the
   *   outstanding request, identified by BOTH the entry key and
   *   {@link detailRequestToken}. Two loads in flight can land out of order,
   *   whether they name different entries or the same one, and the loser must
   *   touch nothing: not `detail`, not `error`, not `detailLoading`.
   *
   * A repeat load of the SAME entry (the post-save reload) keeps the held
   * detail on screen, so nothing blanks on a refresh.
   */
  public async loadDetail(slug: string, kind: SkillCloneKind): Promise<void> {
    const key = `${kind}/${slug}`;
    const token = ++this.detailRequestToken;
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
      if (this.isCurrentDetailRequest(key, token)) this.detail.set(detail);
    } catch (err) {
      // The live request's failure IS surfaced, through `error`, which the view
      // renders as a toast. A SUPERSEDED request's failure is dropped on
      // purpose: the user has already asked for something else, and reporting
      // the loser of the race would blame the wrong clone.
      if (this.isCurrentDetailRequest(key, token)) {
        this.error.set(this.toMessage(err));
        this.detail.set(null);
      }
    } finally {
      if (this.isCurrentDetailRequest(key, token)) {
        this.detailLoading.set(false);
      }
    }
  }

  /**
   * Write a user-edited body for one clone, then reload the open detail.
   *
   * The reload is not cosmetic: the drawer leaves edit mode only once its
   * `body` input matches the text it submitted, so a save that did not reload
   * would keep the editor open over already-written content. Errors PROPAGATE
   * — the caller owns the toast, and swallowing here would look like success.
   *
   * The write result is RETURNED, not consumed here: it carries
   * `reconcileProtected`, and a `false` there means the caller must qualify its
   * success message rather than claim the edit is permanent.
   */
  public async saveCloneBody(
    kind: SkillCloneKind,
    slug: string,
    body: string,
  ): Promise<SkillSynthesisSaveCloneBodyResult> {
    const result = await this.rpc.saveCloneBody(kind, slug, body);
    await this.loadDetail(slug, kind);
    return result;
  }

  public clearDetail(): void {
    this.selectedSlug.set(null);
    this.selectedKind.set(null);
    this.detailKey = null;
    // Invalidate every in-flight request, not just the ones whose key the
    // reset above happens to change: a reply that arrives after a close must
    // not write `detail`, `error` or `detailLoading` even if the user reopens
    // the same entry in the meantime.
    this.detailRequestToken++;
    this.detail.set(null);
    // Any reply still in flight is now orphaned, so its `finally` will not
    // clear this — closing must, or a later reopen inherits a stuck spinner.
    this.detailLoading.set(false);
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
