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
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import {
  LucideAngularModule,
  Check,
  Eye,
  Layers,
  Pencil,
  X,
} from 'lucide-angular';
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
  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    MarkdownBlockComponent,
  ],
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
            Skills Thoth distilled from clusters of similar successful sessions
            — review and refine each before adding it to your library.
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
            <p class="text-sm font-medium">No recommended skills yet.</p>
            <p class="mt-1 text-xs text-base-content/60">
              Thoth recommends a skill once enough similar sessions cluster
              together and clear the quality judge. Run the Curator to scan now.
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
                      (click)="onReview(s)"
                    >
                      <lucide-angular
                        [img]="EyeIcon"
                        class="size-3.5"
                        aria-hidden="true"
                      />
                      Review
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

        @if (reviewId(); as id) {
          <dialog
            class="modal modal-open"
            role="dialog"
            aria-modal="true"
            aria-label="Review recommended skill"
            data-testid="suggestions-view-modal"
          >
            <div class="modal-box max-w-3xl">
              @if (detailLoading() && !detail()) {
                <p class="py-6 text-center text-sm text-base-content/60">
                  Loading skill…
                </p>
              } @else if (detail(); as d) {
                @if (editing()) {
                  <h3 class="text-base font-semibold">Edit skill</h3>
                  <div class="mt-3 space-y-3">
                    <label class="flex flex-col gap-1">
                      <span class="text-xs text-base-content/60">Title</span>
                      <input
                        type="text"
                        class="input input-bordered input-sm w-full font-mono"
                        data-testid="suggestions-edit-name"
                        [ngModel]="editName()"
                        (ngModelChange)="editName.set($event)"
                      />
                    </label>
                    <label class="flex flex-col gap-1">
                      <span class="text-xs text-base-content/60"
                        >Description (the trigger — when to use it)</span
                      >
                      <textarea
                        class="textarea textarea-bordered textarea-sm w-full"
                        rows="3"
                        data-testid="suggestions-edit-description"
                        [ngModel]="editDescription()"
                        (ngModelChange)="editDescription.set($event)"
                      ></textarea>
                    </label>
                    <label class="flex flex-col gap-1">
                      <span class="text-xs text-base-content/60"
                        >Body (SKILL.md instructions)</span
                      >
                      <textarea
                        class="textarea textarea-bordered textarea-sm w-full font-mono text-xs"
                        rows="16"
                        data-testid="suggestions-edit-body"
                        [ngModel]="editBody()"
                        (ngModelChange)="editBody.set($event)"
                      ></textarea>
                    </label>
                  </div>
                  <div class="modal-action">
                    <button
                      type="button"
                      class="btn btn-ghost btn-sm"
                      [disabled]="detailLoading()"
                      (click)="onCancelEdit()"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary btn-sm"
                      data-testid="suggestions-save-btn"
                      [disabled]="detailLoading() || !canSave()"
                      (click)="onSaveEdit(d.id)"
                    >
                      Save
                    </button>
                  </div>
                } @else {
                  <div class="flex items-start justify-between gap-3">
                    <h3 class="text-base font-semibold">{{ d.name }}</h3>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs"
                      data-testid="suggestions-edit-btn"
                      (click)="onStartEdit(d.name, d.description, d.body)"
                    >
                      <lucide-angular
                        [img]="PencilIcon"
                        class="size-3.5"
                        aria-hidden="true"
                      />
                      Edit
                    </button>
                  </div>
                  <p class="mt-1 text-sm text-base-content/80">
                    {{ d.description }}
                  </p>
                  <dl
                    class="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-base-content/60"
                  >
                    <dt>Cluster size</dt>
                    <dd class="tabular-nums">{{ d.clusterSize }}</dd>
                    <dt>Technology</dt>
                    <dd class="font-mono">
                      {{ d.technologyFingerprint || '—' }}
                    </dd>
                    <dt>Judge score</dt>
                    <dd class="tabular-nums">
                      {{ formatScore(d.judgeScore) }}
                    </dd>
                    <dt>Member sessions</dt>
                    <dd class="tabular-nums">
                      {{ d.memberSessionIds.length }}
                    </dd>
                  </dl>
                  <div
                    class="mt-4 max-h-96 overflow-y-auto rounded-lg border border-base-300 bg-base-100/40 p-3"
                    data-testid="suggestions-view-body"
                  >
                    <ptah-markdown-block [content]="d.body" />
                  </div>
                  <div class="modal-action">
                    <button
                      type="button"
                      class="btn btn-sm"
                      (click)="onCloseReview()"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      class="btn btn-success btn-sm"
                      data-testid="suggestions-modal-accept-btn"
                      [disabled]="busyId() === d.id"
                      (click)="onAcceptFromModal(d.id, d.name)"
                    >
                      Accept
                    </button>
                  </div>
                }
              } @else {
                <p class="py-6 text-center text-sm text-base-content/60">
                  Could not load this skill.
                </p>
                <div class="modal-action">
                  <button
                    type="button"
                    class="btn btn-sm"
                    (click)="onCloseReview()"
                  >
                    Close
                  </button>
                </div>
              }
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
  protected readonly PencilIcon = Pencil;

  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  public readonly loading = this.state.suggestionsLoading;
  public readonly error = this.state.error;
  public readonly detail = this.state.suggestionDetail;
  public readonly detailLoading = this.state.suggestionDetailLoading;

  public readonly pending = computed(() =>
    this.state.suggestions().filter((s) => s.status === 'pending'),
  );

  public readonly reviewId = signal<string | null>(null);
  public readonly editing = signal<boolean>(false);
  public readonly editName = signal<string>('');
  public readonly editDescription = signal<string>('');
  public readonly editBody = signal<string>('');
  public readonly dismissTarget = signal<SkillSuggestionSummary | null>(null);
  public readonly busyId = signal<string | null>(null);
  public readonly toast = signal<SuggestionsToast | null>(null);

  public readonly canSave = computed(
    () =>
      this.editName().trim().length > 0 &&
      this.editDescription().trim().length > 0 &&
      this.editBody().trim().length > 0,
  );

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
    this.state.clearSuggestionDetail();
    try {
      await this.state.accept(s.id);
      this.showToast(`Accepted "${s.name}".`, 'success');
    } finally {
      this.busyId.set(null);
    }
  }

  protected onReview(s: SkillSuggestionSummary): void {
    this.editing.set(false);
    this.reviewId.set(s.id);
    void this.state.loadSuggestionDetail(s.id);
  }

  protected onCloseReview(): void {
    this.reviewId.set(null);
    this.editing.set(false);
    this.state.clearSuggestionDetail();
  }

  protected onStartEdit(name: string, description: string, body: string): void {
    this.editName.set(name);
    this.editDescription.set(description);
    this.editBody.set(body);
    this.editing.set(true);
  }

  protected onCancelEdit(): void {
    this.editing.set(false);
  }

  protected async onSaveEdit(id: string): Promise<void> {
    if (!this.canSave()) return;
    const ok = await this.state.updateSuggestion(id, {
      name: this.editName().trim(),
      description: this.editDescription().trim(),
      body: this.editBody(),
    });
    if (ok) {
      this.editing.set(false);
      this.showToast('Saved changes.', 'success');
    } else {
      this.showToast(this.error() ?? 'Could not save changes.', 'error');
    }
  }

  protected async onAcceptFromModal(id: string, name: string): Promise<void> {
    this.busyId.set(id);
    try {
      await this.state.accept(id);
      this.showToast(`Accepted "${name}".`, 'success');
      this.onCloseReview();
    } finally {
      this.busyId.set(null);
    }
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
