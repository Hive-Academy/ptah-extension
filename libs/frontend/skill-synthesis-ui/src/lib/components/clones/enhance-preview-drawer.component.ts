/**
 * Review an enhancement draft and save its exact body on explicit user action.
 * The source hash guards against overwriting a clone changed since preview.
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
          } @else if (error() && !preview()) {
            <div
              role="alert"
              class="alert alert-error py-2 text-sm"
              data-testid="preview-error"
            >
              <span>{{ error() }}</span>
            </div>
          } @else if (preview(); as p) {
            @if (error(); as saveMessage) {
              <div role="alert" class="alert alert-error py-2 text-sm" data-testid="preview-save-error">
                {{ saveMessage }}
              </div>
            }
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
                    [original]="p.draft?.before ?? p.currentBody ?? ''"
                    [modified]="p.draft?.after ?? p.proposedBody ?? ''"
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
            Nothing is written until you press Save.
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
              data-testid="preview-save-btn"
              [disabled]="!canSave() || applying()"
              [title]="saveTitle()"
              (click)="onSave()"
            >
              {{ applying() ? 'Saving...' : 'Save' }}
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

  /** The reviewed body and its source revision; the parent performs the save. */
  public readonly save = output<{ body: string; expectedSourceHash: string }>();
  /** Close without writing anything. */
  public readonly discard = output<void>();

  protected readonly canSave = computed(() =>
    this.preview()?.proposed === true && this.preview()?.draft != null,
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
      typeof (p.draft?.before ?? p.currentBody) === 'string' &&
      typeof (p.draft?.after ?? p.proposedBody) === 'string' &&
      (p.draft?.after ?? p.proposedBody ?? '').length > 0
    );
  });

  protected readonly saveTitle = computed(() =>
    !this.canSave()
      ? 'No draft to save.'
      : 'Write the proposed body and snapshot the current one to history.',
  );

  protected onSave(): void {
    const preview = this.preview();
    const draft = preview?.draft;
    if (!preview?.proposed || !draft || this.applying()) return;
    this.save.emit({ body: draft.after, expectedSourceHash: draft.sourceHash });
  }
}
