/**
 * EnhancePreviewDrawerComponent — review-before-write for "Enhance now".
 *
 * The old flow ran `skillSynthesis:enhanceNow`, which generated, judged AND
 * wrote in one shot; the user only learned what changed from a toast. This
 * drawer sits between: `skillSynthesis:previewEnhancement` produces a candidate
 * body plus the judge's score and reasoning, the diff is rendered with Monaco,
 * and nothing touches disk until Apply is pressed
 * (`skillSynthesis:applyProposal`).
 *
 * Purely presentational — the parent owns both RPC calls.
 *
 * `proposed === false` is a first-class state, not an error: the judge can
 * reject a candidate, in which case the reason is shown and the diff is still
 * rendered when both bodies are known, but Apply is unavailable because there
 * is no `proposalId` to commit.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { NativeDrawerComponent } from '@ptah-extension/ui';
import type {
  CloneSummary,
  SkillSynthesisPreviewEnhancementResult,
} from '@ptah-extension/shared';

import { LazyDiffViewComponent } from './lazy-diff-view.component';

@Component({
  selector: 'ptah-enhance-preview-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeDrawerComponent, LazyDiffViewComponent],
  template: `
    <ptah-native-drawer
      [isOpen]="clone() !== null"
      [ariaLabel]="drawerLabel()"
      widthClass="w-full max-w-5xl"
      [closeOnBackdrop]="!applying()"
      (closed)="discard.emit()"
    >
      <!--
        One single-root @if per projection slot: a slot inside a multi-root
        @if silently falls through to the default slot (NG8011).
      -->
      @if (clone(); as c) {
        <div drawer-header class="min-w-0">
          <h2 class="text-sm font-medium">Proposed enhancement</h2>
          <p
            class="mt-0.5 truncate font-mono text-[11px] text-base-content-muted"
          >
            {{ c.kind }} · {{ c.slug }}
          </p>
        </div>
      }

      @if (clone(); as c) {
        <div class="space-y-4">
          @if (loading()) {
            <div
              class="flex items-center gap-2 text-sm text-base-content-muted"
              data-testid="preview-loading"
            >
              <span class="loading loading-spinner loading-sm"></span>
              Generating and judging a proposal — nothing is written yet.
            </div>
          } @else if (error(); as message) {
            <div
              role="alert"
              class="alert alert-error py-2 text-sm"
              data-testid="preview-error"
            >
              <span>{{ message }}</span>
            </div>
          } @else if (preview(); as p) {
            <div class="flex flex-wrap items-center gap-2">
              @if (p.proposed) {
                <span
                  class="badge badge-success badge-sm"
                  data-testid="preview-verdict"
                  >Proposal ready</span
                >
              } @else {
                <span
                  class="badge badge-ghost badge-sm"
                  data-testid="preview-verdict"
                  >No change proposed</span
                >
              }
              @if (p.judgeScore !== null) {
                <span
                  class="badge badge-outline badge-sm tabular-nums"
                  data-testid="preview-judge-score"
                  >judge {{ p.judgeScore }}</span
                >
              }
            </div>

            @if (p.judgeReason; as reason) {
              <div class="space-y-1" data-testid="preview-judge-reason">
                <p class="text-xs font-medium text-base-content-muted">
                  Judge reasoning
                </p>
                <p
                  class="rounded-lg border border-base-300 bg-base-200/40 p-3 text-xs text-base-content-muted"
                >
                  {{ reason }}
                </p>
              </div>
            }

            @if (!p.proposed && p.skipReason) {
              <p
                class="rounded-lg bg-base-300/40 px-3 py-2 text-xs text-base-content-muted"
                data-testid="preview-skip-reason"
              >
                {{ p.skipReason }}
              </p>
            }

            @if (canShowDiff()) {
              <div class="space-y-1">
                <p class="text-[11px] text-base-content-muted">
                  Current (left) vs proposed (right)
                </p>
                <div
                  class="h-[26rem] overflow-hidden rounded-lg border border-base-300"
                  data-testid="preview-diff"
                >
                  <ptah-lazy-diff-view
                    [label]="c.slug"
                    [original]="p.currentBody ?? ''"
                    [modified]="p.proposedBody ?? ''"
                  />
                </div>
              </div>
            } @else if (!p.proposed) {
              <p
                class="text-xs text-base-content-muted"
                data-testid="preview-no-diff"
              >
                There is no candidate body to compare.
              </p>
            }
          }
        </div>
      }

      @if (clone(); as c) {
        <div
          drawer-footer
          class="flex items-center justify-between gap-2 border-t border-base-300 px-4 py-3"
        >
          <span class="text-[11px] text-base-content-muted">
            Nothing is written until you press Apply.
          </span>
          <span class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              data-testid="preview-discard-btn"
              [disabled]="applying()"
              (click)="discard.emit()"
            >
              Discard
            </button>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              data-testid="preview-apply-btn"
              [disabled]="proposalId() === null || applying()"
              [title]="applyTitle()"
              (click)="onApply()"
            >
              {{ applying() ? 'Applying…' : 'Apply' }}
            </button>
          </span>
        </div>
      }
    </ptah-native-drawer>
  `,
})
export class EnhancePreviewDrawerComponent {
  /** The entry being enhanced. `null` closes the drawer. */
  public readonly clone = input<CloneSummary | null>(null);
  public readonly preview =
    input<SkillSynthesisPreviewEnhancementResult | null>(null);
  public readonly loading = input<boolean>(false);
  public readonly applying = input<boolean>(false);
  public readonly error = input<string | null>(null);

  /** Emits the proposal id to commit. */
  public readonly apply = output<string>();
  /** Close without writing anything. */
  public readonly discard = output<void>();

  protected readonly proposalId = computed(
    () => this.preview()?.proposalId ?? null,
  );

  protected readonly drawerLabel = computed(() => {
    const c = this.clone();
    return c === null
      ? 'Proposed enhancement'
      : `Proposed enhancement for ${c.slug}`;
  });

  /**
   * A diff is worth rendering whenever both sides are known — including for a
   * judge-rejected candidate, where seeing what was rejected is the point.
   */
  protected readonly canShowDiff = computed(() => {
    const p = this.preview();
    if (!p) return false;
    return (
      typeof p.currentBody === 'string' &&
      typeof p.proposedBody === 'string' &&
      p.proposedBody.length > 0
    );
  });

  protected readonly applyTitle = computed(() =>
    this.proposalId() === null
      ? 'No applicable proposal — nothing to write.'
      : 'Write the proposed body and snapshot the current one to history.',
  );

  protected onApply(): void {
    const id = this.proposalId();
    if (id === null) return;
    this.apply.emit(id);
  }
}
