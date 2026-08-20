/**
 * SkillClonesViewComponent — the Thoth → Skills → Library surface.
 *
 * Replaces the single flat table that mixed skills, agents and commands into
 * one eight-column grid. Now: a `Skills / Agents / Commands` tab strip with
 * live counts, a card per entry, and a detail slide-over.
 *
 * The substantive change is not the layout, it is action correctness. The table
 * rendered the same four buttons on every row regardless of whether the backend
 * could honour them. This component drives every action off
 * {@link cloneActionModel}, so:
 *
 * - "Enhance now" is disabled below the invocation threshold or during the
 *   cooldown window, with the threshold / remaining time stated on the control.
 * - "Revert" is disabled when there are no history snapshots.
 * - "Rebase to upstream" is never offered for entries with no upstream source
 *   (`authored` / `synth`) — the backend throws `Cannot resolve upstream
 *   source` for those. The card explains why instead.
 * - "Keep mine" is confirmed, because it resolves the divergence WITHOUT
 *   changing any file content and that was previously invisible.
 *
 * "Enhance now" is also no longer a blind write: it previews a proposal, shows
 * the Monaco diff and the judge's verdict, and only writes on Apply.
 *
 * Smart component — owns the RPC calls and orchestrates the presentational
 * card / drawer children. Signals + `computed()` + `inject()`, OnPush.
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { NativeTab, NativeTabGroupComponent } from '@ptah-extension/ui';
import type {
  AgentScorecard,
  CloneSummary,
  ScorecardInvocationRow,
  SkillCloneKind,
  SkillSynthesisPreviewEnhancementResult,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
import { SkillClonesStateService } from '../../services/skill-clones-state.service';
import { CloneCardComponent } from './clone-card.component';
import {
  CloneDetailDrawerComponent,
  CloneHistoryDiff,
  CloneHistoryRequest,
} from './clone-detail-drawer.component';
import { EnhancePreviewDrawerComponent } from './enhance-preview-drawer.component';
import {
  KEEP_MINE_EXPLANATION,
  REBASE_EXPLANATION,
} from './clone-action-gating';

interface ClonesToast {
  readonly message: string;
  readonly kind: 'success' | 'error' | 'info';
}

/** A divergence resolution awaiting explicit confirmation. */
interface ReconcileIntent {
  readonly clone: CloneSummary;
  readonly action: 'rebase' | 'keep';
}

const KIND_TABS: ReadonlyArray<{ id: SkillCloneKind; label: string }> = [
  { id: 'skill', label: 'Skills' },
  { id: 'agent', label: 'Agents' },
  { id: 'command', label: 'Commands' },
];

const EMPTY_COPY: Record<SkillCloneKind, string> = {
  skill:
    'No skills in your library yet. Skills arrive when you install a plugin or accept a recommendation.',
  agent:
    'No agents in your library yet. Agents arrive when you install a plugin that ships them.',
  command:
    'No commands in your library yet. Commands arrive when you install a plugin that ships them.',
};

@Component({
  selector: 'ptah-skill-clones-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NativeTabGroupComponent,
    CloneCardComponent,
    CloneDetailDrawerComponent,
    EnhancePreviewDrawerComponent,
  ],
  template: `
    @if (!isElectron()) {
      <div
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
        role="alert"
        data-testid="clones-desktop-notice"
      >
        <p class="text-sm font-medium">
          Skill clones are only available in the Ptah desktop app.
        </p>
      </div>
    } @else {
      <div class="space-y-4" data-testid="clones-view">
        <div class="flex items-start justify-between gap-4">
          <p class="text-sm text-base-content-muted">
            Your active skills, agents and commands. Thoth improves them from
            recorded usage — metrics stay hidden until an entry actually runs.
          </p>
          <button
            type="button"
            class="btn btn-ghost btn-xs shrink-0 transition-colors duration-150"
            data-testid="clones-refresh"
            [disabled]="loading()"
            (click)="onRefresh()"
          >
            {{ loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

        <dl
          class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-base-content-muted"
          aria-label="Status legend"
          data-testid="clones-legend"
        >
          <div class="inline-flex items-center gap-1.5">
            <span class="inline-block size-1.5 rounded-full bg-info"></span>
            <dt class="font-medium">authored</dt>
            <dd>built-in / yours</dd>
          </div>
          <div class="inline-flex items-center gap-1.5">
            <span
              class="inline-block size-1.5 rounded-full bg-base-content/40"
            ></span>
            <dt class="font-medium">clone</dt>
            <dd>copied from a plugin</dd>
          </div>
          <div class="inline-flex items-center gap-1.5">
            <span
              class="inline-block size-1.5 rounded-full bg-secondary"
            ></span>
            <dt class="font-medium">synth</dt>
            <dd>from an accepted recommendation</dd>
          </div>
          <div class="inline-flex items-center gap-1.5">
            <span class="inline-block size-1.5 rounded-full bg-warning"></span>
            <dt class="font-medium">diverged</dt>
            <dd>upstream changed — rebase or keep</dd>
          </div>
        </dl>

        @if (error(); as msg) {
          <div role="alert" class="alert alert-error py-2 text-sm">
            <span>{{ msg }}</span>
          </div>
        }

        @if (toast(); as t) {
          <div
            role="alert"
            class="alert py-2 text-sm"
            data-testid="clones-toast"
            [class.alert-success]="t.kind === 'success'"
            [class.alert-error]="t.kind === 'error'"
            [class.alert-info]="t.kind === 'info'"
          >
            <span>{{ t.message }}</span>
          </div>
        }

        <ptah-native-tab-group
          [tabs]="tabs()"
          [(activeId)]="activeKind"
          ariaLabel="Library sections"
        >
          <div class="pt-4">
            @if (visibleClones().length === 0) {
              <p
                class="px-1 py-8 text-center text-sm text-base-content-muted"
                data-testid="clones-empty"
              >
                @if (loading()) {
                  Loading library…
                } @else {
                  {{ emptyCopy() }}
                }
              </p>
            } @else {
              <ul
                class="grid grid-cols-1 gap-3 lg:grid-cols-2"
                data-testid="clones-grid"
              >
                @for (c of visibleClones(); track c.kind + ':' + c.slug) {
                  <li data-testid="clones-row">
                    <ptah-clone-card
                      [clone]="c"
                      [scorecard]="scorecardFor(c.slug)"
                      [busy]="busySlug() === c.slug"
                      (opened)="onOpenDetail($event)"
                      (enhance)="onEnhance($event)"
                      (revert)="onOpenDetail($event)"
                      (rebase)="onRequestReconcile($event, 'rebase')"
                      (keep)="onRequestReconcile($event, 'keep')"
                    />
                  </li>
                }
              </ul>
            }
          </div>
        </ptah-native-tab-group>
      </div>

      <ptah-clone-detail-drawer
        [clone]="selected()"
        [body]="detailBody()"
        [history]="history()"
        [detailLoading]="detailLoading()"
        [scorecard]="selectedScorecard()"
        [scorecardRows]="selectedScorecardRows()"
        [scorecardFindings]="selectedScorecardFindings()"
        [scorecardLoading]="selectedScorecardLoading()"
        [busy]="busySlug() !== null"
        [historyDiff]="historyDiff()"
        [historyDiffLoading]="historyDiffLoading()"
        (closed)="onCloseDetail()"
        (enhance)="onEnhance($event)"
        (rebase)="onRequestReconcile($event, 'rebase')"
        (keep)="onRequestReconcile($event, 'keep')"
        (revertTo)="onRevertTo($event)"
        (historyDiffRequested)="onLoadHistoryDiff($event)"
        (historyDiffCleared)="historyDiff.set(null)"
      />

      <ptah-enhance-preview-drawer
        [clone]="previewClone()"
        [preview]="previewResult()"
        [loading]="previewLoading()"
        [applying]="previewApplying()"
        [error]="previewError()"
        (apply)="onApplyProposal($event)"
        (discard)="onDiscardPreview()"
      />

      @if (reconcile(); as intent) {
        <dialog
          class="modal modal-open"
          role="dialog"
          aria-modal="true"
          aria-label="Resolve divergence"
          data-testid="clones-reconcile-modal"
        >
          <div class="modal-box">
            <h3 class="text-base font-semibold">
              {{
                intent.action === 'rebase' ? 'Rebase to upstream' : 'Keep mine'
              }}
              &mdash;
              <span class="font-mono text-sm">{{ intent.clone.slug }}</span>
            </h3>
            <p
              class="mt-2 text-sm text-base-content-muted"
              data-testid="clones-reconcile-explanation"
            >
              {{
                intent.action === 'rebase'
                  ? rebaseExplanation
                  : keepMineExplanation
              }}
            </p>
            <div class="modal-action">
              <button
                type="button"
                class="btn btn-sm"
                data-testid="clones-reconcile-cancel"
                (click)="reconcile.set(null)"
              >
                Cancel
              </button>
              <button
                type="button"
                class="btn btn-warning btn-sm"
                data-testid="clones-reconcile-confirm"
                [disabled]="busySlug() !== null"
                (click)="onConfirmReconcile(intent)"
              >
                {{ intent.action === 'rebase' ? 'Rebase' : 'Keep mine' }}
              </button>
            </div>
          </div>
        </dialog>
      }
    }
  `,
})
export class SkillClonesViewComponent implements OnInit {
  private readonly state = inject(SkillClonesStateService);
  private readonly rpc = inject(SkillSynthesisRpcService);
  private readonly vscodeService = inject(VSCodeService);

  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  public readonly clones = this.state.clones;
  public readonly loading = this.state.loading;
  public readonly error = this.state.error;
  public readonly detailLoading = this.state.detailLoading;
  public readonly scorecards = this.state.scorecards;

  /** Which kind tab is showing. Two-way bound to the tab group. */
  public readonly activeKind = signal<string | null>('skill');

  public readonly selected = signal<CloneSummary | null>(null);
  public readonly busySlug = signal<string | null>(null);
  public readonly toast = signal<ClonesToast | null>(null);
  public readonly reconcile = signal<ReconcileIntent | null>(null);

  public readonly historyDiff = signal<CloneHistoryDiff | null>(null);
  public readonly historyDiffLoading = signal<string | null>(null);

  public readonly previewClone = signal<CloneSummary | null>(null);
  public readonly previewResult =
    signal<SkillSynthesisPreviewEnhancementResult | null>(null);
  public readonly previewLoading = signal<boolean>(false);
  public readonly previewApplying = signal<boolean>(false);
  public readonly previewError = signal<string | null>(null);

  protected readonly keepMineExplanation = KEEP_MINE_EXPLANATION;
  protected readonly rebaseExplanation = REBASE_EXPLANATION;

  public readonly history = computed(() => this.state.detail()?.history ?? []);
  public readonly detailBody = computed(
    () => this.state.detail()?.body ?? null,
  );

  /** Entries in the active tab, in list order. */
  public readonly visibleClones = computed<CloneSummary[]>(() => {
    const kind = this.currentKind();
    return this.clones().filter((c) => c.kind === kind);
  });

  public readonly tabs = computed<NativeTab[]>(() => {
    const list = this.clones();
    return KIND_TABS.map((t) => ({
      id: t.id,
      label: t.label,
      count: list.filter((c) => c.kind === t.id).length,
    }));
  });

  protected readonly emptyCopy = computed(() => EMPTY_COPY[this.currentKind()]);

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.refreshClones();
  }

  protected onRefresh(): void {
    void this.state.refreshClones();
  }

  // ── Detail drawer ────────────────────────────────────────────────────────

  protected onOpenDetail(c: CloneSummary): void {
    this.selected.set(c);
    this.historyDiff.set(null);
    void this.state.loadDetail(c.slug, c.kind);
    if (c.kind === 'agent') {
      void this.state.loadScorecardDetail(c.slug);
    }
  }

  protected onCloseDetail(): void {
    this.selected.set(null);
    this.historyDiff.set(null);
    this.state.clearDetail();
  }

  protected async onLoadHistoryDiff(req: CloneHistoryRequest): Promise<void> {
    this.historyDiffLoading.set(req.ts);
    try {
      const result = await this.rpc.getHistoryBody(
        req.clone.kind,
        req.clone.slug,
        req.ts,
      );
      if (result.body === null) {
        this.showToast('That snapshot has no readable body.', 'info');
        this.historyDiff.set(null);
        return;
      }
      this.historyDiff.set({ ts: result.ts, body: result.body });
    } catch (err: unknown) {
      this.showToast(this.toMessage(err), 'error');
    } finally {
      this.historyDiffLoading.set(null);
    }
  }

  protected async onRevertTo(req: CloneHistoryRequest): Promise<void> {
    this.busySlug.set(req.clone.slug);
    try {
      const result = await this.rpc.revertEnhancement(
        req.clone.kind,
        req.clone.slug,
        req.ts,
      );
      if (result.reverted) {
        this.showToast(`Reverted "${req.clone.slug}".`, 'success');
      } else {
        this.showToast(`Could not revert "${req.clone.slug}".`, 'error');
      }
      this.onCloseDetail();
      await this.state.refreshClones();
    } catch (err: unknown) {
      this.showToast(this.toMessage(err), 'error');
    } finally {
      this.busySlug.set(null);
    }
  }

  // ── Enhancement preview ──────────────────────────────────────────────────

  /**
   * Start a preview. Never writes: the result is a candidate body plus the
   * judge verdict, which the preview drawer renders as a diff.
   */
  protected async onEnhance(c: CloneSummary): Promise<void> {
    this.previewClone.set(c);
    this.previewResult.set(null);
    this.previewError.set(null);
    this.previewLoading.set(true);
    try {
      const result = await this.rpc.previewEnhancement(c.kind, c.slug);
      this.previewResult.set(result);
    } catch (err: unknown) {
      this.previewError.set(this.toMessage(err));
    } finally {
      this.previewLoading.set(false);
    }
  }

  protected async onApplyProposal(proposalId: string): Promise<void> {
    const c = this.previewClone();
    if (c === null) return;
    this.previewApplying.set(true);
    try {
      const result = await this.rpc.applyProposal(c.kind, c.slug, proposalId);
      if (result.applied) {
        this.showToast(`Enhanced "${c.slug}".`, 'success');
      } else {
        this.showToast(`Nothing was applied for "${c.slug}".`, 'info');
      }
      this.closePreview();
      await this.state.refreshClones();
      // Refresh the open detail drawer so the body and history reflect the
      // write that just happened.
      const open = this.selected();
      if (open && open.slug === c.slug && open.kind === c.kind) {
        this.historyDiff.set(null);
        void this.state.loadDetail(c.slug, c.kind);
      }
    } catch (err: unknown) {
      this.previewError.set(this.toMessage(err));
    } finally {
      this.previewApplying.set(false);
    }
  }

  protected onDiscardPreview(): void {
    if (this.previewApplying()) return;
    this.closePreview();
  }

  // ── Divergence resolution ────────────────────────────────────────────────

  protected onRequestReconcile(
    c: CloneSummary,
    action: 'rebase' | 'keep',
  ): void {
    this.reconcile.set({ clone: c, action });
  }

  protected async onConfirmReconcile(intent: ReconcileIntent): Promise<void> {
    this.reconcile.set(null);
    if (intent.action === 'rebase') {
      await this.runRebase(intent.clone);
      return;
    }
    await this.runKeep(intent.clone);
  }

  private async runRebase(c: CloneSummary): Promise<void> {
    this.busySlug.set(c.slug);
    try {
      const result = await this.rpc.rebaseClone(c.kind, c.slug);
      if (result.failed) {
        this.showToast(
          `Rebase failed for "${c.slug}"${result.reason ? `: ${result.reason}` : ''}.`,
          'error',
        );
      } else {
        this.showToast(`Rebased "${c.slug}" to upstream.`, 'success');
      }
      await this.state.refreshClones();
    } catch (err: unknown) {
      this.showToast(this.toMessage(err), 'error');
    } finally {
      this.busySlug.set(null);
    }
  }

  private async runKeep(c: CloneSummary): Promise<void> {
    this.busySlug.set(c.slug);
    try {
      await this.rpc.keepClone(c.kind, c.slug);
      this.showToast(
        `Kept your copy of "${c.slug}". No file content changed.`,
        'success',
      );
      await this.state.refreshClones();
    } catch (err: unknown) {
      this.showToast(this.toMessage(err), 'error');
    } finally {
      this.busySlug.set(null);
    }
  }

  // ── Derived scorecard accessors ──────────────────────────────────────────

  protected scorecardFor(slug: string): AgentScorecard | null {
    return this.scorecards()[slug] ?? null;
  }

  protected readonly selectedScorecard = computed<AgentScorecard | null>(() => {
    const c = this.selected();
    return c === null ? null : (this.scorecards()[c.slug] ?? null);
  });

  protected readonly selectedScorecardRows = computed<ScorecardInvocationRow[]>(
    () => {
      const c = this.selected();
      if (c === null) return [];
      return this.state.scorecardDetails()[c.slug]?.rows ?? [];
    },
  );

  protected readonly selectedScorecardFindings = computed<string | null>(() => {
    const c = this.selected();
    if (c === null) return null;
    return this.state.scorecardDetails()[c.slug]?.findingsExcerpt ?? null;
  });

  protected readonly selectedScorecardLoading = computed<boolean>(() => {
    const c = this.selected();
    return c !== null && this.state.scorecardDetailLoading() === c.slug;
  });

  // ── Internals ────────────────────────────────────────────────────────────

  /** The active tab id, narrowed back to the domain kind. */
  private currentKind(): SkillCloneKind {
    const id = this.activeKind();
    return id === 'agent' || id === 'command' ? id : 'skill';
  }

  private closePreview(): void {
    this.previewClone.set(null);
    this.previewResult.set(null);
    this.previewError.set(null);
  }

  private showToast(message: string, kind: ClonesToast['kind']): void {
    this.toast.set({ message, kind });
    setTimeout(() => this.toast.set(null), 3000);
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
