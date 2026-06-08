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
import type { CloneSummary, SkillCloneStatus } from '@ptah-extension/shared';

import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
import { SkillClonesStateService } from '../../services/skill-clones-state.service';

interface ClonesToast {
  readonly message: string;
  readonly kind: 'success' | 'error' | 'info';
}

@Component({
  selector: 'ptah-skill-clones-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @if (!isElectron()) {
      <div
        role="alert"
        class="alert alert-info"
        data-testid="clones-desktop-notice"
      >
        <span class="text-sm">
          Skill clones are only available in the Ptah desktop app.
        </span>
      </div>
    } @else {
      <div class="flex flex-col gap-3" data-testid="clones-view">
        <div class="flex items-center justify-between">
          <h2 class="text-sm font-semibold">Clones</h2>
          <button
            type="button"
            class="btn btn-xs btn-ghost"
            data-testid="clones-refresh"
            [disabled]="loading()"
            (click)="onRefresh()"
          >
            {{ loading() ? 'Refreshing…' : 'Refresh' }}
          </button>
        </div>

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

        <div class="overflow-x-auto">
          <table class="table table-sm">
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Kind</th>
                <th scope="col">Status</th>
                <th scope="col" class="text-right">Invocations</th>
                <th scope="col" class="text-right">Success</th>
                <th scope="col">Last enhanced</th>
                <th scope="col" class="text-right">History</th>
                <th scope="col" class="w-1">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (c of clones(); track c.kind + ':' + c.slug) {
                <tr data-testid="clones-row">
                  <td class="font-medium">{{ c.slug }}</td>
                  <td class="text-xs">{{ c.kind }}</td>
                  <td>
                    <span
                      class="badge badge-sm"
                      data-testid="clones-status-badge"
                      [class]="statusClass(c)"
                    >
                      {{ statusLabel(c) }}
                    </span>
                  </td>
                  <td class="text-right tabular-nums">
                    {{ c.invocationCount }}
                  </td>
                  <td class="text-right tabular-nums">
                    {{ formatSuccessRate(c.successRate) }}
                  </td>
                  <td class="text-xs">
                    {{ formatRelative(c.lastEnhancedAt) }}
                  </td>
                  <td class="text-right tabular-nums">{{ c.historyCount }}</td>
                  <td>
                    <div class="flex justify-end gap-1">
                      <button
                        type="button"
                        class="btn btn-xs btn-primary"
                        data-testid="clones-enhance-btn"
                        [disabled]="busySlug() === c.slug"
                        (click)="onEnhance(c)"
                      >
                        Enhance now
                      </button>
                      <button
                        type="button"
                        class="btn btn-xs btn-outline"
                        data-testid="clones-revert-btn"
                        [disabled]="busySlug() === c.slug"
                        (click)="onOpenRevert(c)"
                      >
                        Revert
                      </button>
                      @if (c.diverged) {
                        <button
                          type="button"
                          class="btn btn-xs btn-warning"
                          data-testid="clones-rebase-btn"
                          [disabled]="busySlug() === c.slug"
                          (click)="onRebase(c)"
                        >
                          Rebase to upstream
                        </button>
                        <button
                          type="button"
                          class="btn btn-xs btn-outline btn-warning"
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
        </div>

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

  public readonly history = computed(() => this.state.detail()?.history ?? []);

  public readonly revertTarget = signal<CloneSummary | null>(null);
  public readonly busySlug = signal<string | null>(null);
  public readonly toast = signal<ClonesToast | null>(null);

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
      const result = await this.rpc.enhanceNow(c.slug);
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
      const result = await this.rpc.revertEnhancement(c.slug, historyTs);
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

  protected statusLabel(c: CloneSummary): SkillCloneStatus {
    return c.diverged ? 'diverged' : c.cloneStatus;
  }

  protected statusClass(c: CloneSummary): string {
    if (c.diverged) return 'badge-warning';
    switch (c.cloneStatus) {
      case 'authored':
        return 'badge-info';
      case 'synth':
        return 'badge-secondary';
      case 'diverged':
        return 'badge-warning';
      default:
        return 'badge-ghost';
    }
  }

  protected formatSuccessRate(rate: number): string {
    if (!Number.isFinite(rate)) return '—';
    return `${Math.round(rate * 100)}%`;
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
