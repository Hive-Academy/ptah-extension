import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { Bot, LucideAngularModule } from 'lucide-angular';
import type { AgentCategory, AgentRecommendation } from '@ptah-extension/shared';

const CATEGORIES = [
  { key: 'planning', label: 'Planning & Architecture' },
  { key: 'development', label: 'Development' },
  { key: 'qa', label: 'Quality Assurance' },
  { key: 'specialist', label: 'Specialists' },
  { key: 'creative', label: 'Creative' },
  { key: 'other', label: 'Other' },
] as const;

type GroupKey = (typeof CATEGORIES)[number]['key'];

const KNOWN_CATEGORIES = new Set<string>([
  'planning',
  'development',
  'qa',
  'specialist',
  'creative',
]);

/** Match % is shown only when the score is a finite 0..100 value (backend range). */
export function matchPercent(score: number): number | null {
  if (!Number.isFinite(score) || score < 0 || score > 100) return null;
  return Math.round(score);
}

function groupKey(category: AgentCategory | string): GroupKey {
  return KNOWN_CATEGORIES.has(category) ? (category as GroupKey) : 'other';
}

/** Host rows may omit `matchedCriteria`. Missing or non-array values render as none. */
export function criteriaOf(agent: AgentRecommendation): readonly string[] {
  const value: unknown = agent.matchedCriteria;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Presentational A2 grouped agent list: match %, criteria chips, and a
 * select-recommended / clear / n-selected toolbar. The page owns selection
 * and store wiring.
 */
@Component({
  selector: 'ptah-agent-recommendation-list',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <section
      class="space-y-3"
      aria-labelledby="agent-recommendation-title"
      data-testid="agent-recommendation-list"
    >
      <div
        class="flex flex-wrap items-center gap-2"
        data-testid="agent-recommendation-toolbar"
      >
        <h2 id="agent-recommendation-title" class="sr-only">Select agents</h2>
        <button
          type="button"
          class="btn btn-outline btn-sm min-h-8"
          data-testid="agent-recommendation-select-recommended"
          [disabled]="disabled()"
          (click)="selectRecommended.emit()"
        >
          Select recommended
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm min-h-8"
          data-testid="agent-recommendation-clear"
          [disabled]="disabled()"
          (click)="clearSelection.emit()"
        >
          Clear
        </button>
        <span
          class="text-sm text-base-content-muted"
          data-testid="agent-recommendation-count"
        >
          {{ selectedCount() }} selected
        </span>
      </div>
      @for (group of groups(); track group.key) {
        <section class="space-y-2" [attr.aria-label]="group.label">
          <h3 class="text-sm font-semibold">{{ group.label }}</h3>
          @for (row of group.agents; track row.agent.agentId) {
            <div
              class="flex min-h-8 flex-wrap items-start gap-2 rounded-[10px] border border-base-300 p-3.5"
              data-glass-surface="tile"
              data-testid="agent-recommendation-row"
              [attr.data-agent-id]="row.agent.agentId"
              [class.border-primary]="isSelected(row.agent.agentId)"
              [class.cursor-not-allowed]="disabled()"
            >
              <label class="flex min-w-0 flex-1 cursor-pointer items-start gap-2" [class.cursor-not-allowed]="disabled()">
                <input
                  type="checkbox"
                  class="checkbox checkbox-sm mt-0.5"
                  [checked]="isSelected(row.agent.agentId)"
                  [disabled]="disabled()"
                  [attr.aria-label]="'Select ' + row.agent.agentName"
                  (change)="toggled.emit(row.agent.agentId)"
                />
                <lucide-angular
                  [img]="icons.bot"
                  class="mt-0.5 size-[1.05rem] shrink-0 text-base-content-muted"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1">
                <span class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span class="font-medium" data-testid="agent-recommendation-name">{{ row.agent.agentName }}</span>
                  @if (row.match !== null) {
                    <span
                      class="text-xs font-medium text-base-content-muted"
                      data-testid="agent-recommendation-match"
                      [attr.aria-label]="row.match + '% match'"
                      >{{ row.match }}% match</span
                    >
                  }
                </span>
                @if (row.match !== null) {
                  <span
                    class="mt-1 block h-1 w-full max-w-xs overflow-hidden rounded-full bg-base-300"
                    aria-hidden="true"
                    data-testid="agent-recommendation-meter"
                  >
                    <span
                      class="block h-full bg-primary"
                      [style.width.%]="row.match"
                    ></span>
                  </span>
                }
                @if (row.agent.description) {
                  <span class="mt-1 block text-xs text-base-content-muted" data-testid="agent-recommendation-description">{{
                    row.agent.description
                  }}</span>
                }
                @if (row.criteria.length) {
                  <span
                    class="mt-2 flex flex-wrap gap-1"
                    data-testid="agent-recommendation-criteria"
                  >
                    @for (criterion of row.criteria; track criterion) {
                      <span
                        class="rounded-full border border-base-300 px-2 py-0.5 text-xs"
                        data-glass-surface="tile"
                        >{{ criterion }}</span
                      >
                    }
                  </span>
                }
                </span>
              </label>
              <button type="button" class="btn btn-outline btn-sm min-h-8" data-testid="agent-recommendation-preview" [disabled]="disabled()"
                [attr.aria-label]="'Preview ' + row.agent.agentName" (click)="previewRequested.emit(row.agent.agentId)">Preview</button>
            </div>
          }
        </section>
      }
    </section>
  `,
})
export class AgentRecommendationListComponent {
  readonly recommendations = input.required<readonly AgentRecommendation[]>();
  readonly selection = input<ReadonlySet<string>>(new Set());
  readonly disabled = input(false);

  /** Named `toggled` because `toggle` is a native DOM event. */
  readonly toggled = output<string>();
  readonly previewRequested = output<string>();
  readonly selectRecommended = output<void>();
  /** Named `clearSelection` because `clear` is a native DOM event. */
  readonly clearSelection = output<void>();

  protected readonly icons = { bot: Bot } as const;

  protected readonly groups = computed(() => {
    const recs = this.recommendations();
    return CATEGORIES.map((category) => ({
      ...category,
      agents: recs
        .filter((agent) => groupKey(agent.category) === category.key)
        .map((agent) => ({
          agent,
          match: matchPercent(agent.relevanceScore),
          criteria: criteriaOf(agent),
        })),
    })).filter((group) => group.agents.length > 0);
  });

  protected readonly selectedCount = computed(() => {
    const selected = this.selection();
    let count = 0;
    for (const agent of this.recommendations()) {
      if (selected.has(agent.agentId)) count += 1;
    }
    return count;
  });

  protected isSelected(id: string): boolean {
    return this.selection().has(id);
  }
}
