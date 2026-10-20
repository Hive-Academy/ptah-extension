import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
} from '@angular/core';
import { resolveModelDisplayName } from '@ptah-extension/shared';
import { ModelStateService } from '@ptah-extension/core';
import { CostBadgeComponent } from '../../atoms/cost-badge.component';
import { formatTokens } from '../session/session-stats-format';

/**
 * Figures for one agent lane (sub-agent or CLI). Every field is "as known":
 * `null` means not reported and renders `—`, never `0`.
 */
export interface AgentLaneStatsView {
  readonly model: string | null;
  readonly contextTokens: number | null;
  readonly tokens: number | null;
  /** True when `tokens` is a lower bound (some usage was not reported). */
  readonly tokensPartial: boolean;
  readonly tokensTitle: string | null;
  /**
   * `undefined`: the producer reports no cost at all (`—`).
   * `null`: reported but unpriced ("cost unavailable").
   */
  readonly cost: number | null | undefined;
  readonly costPartial: boolean;
  readonly cache: 'warm' | 'cold' | null;
  readonly cacheTitle: string | null;
}

/**
 * AgentLaneStatsComponent - the compact stats bar at the top of an agent lane.
 *
 * Same chip look as the collapsed `ptah-session-stats-summary` bar, but fed by
 * a plain view model (lanes have no backend `SessionStatsEntry`). Values use
 * base-content ink: tinted text measured 1.4-2.4:1 on the light chips (D3).
 */
@Component({
  selector: 'ptah-agent-lane-stats',
  standalone: true,
  imports: [CostBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      role="group"
      aria-label="Agent usage"
      class="flex items-center gap-1.5 min-w-0 overflow-x-auto px-2 py-1 text-xs"
      data-testid="agent-lane-stats"
    >
      @if (modelName(); as name) {
        <span
          class="inline-flex items-center gap-1 bg-purple-600/15 border border-purple-600/25 rounded px-1.5 py-0.5 whitespace-nowrap"
          [title]="stats().model"
        >
          <span class="text-[10px] uppercase text-base-content-muted"
            >Model</span
          >
          <span
            class="text-base-content font-semibold"
            data-testid="lane-stats-model"
            >{{ name }}</span
          >
        </span>
      }
      <span
        class="inline-flex items-center gap-1 bg-cyan-600/15 border border-cyan-600/25 rounded px-1.5 py-0.5 whitespace-nowrap"
      >
        <span class="text-[10px] uppercase text-base-content-muted"
          >Context</span
        >
        <span
          class="text-base-content tabular-nums"
          data-testid="lane-stats-context"
          >{{ contextLabel() }}</span
        >
      </span>
      <span
        class="inline-flex items-center gap-1 bg-base-content/5 border border-base-content/10 rounded px-1.5 py-0.5 whitespace-nowrap"
        [attr.title]="stats().tokensTitle"
      >
        <span class="text-[10px] uppercase text-base-content-muted"
          >Tokens</span
        >
        <span
          class="text-base-content tabular-nums"
          data-testid="lane-stats-tokens"
          >{{ tokensLabel() }}</span
        >
      </span>
      <span
        class="inline-flex items-center gap-1 bg-success/10 border border-success/20 rounded px-1.5 py-0.5 whitespace-nowrap"
      >
        <span class="text-[10px] uppercase text-base-content-muted">Cost</span>
        @if (stats().cost === undefined) {
          <span class="text-base-content" data-testid="lane-stats-cost">—</span>
        } @else {
          <span data-testid="lane-stats-cost">
            @if (stats().costPartial && stats().cost !== null) {
              <span class="text-base-content" aria-hidden="true">≥ </span>
              <span class="sr-only">at least </span>
            }
            <ptah-cost-badge [cost]="stats().cost" />
          </span>
        }
      </span>
      @if (stats().cache; as cache) {
        <span
          class="inline-flex items-center gap-1 bg-base-content/5 border border-base-content/10 rounded px-1.5 py-0.5 whitespace-nowrap"
          [attr.title]="stats().cacheTitle"
        >
          <span class="text-[10px] uppercase text-base-content-muted"
            >Cache</span
          >
          <span class="text-base-content" data-testid="lane-stats-cache">{{
            cache
          }}</span>
        </span>
      }
    </div>
  `,
})
export class AgentLaneStatsComponent {
  private readonly modelState = inject(ModelStateService);

  readonly stats = input.required<AgentLaneStatsView>();

  protected readonly modelName = computed(() => {
    const model = this.stats().model;
    return model
      ? resolveModelDisplayName(model, this.modelState.availableModels())
      : null;
  });

  protected readonly contextLabel = computed(() => {
    const context = this.stats().contextTokens;
    return context === null ? '—' : formatTokens(context);
  });

  protected readonly tokensLabel = computed(() => {
    const { tokens, tokensPartial } = this.stats();
    if (tokens === null) return '—';
    return `${tokensPartial ? '≥ ' : ''}${formatTokens(tokens)}`;
  });
}
