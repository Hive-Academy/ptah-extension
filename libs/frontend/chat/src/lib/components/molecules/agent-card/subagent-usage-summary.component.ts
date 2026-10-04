/**
 * Subagent Usage Summary Component
 *
 * Context size, prompt-cache state, cache read / write and output tokens and
 * the estimated cost of one Claude subagent (TASK_2026_597 N6). Shown when the
 * subagent's row is opened in the agent monitor panel.
 *
 * Opening the row makes the one `chat:subagent-query` call that supplies the
 * effective cache TTL; until it answers the cache state is unknown and no
 * warm/cold badge is shown. Warm/cold is re-evaluated when the record changes
 * or the store's shared tick advances — no timer of its own.
 */

import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import {
  AgentMonitorStore,
  subagentUsageView,
  type AgentUsageView,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import {
  NOT_REPORTED,
  formatDuration,
  formatEstimatedCost,
  formatOptionalTokens,
} from './stats-bar.utils';

@Component({
  selector: 'ptah-subagent-usage-summary',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-1 mb-1.5 rounded bg-base-200/50 border border-base-content/5 text-[10px] font-mono"
      role="group"
      aria-label="Subagent usage"
    >
      <span
        class="text-base-content-muted"
        data-testid="subagent-context"
        title="Context of the last request (input + cache read + cache write)"
      >
        ctx {{ contextLabel() }}
      </span>

      @if (view().cacheState !== 'unknown') {
        <span
          class="badge badge-xs"
          [class.badge-success]="view().cacheState === 'warm'"
          [class.badge-ghost]="view().cacheState === 'cold'"
          data-testid="subagent-cache-badge"
          [title]="cacheTitle()"
          [attr.aria-label]="cacheTitle()"
        >
          {{ view().cacheState }}
        </span>
      }

      @if (view().cacheReported) {
        <span
          class="text-info/70"
          data-testid="subagent-cache-read"
          title="Prompt-cache tokens read"
        >
          cache read {{ tokens(view().usage?.cacheRead) }}
        </span>
        <span
          class="text-info/70"
          data-testid="subagent-cache-write"
          title="Prompt-cache tokens written"
        >
          cache write {{ tokens(view().usage?.cacheWrite) }}
        </span>
      } @else {
        <span
          class="text-base-content-muted"
          data-testid="subagent-cache-not-reported"
          title="No prompt-cache tokens were reported for this subagent"
        >
          cache not reported
        </span>
      }

      <span
        class="text-accent/70"
        data-testid="subagent-output"
        title="Output tokens"
      >
        out {{ tokens(view().usage?.output) }}
      </span>

      <span
        class="text-warning/70 ml-auto"
        data-testid="subagent-cost"
        [title]="costTitle()"
      >
        {{ costLabel() }}
      </span>
    </div>
  `,
})
export class SubagentUsageSummaryComponent {
  private readonly store = inject(AgentMonitorStore);

  readonly record = input.required<SubagentRecord>();

  /** Re-runs the load only when a different subagent is shown. */
  private readonly parentToolUseId = computed(
    () => this.record().parentToolUseId,
  );

  readonly view = computed<AgentUsageView>(() => {
    // Shared 1s tick (runs while agents run): keeps warm/cold current without
    // a timer per row.
    this.store.tick();
    return subagentUsageView(this.record(), Date.now());
  });

  protected readonly contextLabel = computed(() =>
    formatOptionalTokens(this.view().contextTokens),
  );

  protected readonly cacheTitle = computed(() => {
    const view = this.view();
    const idle =
      view.idleMs === undefined ? 'unknown' : formatDuration(view.idleMs);
    return `Prompt cache ${view.cacheState} (TTL ${view.effectiveTtl ?? NOT_REPORTED}, idle ${idle})`;
  });

  protected readonly costLabel = computed(() =>
    formatEstimatedCost(this.view().estimatedCostUsd),
  );

  protected readonly costTitle = computed(() =>
    this.view().estimatedCostUsd === null
      ? 'No price is known for this model'
      : 'Estimated from the reported tokens and the model price table',
  );

  constructor() {
    effect(() => {
      const id = this.parentToolUseId();
      untracked(() => void this.loadCacheInfo(id));
    });
  }

  protected tokens(count: number | undefined): string {
    return formatOptionalTokens(count);
  }

  private async loadCacheInfo(parentToolUseId: string): Promise<void> {
    try {
      await this.store.loadSubagentCacheInfo(parentToolUseId);
    } catch (err: unknown) {
      // The store already reports an RPC failure result; a thrown transport
      // error lands here. Either way the cache state stays 'unknown'.
      console.warn(
        '[SubagentUsageSummary] cache info load failed:',
        err instanceof Error ? err.message : err,
      );
    }
  }
}
