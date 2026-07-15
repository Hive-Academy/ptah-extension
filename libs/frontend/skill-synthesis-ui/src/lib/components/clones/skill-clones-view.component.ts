import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { VSCodeService } from '@ptah-extension/core';
import type {
  AgentScorecard,
  CloneSummary,
  ScorecardInvocationRow,
  SkillCloneStatus,
} from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
import { SkillClonesStateService } from '../../services/skill-clones-state.service';
import { ScorecardBadgeComponent } from './scorecard-badge.component';
import { ScorecardDetailComponent } from './scorecard-detail.component';

interface ClonesToast {
  readonly message: string;
  readonly kind: 'success' | 'error' | 'info';
}

@Component({
  selector: 'ptah-skill-clones-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, ScorecardBadgeComponent, ScorecardDetailComponent],
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
        <div class="flex items-center justify-between">
          <p class="text-sm text-base-content/60">
            Your active skills, agents, and commands. Thoth auto-improves them
            from usage; Success and Last enhanced stay blank until they're
            actually invoked.
          </p>
          <button
            type="button"
            class="btn btn-ghost btn-xs transition-colors duration-150"
            data-testid="clones-refresh"
            [disabled]="loading()"
            (click)="onRefresh()"
          >
            {{ loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

        <dl
          class="flex flex-wrap gap-x-5 gap-y-1 text-xs text-base-content/60"
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

        <section
          class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
        >
          <table class="table table-sm">
            <thead>
              <tr class="text-xs text-base-content/50">
                <th scope="col" class="font-normal">Name</th>
                <th scope="col" class="font-normal">Kind</th>
                <th scope="col" class="font-normal">Status</th>
                <th scope="col" class="text-right font-normal">Invocations</th>
                <th scope="col" class="text-right font-normal">Success</th>
                <th scope="col" class="font-normal">Last enhanced</th>
                <th scope="col" class="text-right font-normal">History</th>
                <th scope="col" class="w-1 font-normal">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (c of clones(); track c.kind + ':' + c.slug) {
                <tr data-testid="clones-row" class="hover:bg-base-300/20">
                  <td class="font-medium">
                    <div class="flex items-center gap-1.5">
                      @if (c.kind === 'agent') {
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs px-1"
                          data-testid="scorecard-expand"
                          [attr.aria-expanded]="expandedSlug() === c.slug"
                          [attr.aria-label]="
                            expandedSlug() === c.slug
                              ? 'Collapse scorecard for ' + c.slug
                              : 'Expand scorecard for ' + c.slug
                          "
                          (click)="onToggleExpand(c)"
                        >
                          <span aria-hidden="true">{{
                            expandedSlug() === c.slug ? '▾' : '▸'
                          }}</span>
                        </button>
                      }
                      <span>{{ c.slug }}</span>
                    </div>
                    @if (c.kind === 'agent') {
                      <ptah-scorecard-badge
                        class="mt-1 block"
                        [scorecard]="scorecardFor(c.slug)"
                      />
                    }
                  </td>
                  <td class="text-xs">{{ c.kind }}</td>
                  <td>
                    <span class="inline-flex items-center gap-1.5">
                      <span
                        class="inline-block size-1.5 rounded-full"
                        [class]="statusDotClass(c)"
                        aria-hidden="true"
                      ></span>
                      <span
                        class="text-xs text-base-content/70"
                        data-testid="clones-status-badge"
                        >{{ statusLabel(c) }}</span
                      >
                    </span>
                  </td>
                  <td class="text-right tabular-nums">
                    {{ c.invocationCount }}
                  </td>
                  <td class="text-right tabular-nums">
                    {{ formatSuccess(c) }}
                  </td>
                  <td class="text-xs">
                    {{ formatRelative(c.lastEnhancedAt) }}
                  </td>
                  <td class="text-right tabular-nums">{{ c.historyCount }}</td>
                  <td>
                    <div class="flex items-center justify-end gap-2">
                      @if (enhanceHint(c); as hint) {
                        <span
                          class="text-xs tabular-nums"
                          [class.text-success]="hint === 'ready'"
                          [class.text-base-content/50]="hint !== 'ready'"
                          [title]="enhanceHintTitle(c)"
                          data-testid="clones-enhance-hint"
                          >{{ hint }}</span
                        >
                      }
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs transition-colors duration-150"
                        data-testid="clones-enhance-btn"
                        [disabled]="busySlug() === c.slug"
                        (click)="onEnhance(c)"
                      >
                        Enhance now
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs transition-colors duration-150"
                        data-testid="clones-revert-btn"
                        [disabled]="busySlug() === c.slug"
                        (click)="onOpenRevert(c)"
                      >
                        Revert
                      </button>
                      @if (c.diverged) {
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs text-warning transition-colors duration-150"
                          data-testid="clones-rebase-btn"
                          [disabled]="busySlug() === c.slug"
                          (click)="onRebase(c)"
                        >
                          Rebase to upstream
                        </button>
                        <button
                          type="button"
                          class="btn btn-ghost btn-xs text-warning transition-colors duration-150"
                          data-testid="clones-keep-btn"
                          [disabled]="busySlug() === c.slug"
                          (click)="onKeep(c)"
                        >
                          Keep mine
                        </button>
                      }
                    </div>
                  </td>
                </tr>
                @if (c.kind === 'agent' && expandedSlug() === c.slug) {
                  <tr data-testid="scorecard-detail-panel">
                    <td colspan="8" class="bg-base-300/10">
                      <ptah-scorecard-detail
                        [rows]="detailRows(c.slug)"
                        [findingsExcerpt]="detailFindings(c.slug)"
                        [loading]="detailLoadingFor(c.slug)"
                      />
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td
                    colspan="8"
                    class="text-center text-sm text-base-content/60"
                  >
                    @if (loading()) {
                      <span>Loading clones…</span>
                    } @else {
                      <span data-testid="clones-empty">No clones found.</span>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </section>

        @if (revertTarget(); as target) {
          <dialog
            class="modal modal-open"
            role="dialog"
            aria-modal="true"
            aria-label="Revert enhancement"
            data-testid="clones-revert-modal"
          >
            <div class="modal-box">
              <h3 class="text-base font-semibold">
                Revert &mdash;
                <span class="font-mono text-sm">{{ target.slug }}</span>
              </h3>
              @if (detailLoading()) {
                <p class="mt-2 text-sm text-base-content/60">
                  Loading history…
                </p>
              } @else {
                @if (history().length === 0) {
                  <p
                    class="mt-2 text-sm text-base-content/60"
                    data-testid="clones-history-empty"
                  >
                    No history snapshots to revert to.
                  </p>
                } @else {
                  <ul class="mt-2 space-y-1">
                    @for (h of history(); track h.ts) {
                      <li class="flex items-center justify-between gap-2">
                        <span class="font-mono text-xs">{{ h.ts }}</span>
                        <button
                          type="button"
                          class="btn btn-xs btn-primary"
                          data-testid="clones-history-revert-btn"
                          [disabled]="!h.hasBody || busySlug() === target.slug"
                          (click)="onRevertTo(target, h.ts)"
                        >
                          Revert to this
                        </button>
                      </li>
                    }
                  </ul>
                }
              }
              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-sm"
                  (click)="onCloseRevert()"
                >
                  Close
                </button>
              </div>
            </div>
          </dialog>
        }
      </div>
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

  public readonly history = computed(() => this.state.detail()?.history ?? []);

  public readonly revertTarget = signal<CloneSummary | null>(null);
  public readonly busySlug = signal<string | null>(null);
  public readonly toast = signal<ClonesToast | null>(null);
  /** Slug of the currently expanded agent scorecard, or `null` when none. */
  public readonly expandedSlug = signal<string | null>(null);

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.refreshClones();
  }

  protected onRefresh(): void {
    void this.state.refreshClones();
  }

  protected async onEnhance(c: CloneSummary): Promise<void> {
    this.busySlug.set(c.slug);
    try {
      const result = await this.rpc.enhanceNow(c.kind, c.slug);
      if (result.changed) {
        this.showToast(
          `Enhanced "${c.slug}" (score ${result.judgeScore ?? '—'}).`,
          'success',
        );
      } else {
        this.showToast(
          `No change for "${c.slug}"${result.skipReason ? `: ${result.skipReason}` : ''}.`,
          'info',
        );
      }
      await this.state.refreshClones();
    } catch (err: unknown) {
      this.showToast(this.toMessage(err), 'error');
    } finally {
      this.busySlug.set(null);
    }
  }

  protected onOpenRevert(c: CloneSummary): void {
    this.revertTarget.set(c);
    void this.state.loadDetail(c.slug, c.kind);
  }

  protected onCloseRevert(): void {
    this.revertTarget.set(null);
    this.state.clearDetail();
  }

  protected async onRevertTo(
    c: CloneSummary,
    historyTs: string,
  ): Promise<void> {
    this.busySlug.set(c.slug);
    try {
      const result = await this.rpc.revertEnhancement(
        c.kind,
        c.slug,
        historyTs,
      );
      if (result.reverted) {
        this.showToast(`Reverted "${c.slug}".`, 'success');
      } else {
        this.showToast(`Could not revert "${c.slug}".`, 'error');
      }
      this.onCloseRevert();
      await this.state.refreshClones();
    } catch (err: unknown) {
      this.showToast(this.toMessage(err), 'error');
    } finally {
      this.busySlug.set(null);
    }
  }

  protected async onRebase(c: CloneSummary): Promise<void> {
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

  protected async onKeep(c: CloneSummary): Promise<void> {
    this.busySlug.set(c.slug);
    try {
      await this.rpc.keepClone(c.kind, c.slug);
      this.showToast(`Kept local clone for "${c.slug}".`, 'success');
      await this.state.refreshClones();
    } catch (err: unknown) {
      this.showToast(this.toMessage(err), 'error');
    } finally {
      this.busySlug.set(null);
    }
  }

  /**
   * Toggle the per-agent scorecard detail panel. On first expansion the detail
   * (recent graded rows + findings excerpt) is lazily fetched — never during
   * the Library list render (R7/NFR perf).
   */
  protected onToggleExpand(c: CloneSummary): void {
    if (this.expandedSlug() === c.slug) {
      this.expandedSlug.set(null);
      return;
    }
    this.expandedSlug.set(c.slug);
    void this.state.loadScorecardDetail(c.slug);
  }

  /** Batched scorecard for an agent slug; `null` when it has no data yet. */
  protected scorecardFor(slug: string): AgentScorecard | null {
    return this.scorecards()[slug] ?? null;
  }

  protected detailRows(slug: string): ScorecardInvocationRow[] {
    return this.state.scorecardDetails()[slug]?.rows ?? [];
  }

  protected detailFindings(slug: string): string | null {
    return this.state.scorecardDetails()[slug]?.findingsExcerpt ?? null;
  }

  protected detailLoadingFor(slug: string): boolean {
    return this.state.scorecardDetailLoading() === slug;
  }

  protected statusLabel(c: CloneSummary): SkillCloneStatus {
    return c.diverged ? 'diverged' : c.cloneStatus;
  }

  protected statusDotClass(c: CloneSummary): string {
    if (c.diverged) return 'bg-warning';
    switch (c.cloneStatus) {
      case 'authored':
        return 'bg-info';
      case 'synth':
        return 'bg-secondary';
      case 'diverged':
        return 'bg-warning';
      default:
        return 'bg-base-content/40';
    }
  }

  protected formatSuccess(c: CloneSummary): string {
    if (c.invocationCount <= 0 || !Number.isFinite(c.successRate)) return '—';
    return `${Math.round(c.successRate * 100)}%`;
  }

  /**
   * Short auto-enhancement eligibility tag: invocation progress toward the
   * threshold, remaining cooldown, or 'ready'. The manual "Enhance now" button
   * works regardless of this state.
   */
  protected enhanceHint(c: CloneSummary): string {
    if (c.invocationCount < c.enhanceMinInvocations) {
      return `${c.invocationCount}/${c.enhanceMinInvocations} runs`;
    }
    if (
      c.enhanceCooldownUntil !== null &&
      Date.now() < c.enhanceCooldownUntil
    ) {
      return `cooldown ${this.formatDuration(c.enhanceCooldownUntil - Date.now())}`;
    }
    return 'ready';
  }

  protected enhanceHintTitle(c: CloneSummary): string {
    if (c.invocationCount < c.enhanceMinInvocations) {
      return `Auto-enhances after ${c.enhanceMinInvocations} recorded runs (has ${c.invocationCount}). "Enhance now" runs it manually.`;
    }
    if (
      c.enhanceCooldownUntil !== null &&
      Date.now() < c.enhanceCooldownUntil
    ) {
      return 'Recently enhanced — auto-enhance is on cooldown. "Enhance now" still works.';
    }
    return 'Eligible for auto-enhancement on the next Curator pass.';
  }

  private formatDuration(ms: number): string {
    const minutes = Math.max(1, Math.floor(ms / 60_000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  protected formatRelative(epochMs: number | null): string {
    if (epochMs === null || !Number.isFinite(epochMs)) return '—';
    const deltaMs = Date.now() - epochMs;
    if (deltaMs < 0) return 'just now';
    const minutes = Math.floor(deltaMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  }

  private showToast(message: string, kind: ClonesToast['kind']): void {
    this.toast.set({ message, kind });
    setTimeout(() => this.toast.set(null), 3000);
  }

  private toMessage(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
  }
}
