import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { VSCodeService } from '@ptah-extension/core';
import { LucideAngularModule, Check, Eye, Layers, X } from 'lucide-angular';
import type { SkillSuggestionSummary } from '@ptah-extension/shared';

import { SkillSynthesisStateService } from '../../services/skill-synthesis-state.service';

interface SuggestionsToast {
  readonly message: string;
  readonly kind: 'success' | 'error' | 'info';
}

@Component({
  selector: 'ptah-skill-suggestions-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule, LucideAngularModule],
  template: `
    @if (!isElectron()) {
      <div
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
        role="alert"
        data-testid="suggestions-desktop-notice"
      >
        <p class="text-sm font-medium">
          Skill suggestions are only available in the Ptah desktop app.
        </p>
      </div>
    } @else {
      <div class="space-y-4" data-testid="suggestions-view">
        <div class="flex items-center justify-between">
          <p class="text-sm text-base-content/60">
            Skills proposed from clusters of similar successful sessions.
          </p>
          <button
            type="button"
            class="btn btn-ghost btn-xs transition-colors duration-150"
            data-testid="suggestions-refresh"
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
            data-testid="suggestions-toast"
            [class.alert-success]="t.kind === 'success'"
            [class.alert-error]="t.kind === 'error'"
            [class.alert-info]="t.kind === 'info'"
          >
            <span>{{ t.message }}</span>
          </div>
        }

        @if (pending().length === 0 && !loading()) {
          <div
            class="rounded-xl border border-base-300 bg-base-200/40 px-6 py-12 text-center"
            data-testid="suggestions-empty"
          >
            <lucide-angular
              [img]="LayersIcon"
              class="mx-auto mb-2 size-8 text-base-content/30"
              aria-hidden="true"
            />
            <p class="text-sm font-medium">No pending suggestions.</p>
            <p class="mt-1 text-xs text-base-content/60">
              Thoth proposes a skill once enough similar sessions cluster
              together.
            </p>
          </div>
        } @else {
          <ul class="space-y-3" data-testid="suggestions-list">
            @for (s of pending(); track s.id) {
              <li
                class="rounded-xl border border-base-300 bg-base-200/40 p-4"
                data-testid="suggestions-card"
              >
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="min-w-0 space-y-1">
                    <div class="flex items-center gap-2">
                      <span
                        class="inline-block size-1.5 rounded-full bg-secondary"
                        aria-hidden="true"
                      ></span>
                      <span class="text-xs text-base-content/70"
                        >Pending review</span
                      >
                    </div>
                    <h3 class="truncate text-sm font-semibold">{{ s.name }}</h3>
                    <p class="text-xs text-base-content/70">
                      {{ s.description }}
                    </p>
                    <div
                      class="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1 text-xs text-base-content/60"
                    >
                      <span class="inline-flex items-center gap-1">
                        <lucide-angular
                          [img]="LayersIcon"
                          class="size-3"
                          aria-hidden="true"
                        />
                        {{ s.clusterSize }} session{{
                          s.clusterSize === 1 ? '' : 's'
                        }}
                      </span>
                      @if (s.technologyFingerprint) {
                        <span class="font-mono">{{
                          s.technologyFingerprint
                        }}</span>
                      }
                      <span class="tabular-nums"
                        >judge {{ formatScore(s.judgeScore) }}</span
                      >
                    </div>
                  </div>
                  <div class="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs transition-colors duration-150"
                      data-testid="suggestions-view-btn"
                      [disabled]="busyId() === s.id"
                      (click)="onView(s)"
                    >
                      <lucide-angular
                        [img]="EyeIcon"
                        class="size-3.5"
                        aria-hidden="true"
                      />
                      View
                    </button>
                    <button
                      type="button"
                      class="btn btn-success btn-xs transition-colors duration-150"
                      data-testid="suggestions-accept-btn"
                      [disabled]="busyId() === s.id"
                      (click)="onAccept(s)"
                    >
                      <lucide-angular
                        [img]="CheckIcon"
                        class="size-3.5"
                        aria-hidden="true"
                      />
                      Accept
                    </button>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs text-error transition-colors duration-150"
                      data-testid="suggestions-dismiss-btn"
                      [disabled]="busyId() === s.id"
                      (click)="onOpenDismiss(s)"
                    >
                      <lucide-angular
                        [img]="XIcon"
                        class="size-3.5"
                        aria-hidden="true"
                      />
                      Dismiss
                    </button>
                  </div>
                </div>
              </li>
            }
          </ul>
        }

        @if (viewTarget(); as target) {
          <dialog
            class="modal modal-open"
            role="dialog"
            aria-modal="true"
            aria-label="Suggestion detail"
            data-testid="suggestions-view-modal"
          >
            <div class="modal-box max-w-2xl">
              <h3 class="text-base font-semibold">{{ target.name }}</h3>
              <p
                class="mt-3 whitespace-pre-wrap text-sm text-base-content/80"
                data-testid="suggestions-view-body"
              >
                {{ target.description }}
              </p>
              <dl
                class="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-base-content/60"
              >
                <dt>Cluster size</dt>
                <dd class="tabular-nums">{{ target.clusterSize }}</dd>
                <dt>Technology</dt>
                <dd class="font-mono">
                  {{ target.technologyFingerprint || '—' }}
                </dd>
                <dt>Judge score</dt>
                <dd class="tabular-nums">
                  {{ formatScore(target.judgeScore) }}
                </dd>
                <dt>Member sessions</dt>
                <dd class="tabular-nums">
                  {{ target.memberSessionIds.length }}
                </dd>
              </dl>
              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-sm"
                  (click)="onCloseView()"
                >
                  Close
                </button>
              </div>
            </div>
          </dialog>
        }

        @if (dismissTarget(); as target) {
          <dialog
            class="modal modal-open"
            role="dialog"
            aria-modal="true"
            aria-label="Dismiss suggestion"
            data-testid="suggestions-dismiss-modal"
          >
            <div class="modal-box">
              <h3 class="text-base font-semibold">Dismiss suggestion</h3>
              <p class="mt-1 text-sm text-base-content/70">
                <span class="font-mono">{{ target.name }}</span>
              </p>
              <label class="mt-3 flex flex-col gap-1">
                <span class="text-xs text-base-content/60">
                  Reason <span class="text-base-content/50">(optional)</span>
                </span>
                <textarea
                  class="textarea textarea-bordered textarea-sm w-full"
                  rows="3"
                  [(ngModel)]="dismissReason"
                  aria-label="dismiss reason"
                ></textarea>
              </label>
              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-ghost btn-sm"
                  (click)="onCloseDismiss()"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  class="btn btn-error btn-sm transition-colors duration-150"
                  data-testid="suggestions-dismiss-confirm"
                  [disabled]="busyId() === target.id"
                  (click)="onConfirmDismiss(target)"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </dialog>
        }
      </div>
    }
  `,
})
export class SkillSuggestionsViewComponent implements OnInit {
  private readonly state = inject(SkillSynthesisStateService);
  private readonly vscodeService = inject(VSCodeService);

  protected readonly LayersIcon = Layers;
  protected readonly EyeIcon = Eye;
  protected readonly CheckIcon = Check;
  protected readonly XIcon = X;

  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  public readonly loading = this.state.suggestionsLoading;
  public readonly error = this.state.error;

  public readonly pending = computed(() =>
    this.state.suggestions().filter((s) => s.status === 'pending'),
  );

  public readonly viewTarget = signal<SkillSuggestionSummary | null>(null);
  public readonly dismissTarget = signal<SkillSuggestionSummary | null>(null);
  public readonly busyId = signal<string | null>(null);
  public readonly toast = signal<SuggestionsToast | null>(null);

  public dismissReason = '';

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.refreshSuggestions();
  }

  protected onRefresh(): void {
    void this.state.refreshSuggestions();
  }

  protected async onAccept(s: SkillSuggestionSummary): Promise<void> {
    this.busyId.set(s.id);
    try {
      await this.state.accept(s.id);
      this.showToast(`Accepted "${s.name}".`, 'success');
    } finally {
      this.busyId.set(null);
    }
  }

  protected onView(s: SkillSuggestionSummary): void {
    this.viewTarget.set(s);
  }

  protected onCloseView(): void {
    this.viewTarget.set(null);
  }

  protected onOpenDismiss(s: SkillSuggestionSummary): void {
    this.dismissReason = '';
    this.dismissTarget.set(s);
  }

  protected onCloseDismiss(): void {
    this.dismissTarget.set(null);
    this.dismissReason = '';
  }

  protected async onConfirmDismiss(s: SkillSuggestionSummary): Promise<void> {
    const reason = this.dismissReason.trim() || undefined;
    this.busyId.set(s.id);
    try {
      await this.state.dismiss(s.id, reason);
      this.showToast(`Dismissed "${s.name}".`, 'info');
      this.onCloseDismiss();
    } finally {
      this.busyId.set(null);
    }
  }

  protected formatScore(score: number): string {
    if (!Number.isFinite(score)) return '—';
    return score.toFixed(1);
  }

  private showToast(message: string, kind: SuggestionsToast['kind']): void {
    this.toast.set({ message, kind });
    setTimeout(() => this.toast.set(null), 3000);
  }
}
