import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';

export interface MemoryStatCounts {
  readonly core: number;
  readonly recall: number;
  readonly archival: number;
  readonly codeIndex: number;
}

@Component({
  selector: 'ptah-memory-stats-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @let c = counts();
    <div
      class="stats stats-horizontal w-full bg-base-100 border border-base-300 rounded-lg overflow-x-auto"
      aria-label="Memory tier statistics"
    >
      <div class="stat px-4 py-2">
        <div class="stat-title text-xs uppercase">Core</div>
        <div class="stat-value text-2xl" data-testid="memory-stat-core">
          {{ c.core }}
        </div>
      </div>
      <div class="stat px-4 py-2">
        <div class="stat-title text-xs uppercase">Recall</div>
        <div class="stat-value text-2xl" data-testid="memory-stat-recall">
          {{ c.recall }}
        </div>
      </div>
      <div class="stat px-4 py-2">
        <div class="stat-title text-xs uppercase">Archival</div>
        <div class="stat-value text-2xl" data-testid="memory-stat-archival">
          {{ c.archival }}
        </div>
      </div>
      <div
        class="stat px-4 py-2"
        title="Indexed code symbols (functions, classes, methods) — shown separately from curated memory"
      >
        <div class="stat-title text-xs uppercase">Code index</div>
        <div class="stat-value text-2xl" data-testid="memory-stat-code-index">
          {{ c.codeIndex }}
        </div>
      </div>
      <div class="stat px-4 py-2">
        <div class="stat-title text-xs uppercase">Last curated</div>
        <div class="stat-value text-sm font-medium">
          {{ lastCuratedLabel() }}
        </div>
      </div>
    </div>
  `,
})
export class MemoryStatsStripComponent {
  public readonly counts = input.required<MemoryStatCounts>();
  public readonly lastCuratedLabel = input<string>('never');
}
