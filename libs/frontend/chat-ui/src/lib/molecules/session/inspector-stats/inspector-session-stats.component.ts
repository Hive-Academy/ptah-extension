import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { ModelStateService } from '@ptah-extension/core';
import { resolveModelDisplayName, type SessionBudgetStage } from '@ptah-extension/shared';
import { AlertTriangle, ChevronRight, Info, LucideAngularModule } from 'lucide-angular';
import { ContextRingComponent } from '../../../atoms/context-ring.component';
import { CostBadgeComponent } from '../../../atoms/cost-badge.component';
import { formatCost, formatDuration, formatOptionalTokens, formatTokens } from '../session-stats-format';
import { costBudgetSuffix, costBudgetText, tokensBudgetSuffix } from '../session-budget-format';
import { StatsTileExpansionState } from '../plan-limits/stats-tile-expansion.state';
import { InspectorCacheTileComponent } from './inspector-cache-tile.component';
import {
  AGENTS_DETAILS, agentCountOf, contextDetailsText, costDetailsText, durationMsOf,
  knownSubtotalOf, tokenDetailsText, type SessionStatsInputs,
} from '../session-stats-view';

let nextSessionId = 0;

@Component({
  selector: 'ptah-inspector-session-stats',
  standalone: true,
  imports: [LucideAngularModule, ContextRingComponent, CostBadgeComponent, NgTemplateOutlet, InspectorCacheTileComponent],
  template: `
    @let s = stats();
    <section class="p-4" data-testid="inspector-session-stats" [attr.aria-labelledby]="headingId">
      <div class="mb-2 flex items-center justify-between gap-2" data-glass-surface="plate">
        <h3 [id]="headingId" class="sec-label text-[10.5px] font-semibold uppercase">SESSION</h3>
        @if (s.snapshot?.provisional) { <span class="text-[11px] text-base-content-muted">~ = estimate</span> }
      </div>
      @if (s.limitSummary.state !== 'none') {
        <p class="mb-2 flex items-center gap-1.5 text-[11px]" data-glass-surface="plate"
          [style.color]="s.limitSummary.state === 'at' ? 'var(--state-ink-err)' : 'var(--state-ink-need)'">
          <lucide-angular [img]="AlertTriangleIcon" class="size-3.5 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1">{{ s.limitSummary.fullText }}</span>
          <button type="button" class="h-6 min-w-6 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content"
            (click)="limitsLinkActivated.emit(s.limitSummary.source === 'lane' ? 'lane' : 'session')">
            {{ s.limitSummary.source === 'lane' ? 'Lanes' : 'Plan limits' }}
          </button>
        </p>
      }
      <div class="grid grid-cols-2 gap-2">
        @if (s.cache; as cache) { <ptah-inspector-cache-tile [cache]="cache" /> }
        <div class="relative col-span-2 rounded-md border border-surface-border bg-surface-1 p-2.5" data-glass-surface="tile">
          <div class="flex items-center gap-3"
            [attr.role]="s.context.known ? 'progressbar' : null"
            [attr.aria-valuemin]="s.context.known ? 0 : null" [attr.aria-valuemax]="s.context.known ? 100 : null"
            [attr.aria-valuenow]="s.context.percent === null ? null : clampPercent(s.context.percent)"
            [attr.aria-labelledby]="s.context.known ? contextLabelId : null"
            [attr.aria-valuetext]="s.context.known && s.context.usedTokens !== null ? s.context.label + ' of the context window, ' + formatTokens(s.context.usedTokens) + ' tokens used' : null">
            @if (s.context.percent !== null) { <ptah-context-ring [percent]="s.context.percent" /> }
            <div class="min-w-0 flex-1">
              <div [id]="contextLabelId" class="text-[11px] text-base-content-muted">Context</div>
              <div class="text-lg font-semibold tabular-nums">{{ s.context.label }}</div>
              <div class="text-[11px] text-base-content-muted">
                @if (s.context.usedTokens !== null) { {{ formatTokens(s.context.usedTokens) }} tokens }
                @else { {{ s.context.hasLive ? 'Window unknown' : 'No data yet' }} }
              </div>
            </div>
            @if (s.compactionCount > 0) {
              <span class="mr-7 self-start text-[11px] text-base-content-muted">{{ s.compactionCount }} {{ s.compactionCount === 1 ? 'compaction' : 'compactions' }}</span>
            }
          </div>
          @if (contextDetails(); as details) { <ng-container [ngTemplateOutlet]="detail" [ngTemplateOutletContext]="{ name: 'Context', key: 'sd-context', text: details }" /> }
        </div>
        <div class="relative rounded-md border border-surface-border bg-surface-1 p-2.5" data-glass-surface="tile" [class.col-span-2]="isOpen('sd-tokens')">
          <div class="pr-7 text-[11px] text-base-content-muted">Tokens</div>
          <div class="text-[15px] font-semibold tabular-nums">
            @if (s.snapshot?.provisional) { <span aria-hidden="true">~</span><span class="sr-only">estimated </span> }
            {{ tokenLabel() }}
          </div>
          @if (tokensBudgetSuffix(s.budget); as suffix) { <p class="text-[11px] text-base-content-muted">of {{ suffix.slice(2) }} budget</p> }
          @if (s.budget?.measure === 'tokens' && s.budget?.percent !== null) {
            <div role="progressbar" aria-label="Session token budget" aria-valuemin="0" aria-valuemax="100"
              [attr.aria-valuenow]="clampPercent(s.budget!.percent!)" [attr.aria-valuetext]="floor(s.budget!.percent!) + '% of the ' + formatTokens(s.budget!.limit) + ' token budget'"
              class="mt-1 h-1 rounded-full bg-[var(--surface-border-strong)]">
              <span class="block h-full rounded-full" [style.width.%]="clampPercent(s.budget!.percent!)" [style.background-color]="budgetInk(s.budget!.stage)"></span>
            </div>
          }
          <ng-container [ngTemplateOutlet]="detail" [ngTemplateOutletContext]="{ name: 'Tokens', key: 'sd-tokens', text: tokenDetails() }" />
        </div>
        <div class="relative rounded-md border border-surface-border bg-surface-1 p-2.5" data-glass-surface="tile" [class.col-span-2]="isOpen('sd-cost')">
          <div class="pr-7 text-[11px] text-base-content-muted">Cost</div>
          <div class="flex items-center gap-1 text-[15px] font-semibold tabular-nums">
            @if (s.snapshot?.provisional) { <span aria-hidden="true">~</span><span class="sr-only">estimated </span> }
            @if (costBudgetText(s.budget); as text) { {{ text }} }
            @else { <ptah-cost-badge [cost]="s.snapshot?.totalCost ?? null" /> }
          </div>
          @if (costBudgetSuffix(s.budget); as suffix) { <p class="text-[11px] text-base-content-muted">of {{ suffix.slice(2) }} budget</p> }
          @else if (!costBudgetText(s.budget)) {
            @if (knownSubtotal(); as subtotal) { <p class="text-[11px] text-base-content-muted">known subtotal {{ formatCost(subtotal.value) }}</p> }
          }
          @if (s.budget?.measure === 'cost' && s.budget?.percent !== null) {
            <div role="progressbar" aria-label="Session cost budget" aria-valuemin="0" aria-valuemax="100"
              [attr.aria-valuenow]="clampPercent(s.budget!.percent!)" [attr.aria-valuetext]="floor(s.budget!.percent!) + '% of the ' + costBudgetSuffix(s.budget)!.slice(2) + ' cost budget'"
              class="mt-1 h-1 rounded-full bg-[var(--surface-border-strong)]">
              <span class="block h-full rounded-full" [style.width.%]="clampPercent(s.budget!.percent!)" [style.background-color]="budgetInk(s.budget!.stage)"></span>
            </div>
          }
          @if (costDetails(); as details) { <ng-container [ngTemplateOutlet]="detail" [ngTemplateOutletContext]="{ name: 'Cost', key: 'sd-cost', text: details }" /> }
        </div>
        @if (duration(); as ms) {
          <div class="rounded-md border border-surface-border bg-surface-1 p-2.5" data-glass-surface="tile" [class.col-span-2]="!agents()">
            <div class="text-[11px] text-base-content-muted">Time</div>
            <div class="text-[15px] font-semibold tabular-nums">{{ formatDuration(ms) }}</div>
            @if (turns() !== null) { <p class="text-[11px] text-base-content-muted">{{ turns() }} turns</p> }
          </div>
        }
        @if (agents(); as count) {
          <div class="relative rounded-md border border-surface-border bg-surface-1 p-2.5" data-glass-surface="tile" [class.col-span-2]="isOpen('sd-agents') || !duration()">
            <div class="pr-7 text-[11px] text-base-content-muted">Agents</div>
            <div class="text-[15px] font-semibold tabular-nums">{{ count }}</div>
            <ng-container [ngTemplateOutlet]="detail" [ngTemplateOutletContext]="{ name: 'Agents', key: 'sd-agents', text: agentsDetails }" />
          </div>
        }
        @if (modelNames().length === 1) {
          <div class="col-span-2 rounded-md border border-surface-border bg-surface-1 p-2.5" data-glass-surface="tile">
            <div class="text-[11px] text-base-content-muted">Model</div>
            <div class="text-[15px] font-semibold" [title]="primaryModel()">{{ modelNames()[0] }}</div>
          </div>
        } @else if (modelNames().length >= 2) {
          <button type="button" class="col-span-2 flex items-center gap-2 rounded-md border border-surface-border bg-surface-1 p-2.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content" data-glass-surface="tile"
            [attr.aria-expanded]="isOpen('sd-models')" [attr.aria-controls]="modelsPanelId"
            [title]="isOpen('sd-models') ? 'Hide per-model breakdown' : 'Show per-model breakdown'" (click)="toggle('sd-models')" (keydown.escape)="closeOnEscape($event, 'sd-models')">
            <span class="min-w-0 flex-1"><span class="block text-[11px] text-base-content-muted">Models</span><span class="block truncate text-[15px] font-semibold">{{ modelNames().slice(0, 2).join(', ') }}</span></span>
            <span class="text-[11px] tabular-nums text-base-content-muted">{{ modelNames().length }}</span>
            <lucide-angular [img]="ChevronRightIcon" class="size-3" [class.rotate-90]="isOpen('sd-models')" aria-hidden="true" />
          </button>
          <div [id]="modelsPanelId" class="col-span-2 grid gap-1.5" [hidden]="!isOpen('sd-models')" role="list" aria-label="Per-model usage">
            @if (isOpen('sd-models')) {
              @for (row of s.snapshot?.modelUsageList ?? []; track row.model) {
        <div role="listitem" class="rounded-md border border-surface-border bg-surface-1 p-2.5" data-glass-surface="tile">
                  <div class="flex items-center justify-between gap-2 text-[13px] font-semibold">
                    <span class="min-w-0 truncate" [title]="row.model">{{ formatModelName(row.model) }}</span>
                    <span class="tabular-nums">{{ formatCost(row.costUSD) }}</span>
                  </div>
                  <div class="grid grid-cols-2 gap-1 text-[11px] sm:grid-cols-4">
                    <span title="Uncached input tokens">In {{ formatOptionalTokens(row.inputTokens) }}</span>
                    <span title="Output tokens">Out {{ formatOptionalTokens(row.outputTokens) }}</span>
                    <span title="Cache read tokens">Cache read {{ formatOptionalTokens(row.cacheRead) }}</span>
                    <span title="Cache creation tokens">Cache creation {{ formatOptionalTokens(row.cacheCreation) }}</span>
                  </div>
                </div>
              }
              <div class="flex justify-between border-t border-surface-border pt-2 text-xs font-semibold"><span>Total</span><span>{{ formatCost(s.snapshot?.totalCost ?? null) }}</span></div>
            }
          </div>
        }
      </div>
    </section>
    <ng-template #detail let-name="name" let-key="key" let-text="text">
      <button type="button" class="absolute right-2 top-2 flex size-7 items-center justify-center rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-base-content"
        [attr.aria-label]="name + ' details'" [attr.aria-expanded]="isOpen(key)" [attr.aria-controls]="detailId(key)"
        (click)="toggle(key)" (keydown.escape)="closeOnEscape($event, key)">
        <lucide-angular [img]="InfoIcon" class="size-3.5 text-base-content-muted" aria-hidden="true" />
      </button>
      @if (isOpen(key)) {
        <div [id]="detailId(key)" role="region" [attr.aria-label]="name + ' details'"
          class="mt-2 border-t border-surface-border pt-2 text-[11px] text-base-content-muted whitespace-pre-line">{{ text }}</div>
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
  private readonly expansion = inject(StatsTileExpansionState, { optional: true }) ?? new StatsTileExpansionState();
  private readonly instanceId = ++nextSessionId;
  protected readonly headingId = `ptah-session-h-${this.instanceId}`;
  protected readonly contextLabelId = `ptah-context-l-${this.instanceId}`;
  protected readonly modelsPanelId = `ptah-models-p-${this.instanceId}`;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly InfoIcon = Info;
  protected readonly agentsDetails = AGENTS_DETAILS;
  protected readonly formatCost = formatCost;
  protected readonly formatDuration = formatDuration;
  protected readonly formatOptionalTokens = formatOptionalTokens;
  protected readonly formatTokens = formatTokens;
  protected readonly costBudgetSuffix = costBudgetSuffix;
  protected readonly costBudgetText = costBudgetText;
  protected readonly tokensBudgetSuffix = tokensBudgetSuffix;
  protected readonly floor = Math.floor;
  protected readonly knownSubtotal = computed(() => knownSubtotalOf(this.stats().snapshot));
  protected readonly agents = computed(() => agentCountOf(this.stats().snapshot));
  protected readonly duration = computed(() => durationMsOf(this.stats().snapshot));
  protected readonly tokenLabel = computed(() => {
    const count = this.stats().snapshot?.tokenCount;
    return typeof count === 'number' ? formatTokens(count) : '—';
  });
  protected readonly contextDetails = computed(() => contextDetailsText(this.stats().liveModelStats, this.stats().compactionCount));
  protected readonly tokenDetails = computed(() => tokenDetailsText(this.stats().snapshot, this.stats().budget));
  protected readonly costDetails = computed(() => costDetailsText(this.stats().snapshot, this.stats().budget));
  protected readonly primaryModel = computed(() => this.stats().liveModelStats?.model ?? this.stats().snapshot?.model ?? this.stats().snapshot?.modelUsageList?.[0]?.model ?? null);
  protected readonly modelNames = computed(() => {
    const rows = this.stats().snapshot?.modelUsageList ?? [];
    const primary = this.primaryModel();
    const ids = rows.length ? rows.map(row => row.model) : primary ? [primary] : [];
    return ids.map(id => this.formatModelName(id));
  });
  protected formatModelName(id: string): string { return resolveModelDisplayName(id, this.modelState.availableModels()); }
  protected detailId(key: string): string { return `${key}-${this.instanceId}`; }
  protected isOpen(key: string): boolean { return this.expansion.isOpen(this.expansion.sessionKey(this, this.stats().sessionId), key); }
  protected toggle(key: string): void { this.expansion.toggle(this.expansion.sessionKey(this, this.stats().sessionId), key); }
  protected close(key: string): void { this.expansion.setOpen(this.expansion.sessionKey(this, this.stats().sessionId), key, false); }
  protected closeOnEscape(event: Event, key: string): void {
    if (!this.isOpen(key)) return;
    event.preventDefault();
    event.stopPropagation();
    this.close(key);
  }
  protected clampPercent(percent: number): number { return Math.min(100, Math.max(0, Math.floor(percent))); }
  protected budgetInk(stage: SessionBudgetStage): string {
    return stage === 'limit' ? 'var(--state-ink-err)' : stage === 'tighten' || stage === 'handoff' ? 'var(--state-ink-need)' : 'var(--ptah-gold)';
  }
}
