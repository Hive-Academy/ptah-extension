/**
 * CloneDetailDrawerComponent — the Library entry detail slide-over.
 *
 * Opened by clicking a clone card. Presentational: every piece of data arrives
 * through `input()` and every intent leaves through `output()`; the view
 * component owns the RPC calls and the state service.
 *
 * Sections, in order: identity + status, contextual actions (same gating as
 * the card, with the divergence choices spelled out in full rather than hidden
 * in a tooltip), agent scorecard, the SKILL.md body preview, and the history
 * timeline with an on-demand Monaco diff of any snapshot against the live body.
 *
 * The body preview goes through `@ptah-extension/markdown`, never
 * `[innerHTML]`. The diff surface is `ptah-lazy-diff-view`, which pulls the
 * editor bundle at runtime only.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';
import { NativeDrawerComponent } from '@ptah-extension/ui';
import type {
  AgentScorecard,
  CloneSummary,
  ScorecardInvocationRow,
  SkillCloneHistoryEntry,
  SkillCloneStatus,
} from '@ptah-extension/shared';

import { LazyDiffViewComponent } from './lazy-diff-view.component';
import { ScorecardBadgeComponent } from './scorecard-badge.component';
import { ScorecardDetailComponent } from './scorecard-detail.component';
import {
  CloneActionModel,
  KEEP_MINE_EXPLANATION,
  REBASE_EXPLANATION,
  cloneActionModel,
  cloneStatusLabel,
  formatHistoryTimestamp,
  formatRelative,
  formatSuccessRate,
} from './clone-action-gating';

/** One history snapshot's body, loaded on demand for the diff surface. */
export interface CloneHistoryDiff {
  readonly ts: string;
  readonly body: string;
}

/** A revert / diff request carries both the entry and the snapshot stamp. */
export interface CloneHistoryRequest {
  readonly clone: CloneSummary;
  readonly ts: string;
}

interface DrawerViewModel {
  readonly clone: CloneSummary;
  readonly actions: CloneActionModel;
  readonly status: SkillCloneStatus;
  readonly dotClass: string;
  readonly metrics: ReadonlyArray<{ label: string; value: string }>;
}

const STATUS_DOT: Record<SkillCloneStatus, string> = {
  authored: 'bg-info',
  clone: 'bg-base-content/40',
  synth: 'bg-secondary',
  diverged: 'bg-warning',
};

@Component({
  selector: 'ptah-clone-detail-drawer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NativeDrawerComponent,
    MarkdownBlockComponent,
    ScorecardBadgeComponent,
    ScorecardDetailComponent,
    LazyDiffViewComponent,
  ],
  template: `
    <ptah-native-drawer
      [isOpen]="clone() !== null"
      [ariaLabel]="drawerLabel()"
      widthClass="w-full max-w-3xl"
      (closed)="closed.emit()"
    >
      <!--
        Each projection slot needs its own single-root @if: a slot inside a
        multi-root @if silently falls through to the default slot (NG8011).
      -->
      @if (vm(); as m) {
        <div drawer-header class="min-w-0">
          <h2 class="truncate font-mono text-sm font-medium">
            {{ m.clone.slug }}
          </h2>
          <p class="mt-1 flex flex-wrap items-center gap-1.5 text-[11px]">
            <span
              class="inline-block size-1.5 rounded-full"
              [class]="m.dotClass"
              aria-hidden="true"
            ></span>
            <span class="text-base-content-muted" data-testid="drawer-status">{{
              m.status
            }}</span>
            <span class="text-base-content/25" aria-hidden="true">·</span>
            <span class="text-base-content-muted">{{ m.clone.kind }}</span>
          </p>
        </div>
      }

      @if (vm(); as m) {
        <div class="space-y-5">
          @if (m.metrics.length > 0) {
            <dl
              class="grid grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-4"
              data-testid="drawer-metrics"
            >
              @for (metric of m.metrics; track metric.label) {
                <div class="min-w-0">
                  <dt
                    class="text-[10px] uppercase tracking-wide text-base-content-muted"
                  >
                    {{ metric.label }}
                  </dt>
                  <dd class="truncate tabular-nums">{{ metric.value }}</dd>
                </div>
              }
            </dl>
          } @else {
            <p
              class="text-xs text-base-content-muted"
              data-testid="drawer-unused"
            >
              Never invoked yet — usage metrics appear after its first recorded
              run.
            </p>
          }

          @if (m.actions.upstreamNote; as note) {
            <p
              class="rounded-lg bg-base-300/40 px-3 py-2 text-xs text-base-content-muted"
              data-testid="drawer-upstream-note"
            >
              {{ note }}
            </p>
          }

          <section class="space-y-2">
            <h3 class="text-xs font-medium text-base-content-muted">Actions</h3>
            <div class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="btn btn-primary btn-xs"
                data-testid="drawer-enhance-btn"
                [disabled]="!m.actions.enhance.enabled || busy()"
                [title]="m.actions.enhance.reason ?? enhanceTitle"
                (click)="enhance.emit(m.clone)"
              >
                Enhance now
              </button>
              @if (m.actions.enhance.reason; as reason) {
                <span
                  class="text-[11px] text-base-content-muted"
                  data-testid="drawer-enhance-reason"
                  >{{ reason }}</span
                >
              }
            </div>

            @if (m.clone.diverged) {
              <div
                class="space-y-3 rounded-lg border border-warning/40 bg-warning/5 p-3"
                data-testid="drawer-divergence"
              >
                <p class="text-xs font-medium text-warning">
                  Upstream changed since this copy was made.
                </p>

                @if (m.actions.rebase) {
                  <div class="space-y-1">
                    <button
                      type="button"
                      class="btn btn-outline btn-warning btn-xs"
                      data-testid="drawer-rebase-btn"
                      [disabled]="busy()"
                      (click)="rebase.emit(m.clone)"
                    >
                      Rebase to upstream
                    </button>
                    <p class="text-[11px] text-base-content-muted">
                      {{ rebaseExplanation }}
                    </p>
                  </div>
                }

                <div class="space-y-1">
                  <button
                    type="button"
                    class="btn btn-outline btn-warning btn-xs"
                    data-testid="drawer-keep-btn"
                    [disabled]="busy()"
                    (click)="keep.emit(m.clone)"
                  >
                    Keep mine
                  </button>
                  <p
                    class="text-[11px] text-base-content-muted"
                    data-testid="drawer-keep-explanation"
                  >
                    {{ keepMineExplanation }}
                  </p>
                </div>
              </div>
            }
          </section>

          @if (m.clone.kind === 'agent') {
            <section class="space-y-2" data-testid="drawer-scorecard">
              <h3 class="text-xs font-medium text-base-content-muted">
                Scorecard
              </h3>
              <ptah-scorecard-badge [scorecard]="scorecard()" />
              <ptah-scorecard-detail
                [rows]="scorecardRows()"
                [findingsExcerpt]="scorecardFindings()"
                [loading]="scorecardLoading()"
              />
            </section>
          }

          <section class="space-y-2">
            <h3 class="text-xs font-medium text-base-content-muted">Body</h3>
            @if (detailLoading()) {
              <p
                class="text-xs text-base-content-muted"
                data-testid="drawer-body-loading"
              >
                Loading body…
              </p>
            } @else if (body(); as text) {
              <div
                class="max-h-72 overflow-y-auto rounded-lg border border-base-300 bg-base-200/40 p-3"
                data-testid="drawer-body"
              >
                <ptah-markdown-block [content]="text" />
              </div>
            } @else {
              <p
                class="text-xs text-base-content-muted"
                data-testid="drawer-body-empty"
              >
                No body could be read for this entry.
              </p>
            }
          </section>

          <section class="space-y-2">
            <h3 class="text-xs font-medium text-base-content-muted">
              History
              <span class="font-normal text-base-content-muted"
                >({{ history().length }})</span
              >
            </h3>

            @if (detailLoading()) {
              <p class="text-xs text-base-content-muted">Loading history…</p>
            } @else if (history().length === 0) {
              <p
                class="text-xs text-base-content-muted"
                data-testid="drawer-history-empty"
              >
                No snapshots yet. One is written every time this entry is
                enhanced or rebased, so there is nothing to compare or revert
                to.
              </p>
            } @else {
              <ol class="space-y-1" data-testid="drawer-history">
                @for (h of history(); track h.ts) {
                  <li
                    class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-200/30 px-3 py-2"
                    data-testid="drawer-history-entry"
                  >
                    <span class="min-w-0">
                      <span class="block text-xs tabular-nums">{{
                        formatTs(h.ts)
                      }}</span>
                      @if (!h.hasBody) {
                        <span class="block text-[10px] text-base-content-muted"
                          >snapshot has no readable body</span
                        >
                      }
                    </span>
                    <span class="flex items-center gap-1">
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        data-testid="drawer-history-diff-btn"
                        [disabled]="!h.hasBody || historyDiffLoading() === h.ts"
                        (click)="
                          historyDiffRequested.emit({
                            clone: m.clone,
                            ts: h.ts,
                          })
                        "
                      >
                        {{
                          historyDiffLoading() === h.ts ? 'Loading…' : 'Diff'
                        }}
                      </button>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        data-testid="clones-history-revert-btn"
                        [disabled]="!h.hasBody || busy()"
                        (click)="revertTo.emit({ clone: m.clone, ts: h.ts })"
                      >
                        Revert to this
                      </button>
                    </span>
                  </li>
                }
              </ol>
            }

            @if (historyDiff(); as diff) {
              <div class="space-y-1" data-testid="drawer-history-diff">
                <div class="flex items-center justify-between">
                  <p class="text-[11px] text-base-content-muted">
                    {{ formatTs(diff.ts) }} (left) vs current (right)
                  </p>
                  <button
                    type="button"
                    class="btn btn-ghost btn-xs"
                    data-testid="drawer-history-diff-close"
                    (click)="historyDiffCleared.emit()"
                  >
                    Close diff
                  </button>
                </div>
                <div
                  class="h-80 overflow-hidden rounded-lg border border-base-300"
                >
                  <ptah-lazy-diff-view
                    [label]="m.clone.slug"
                    [original]="diff.body"
                    [modified]="body() ?? ''"
                  />
                </div>
              </div>
            }
          </section>
        </div>
      }
    </ptah-native-drawer>
  `,
})
export class CloneDetailDrawerComponent {
  /** The entry being inspected. `null` closes the drawer. */
  public readonly clone = input<CloneSummary | null>(null);
  public readonly body = input<string | null>(null);
  public readonly history = input<readonly SkillCloneHistoryEntry[]>([]);
  public readonly detailLoading = input<boolean>(false);
  public readonly scorecard = input<AgentScorecard | null>(null);
  public readonly scorecardRows = input<ScorecardInvocationRow[]>([]);
  public readonly scorecardFindings = input<string | null>(null);
  public readonly scorecardLoading = input<boolean>(false);
  /** An action for this entry is in flight. */
  public readonly busy = input<boolean>(false);
  /** Loaded snapshot body to diff against the live body. */
  public readonly historyDiff = input<CloneHistoryDiff | null>(null);
  /** Timestamp whose body is currently being fetched, or `null`. */
  public readonly historyDiffLoading = input<string | null>(null);

  public readonly closed = output<void>();
  public readonly enhance = output<CloneSummary>();
  public readonly rebase = output<CloneSummary>();
  public readonly keep = output<CloneSummary>();
  public readonly revertTo = output<CloneHistoryRequest>();
  public readonly historyDiffRequested = output<CloneHistoryRequest>();
  public readonly historyDiffCleared = output<void>();

  protected readonly keepMineExplanation = KEEP_MINE_EXPLANATION;
  protected readonly rebaseExplanation = REBASE_EXPLANATION;
  protected readonly enhanceTitle =
    'Propose an improvement from recorded usage. You review the diff before anything is written.';

  /** Everything derived from the selected entry, or null when closed. */
  protected readonly vm = computed<DrawerViewModel | null>(() => {
    const clone = this.clone();
    if (clone === null) return null;
    const status = cloneStatusLabel(clone);
    return {
      clone,
      actions: cloneActionModel(clone),
      status,
      dotClass: STATUS_DOT[status],
      metrics: this.buildMetrics(clone),
    };
  });

  protected readonly drawerLabel = computed(() => {
    const c = this.clone();
    return c === null ? 'Library entry' : `${c.kind} details: ${c.slug}`;
  });

  protected formatTs(ts: string): string {
    return formatHistoryTimestamp(ts);
  }

  /** Only metrics that carry real data — never a row of em dashes. */
  private buildMetrics(
    clone: CloneSummary,
  ): ReadonlyArray<{ label: string; value: string }> {
    const out: Array<{ label: string; value: string }> = [];
    if (clone.invocationCount > 0) {
      out.push({ label: 'Invocations', value: String(clone.invocationCount) });
    }
    const success = formatSuccessRate(clone);
    if (success !== null) out.push({ label: 'Success', value: success });
    if (clone.lastEnhancedAt !== null) {
      out.push({
        label: 'Last enhanced',
        value: formatRelative(clone.lastEnhancedAt),
      });
    }
    if (clone.historyCount > 0) {
      out.push({ label: 'History', value: String(clone.historyCount) });
    }
    return out;
  }
}
