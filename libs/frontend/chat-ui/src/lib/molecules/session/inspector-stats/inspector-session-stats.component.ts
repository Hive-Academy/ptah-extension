import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ModelStateService } from '@ptah-extension/core';
import {
  resolveModelDisplayName,
  type SessionBudgetStage,
} from '@ptah-extension/shared';
import { AlertTriangle, LucideAngularModule } from 'lucide-angular';
import {
  formatCost,
  formatDuration,
  formatOptionalTokens,
  formatTokens,
} from '../session-stats-format';
import {
  costBudgetSuffix,
  costBudgetText,
  tokensBudgetSuffix,
} from '../session-budget-format';
import { StatsTileExpansionState } from '../plan-limits/stats-tile-expansion.state';
import { InspectorCacheTileComponent } from './inspector-cache-tile.component';
import {
  STATS_EMPTY,
  contextDetailsText,
  costDetailsText,
  durationMsOf,
  knownSubtotalOf,
  tokenDetailsText,
  type SessionStatsInputs,
} from '../session-stats-view';

let nextSessionId = 0;

@Component({
  selector: 'ptah-inspector-session-stats',
  standalone: true,
  imports: [LucideAngularModule, NgTemplateOutlet, InspectorCacheTileComponent],
  template: `
    @let s = stats();
    <section
      class="px-3 py-3"
      data-testid="inspector-session-stats"
      [attr.aria-labelledby]="headingId"
    >
      <div
        class="mb-2 flex items-center justify-between gap-2"
        data-glass-surface="plate"
      >
        <h3
          [id]="headingId"
          class="sec-label text-[10.5px] font-semibold uppercase"
        >
          SESSION
        </h3>
        @if (s.snapshot?.provisional) {
          <span class="text-[10.5px] text-base-content-muted"
            >~ = estimate</span
          >
        }
      </div>
      <!-- One row of totals split by vertical rules (rev 3 "B+"). -->
      <div class="grid grid-cols-3" data-testid="inspector-stats-grid">
        <div class="min-w-0 pr-2">
          <ng-container
            [ngTemplateOutlet]="label"
            [ngTemplateOutletContext]="{
              name: 'Context',
              key: 'sd-context',
              text: contextDetails(),
              id: contextLabelId,
            }"
          />
          <div
            class="text-base font-semibold leading-tight tabular-nums"
            [class.text-base-content-muted]="!s.context.known"
            [attr.aria-label]="!s.context.known ? empty.context : null"
            [attr.title]="!s.context.known ? notReported : null"
          >
            {{ s.context.label }}
          </div>
          @if (s.context.known && s.context.percent !== null) {
            <div
              class="mt-1 h-1 rounded-full bg-[var(--surface-border-strong)]"
              role="progressbar"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="clampPercent(s.context.percent)"
              [attr.aria-labelledby]="contextLabelId"
              [attr.aria-valuetext]="
                s.context.usedTokens !== null
                  ? s.context.label +
                    ' of the context window, ' +
                    formatTokens(s.context.usedTokens) +
                    ' tokens used'
                  : s.context.label + ' of the context window'
              "
            >
              <span
                class="block h-full rounded-full bg-[var(--ptah-gold)]"
                [style.width.%]="clampPercent(s.context.percent)"
              ></span>
            </div>
          }
          @if (s.compactionCount > 0) {
            <p class="mt-0.5 text-[10.5px] text-base-content-muted">
              {{ s.compactionCount }}
              {{ s.compactionCount === 1 ? 'compaction' : 'compactions' }}
            </p>
          }
        </div>
        <div class="min-w-0 border-l border-surface-border px-2">
          <ng-container
            [ngTemplateOutlet]="label"
            [ngTemplateOutletContext]="{
              name: 'Tokens',
              key: 'sd-tokens',
              text: tokenDetails(),
            }"
          />
          <div
            class="text-base font-semibold leading-tight tabular-nums"
            [class.text-base-content-muted]="
              (s.snapshot?.tokenCount ?? null) === null
            "
            [attr.aria-label]="
              (s.snapshot?.tokenCount ?? null) === null ? empty.tokens : null
            "
            [attr.title]="
              (s.snapshot?.tokenCount ?? null) === null ? notReported : null
            "
          >
            @if (s.snapshot?.provisional) {
              <span aria-hidden="true">~</span
              ><span class="sr-only">estimated </span>
            }
            {{ tokenLabel() }}
          </div>
          @if (tokensBudgetSuffix(s.budget); as suffix) {
            <p class="text-[10.5px] text-base-content-muted">
              of {{ suffix.slice(2) }} budget
            </p>
          } @else {
            <p class="text-[10.5px] text-base-content-muted">all agents</p>
          }
          @if (s.budget?.measure === 'tokens' && s.budget?.percent !== null) {
            <div
              role="progressbar"
              aria-label="Session token budget"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="clampPercent(s.budget!.percent!)"
              [attr.aria-valuetext]="
                floor(s.budget!.percent!) +
                '% of the ' +
                formatTokens(s.budget!.limit) +
                ' token budget'
              "
              class="mt-1 h-1 rounded-full bg-[var(--surface-border-strong)]"
            >
              <span
                class="block h-full rounded-full"
                [style.width.%]="clampPercent(s.budget!.percent!)"
                [style.background-color]="budgetInk(s.budget!.stage)"
              ></span>
            </div>
          }
        </div>
        <div class="min-w-0 border-l border-surface-border pl-2">
          <ng-container
            [ngTemplateOutlet]="label"
            [ngTemplateOutletContext]="{
              name: 'Cost',
              key: 'sd-cost',
              text: costDetails(),
            }"
          />
          <div class="text-base font-semibold leading-tight tabular-nums">
            @if (s.snapshot?.provisional) {
              <span aria-hidden="true">~</span
              ><span class="sr-only">estimated </span>
            }
            @if (costBudgetText(s.budget); as text) {
              {{ text }}
            } @else if ((s.snapshot?.totalCost ?? null) === null) {
              <span
                class="text-base-content-muted"
                [attr.aria-label]="empty.cost"
                [attr.title]="notReported"
                >{{ empty.value }}</span
              >
            } @else {
              {{ formatCost(s.snapshot!.totalCost) }}
            }
          </div>
          @if (costBudgetSuffix(s.budget); as suffix) {
            <p class="text-[10.5px] text-base-content-muted">
              of {{ suffix.slice(2) }} budget
            </p>
          } @else if (!costBudgetText(s.budget) && knownSubtotal()) {
            <p class="text-[10.5px] text-base-content-muted">
              known subtotal {{ formatCost(knownSubtotal()!.value) }}
            </p>
          } @else {
            <p class="text-[10.5px] text-base-content-muted">this session</p>
          }
          @if (s.budget?.measure === 'cost' && s.budget?.percent !== null) {
            <div
              role="progressbar"
              aria-label="Session cost budget"
              aria-valuemin="0"
              aria-valuemax="100"
              [attr.aria-valuenow]="clampPercent(s.budget!.percent!)"
              [attr.aria-valuetext]="
                floor(s.budget!.percent!) +
                '% of the ' +
                costBudgetSuffix(s.budget)!.slice(2) +
                ' cost budget'
              "
              class="mt-1 h-1 rounded-full bg-[var(--surface-border-strong)]"
            >
              <span
                class="block h-full rounded-full"
                [style.width.%]="clampPercent(s.budget!.percent!)"
                [style.background-color]="budgetInk(s.budget!.stage)"
              ></span>
            </div>
          }
        </div>
      </div>
      @for (d of openDetails(); track d.key) {
        <div
          [id]="detailId(d.key)"
          role="region"
          [attr.aria-label]="d.name + ' details'"
          class="mt-2 border-t border-surface-border pt-2 text-[10.5px] text-base-content-muted whitespace-pre-line"
          [textContent]="d.text"
        ></div>
      }
      @if (s.limitSummary.state !== 'none') {
        <p
          class="mt-2 flex items-center gap-1.5 text-[11px]"
          data-glass-surface="plate"
          [style.color]="
            s.limitSummary.state === 'at'
              ? 'var(--state-ink-err)'
              : 'var(--state-ink-need)'
          "
        >
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1">{{ s.limitSummary.fullText }}</span>
          <button
            type="button"
            class="h-6 min-w-6 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content"
            (click)="
              limitsLinkActivated.emit(
                s.limitSummary.source === 'lane' ? 'lane' : 'session'
              )
            "
          >
            {{ s.limitSummary.source === 'lane' ? 'Lanes' : 'Plan limits' }}
          </button>
        </p>
      }
      <!-- Second row: Time | Model | Cache, the same metric cells as above. -->
      <div
        class="mt-2 grid grid-cols-3 border-t border-surface-border pt-2"
        data-testid="inspector-stats-grid-2"
      >
        <div class="min-w-0 pr-2" data-testid="inspector-session-time">
          <div class="text-[10.5px] text-base-content-muted">Time</div>
          @if (duration(); as ms) {
            <div class="text-base font-semibold leading-tight tabular-nums">
              {{ formatDuration(ms) }}
            </div>
          } @else {
            <div
              class="text-base font-semibold leading-tight text-base-content-muted"
              [attr.title]="notReported"
            >
              {{ empty.value }}
            </div>
          }
          @if (turns() !== null) {
            <p class="text-[10.5px] text-base-content-muted tabular-nums">
              {{ turns() }} {{ turns() === 1 ? 'turn' : 'turns' }}
            </p>
          }
        </div>
        <div class="min-w-0 border-l border-surface-border px-2">
          @if (modelNames().length >= 2) {
            <button
              type="button"
              class="cursor-pointer text-[10.5px] text-base-content-muted underline decoration-dotted underline-offset-2 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content"
              [attr.aria-expanded]="isOpen('sd-models')"
              [attr.aria-controls]="modelsPanelId"
              [title]="
                isOpen('sd-models')
                  ? 'Hide per-model breakdown'
                  : 'Show per-model breakdown'
              "
              (click)="toggle('sd-models')"
              (keydown.escape)="closeOnEscape($event, 'sd-models')"
            >
              Models
            </button>
          } @else {
            <div class="text-[10.5px] text-base-content-muted">Model</div>
          }
          <div
            class="truncate text-base font-semibold leading-tight"
            [class.text-base-content-muted]="modelNames().length === 0"
            [attr.title]="primaryModel() ?? notReported"
          >
            {{ modelNames()[0] ?? empty.value }}
          </div>
          @if (modelNames().length >= 2) {
            <p class="text-[10.5px] text-base-content-muted">
              +{{ modelNames().length - 1 }} more
            </p>
          }
        </div>
        <div class="min-w-0 border-l border-surface-border pl-2">
          @if (s.cache; as cache) {
            <ptah-inspector-cache-tile [cache]="cache" />
          } @else {
            <div class="text-[10.5px] text-base-content-muted">Cache</div>
            <div
              class="text-base font-semibold leading-tight text-base-content-muted"
              [attr.title]="notReported"
            >
              {{ empty.value }}
            </div>
          }
        </div>
      </div>
      @if (modelNames().length >= 2) {
        <div
          [id]="modelsPanelId"
          class="mt-2 grid gap-1.5"
          [hidden]="!isOpen('sd-models')"
          role="list"
          aria-label="Per-model usage"
        >
          @if (isOpen('sd-models')) {
            @for (row of s.snapshot?.modelUsageList ?? []; track row.model) {
              <div
                role="listitem"
                class="rounded-md border border-surface-border bg-surface-1 p-1.5"
                data-glass-surface="tile"
              >
                <div
                  class="flex items-center justify-between gap-2 text-[13px] font-semibold"
                >
                  <span class="min-w-0 truncate" [title]="row.model">{{
                    formatModelName(row.model)
                  }}</span>
                  <span class="tabular-nums">{{
                    formatCost(row.costUSD)
                  }}</span>
                </div>
                <div class="grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-4">
                  <span title="Uncached input tokens"
                    >In {{ formatOptionalTokens(row.inputTokens) }}</span
                  >
                  <span title="Output tokens"
                    >Out {{ formatOptionalTokens(row.outputTokens) }}</span
                  >
                  <span title="Cache read tokens"
                    >Cache read {{ formatOptionalTokens(row.cacheRead) }}</span
                  >
                  <span title="Cache creation tokens"
                    >Cache creation
                    {{ formatOptionalTokens(row.cacheCreation) }}</span
                  >
                </div>
              </div>
            }
            <div
              class="flex justify-between border-t border-surface-border pt-2 text-xs font-semibold"
            >
              <span>Total</span
              ><span>{{ formatCost(s.snapshot?.totalCost ?? null) }}</span>
            </div>
          }
        </div>
      }
    </section>
    <!-- A metric label: dotted underline with the details text as its tooltip; a click or Enter shows the text under the row. -->
    <ng-template
      #label
      let-name="name"
      let-key="key"
      let-text="text"
      let-id="id"
    >
      @if (text) {
        <button
          type="button"
          [attr.id]="id ?? null"
          class="cursor-help text-[10.5px] text-base-content-muted underline decoration-dotted underline-offset-2 hover:text-base-content focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content"
          [title]="text"
          [attr.aria-label]="name + ' details'"
          [attr.aria-expanded]="isOpen(key)"
          [attr.aria-controls]="isOpen(key) ? detailId(key) : null"
          (click)="toggle(key)"
          (keydown.escape)="closeOnEscape($event, key)"
        >
          {{ name }}
        </button>
      } @else {
        <div
          [attr.id]="id ?? null"
          class="text-[10.5px] text-base-content-muted"
        >
          {{ name }}
        </div>
      }
    </ng-template>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InspectorSessionStatsComponent {
  readonly stats = input.required<SessionStatsInputs>();
  readonly turns = input<number | null>(null);
  readonly limitsLinkActivated = output<'session' | 'lane'>();
  private readonly modelState = inject(ModelStateService);
  private readonly expansion =
    inject(StatsTileExpansionState, { optional: true }) ??
    new StatsTileExpansionState();
  private readonly instanceId = ++nextSessionId;
  protected readonly headingId = `ptah-session-h-${this.instanceId}`;
  protected readonly contextLabelId = `ptah-context-l-${this.instanceId}`;
  protected readonly modelsPanelId = `ptah-models-p-${this.instanceId}`;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly empty = STATS_EMPTY;
  protected readonly notReported = 'not reported';
  protected readonly formatCost = formatCost;
  protected readonly formatDuration = formatDuration;
  protected readonly formatOptionalTokens = formatOptionalTokens;
  protected readonly formatTokens = formatTokens;
  protected readonly costBudgetSuffix = costBudgetSuffix;
  protected readonly costBudgetText = costBudgetText;
  protected readonly tokensBudgetSuffix = tokensBudgetSuffix;
  protected readonly floor = Math.floor;
  protected readonly knownSubtotal = computed(() =>
    knownSubtotalOf(this.stats().snapshot),
  );
  protected readonly duration = computed(() =>
    durationMsOf(this.stats().snapshot),
  );
  protected readonly tokenLabel = computed(() => {
    const count = this.stats().snapshot?.tokenCount;
    return typeof count === 'number' ? formatTokens(count) : STATS_EMPTY.value;
  });
  protected readonly contextDetails = computed(() =>
    contextDetailsText(
      this.stats().liveModelStats,
      this.stats().compactionCount,
    ),
  );
  protected readonly tokenDetails = computed(() =>
    tokenDetailsText(this.stats().snapshot, this.stats().budget),
  );
  protected readonly costDetails = computed(() =>
    costDetailsText(this.stats().snapshot, this.stats().budget),
  );
  /** Details texts the user opened from a metric label, in row order. */
  protected readonly openDetails = computed(() =>
    [
      { key: 'sd-context', name: 'Context', text: this.contextDetails() },
      { key: 'sd-tokens', name: 'Tokens', text: this.tokenDetails() },
      { key: 'sd-cost', name: 'Cost', text: this.costDetails() },
    ].filter(
      (detail): detail is { key: string; name: string; text: string } =>
        !!detail.text && this.isOpen(detail.key),
    ),
  );
  protected readonly primaryModel = computed(
    () =>
      this.stats().liveModelStats?.model ??
      this.stats().snapshot?.model ??
      this.stats().snapshot?.modelUsageList?.[0]?.model ??
      null,
  );
  protected readonly modelNames = computed(() => {
    const rows = this.stats().snapshot?.modelUsageList ?? [];
    const primary = this.primaryModel();
    const ids = rows.length
      ? rows.map((row) => row.model)
      : primary
        ? [primary]
        : [];
    return ids.map((id) => this.formatModelName(id));
  });
  protected formatModelName(id: string): string {
    return resolveModelDisplayName(id, this.modelState.availableModels());
  }
  protected detailId(key: string): string {
    return `${key}-${this.instanceId}`;
  }
  protected isOpen(key: string): boolean {
    return this.expansion.isOpen(
      this.expansion.sessionKey(this, this.stats().sessionId),
      key,
    );
  }
  protected toggle(key: string): void {
    this.expansion.toggle(
      this.expansion.sessionKey(this, this.stats().sessionId),
      key,
    );
  }
  protected close(key: string): void {
    this.expansion.setOpen(
      this.expansion.sessionKey(this, this.stats().sessionId),
      key,
      false,
    );
  }
  protected closeOnEscape(event: Event, key: string): void {
    if (!this.isOpen(key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.close(key);
  }
  protected clampPercent(percent: number): number {
    return Math.min(100, Math.max(0, Math.floor(percent)));
  }
  protected budgetInk(stage: SessionBudgetStage): string {
    return stage === 'limit'
      ? 'var(--state-ink-err)'
      : stage === 'tighten' || stage === 'handoff'
        ? 'var(--state-ink-need)'
        : 'var(--ptah-gold)';
  }
}
