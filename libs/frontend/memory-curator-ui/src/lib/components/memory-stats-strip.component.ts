import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  Archive,
  Brain,
  Clock,
  Code,
  Database,
  LucideAngularModule,
} from 'lucide-angular';

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
  imports: [CommonModule, LucideAngularModule],
  template: `
    @let c = counts();
    <div
      class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
      aria-label="Memory tier statistics"
    >
      <div class="stats bg-base-200/40 border border-base-content/10 shadow-sm">
        <div class="stat p-4">
          <div class="stat-figure text-primary">
            <lucide-angular
              [img]="BrainIcon"
              class="w-6 h-6"
              aria-hidden="true"
            />
          </div>
          <div class="stat-title text-base-content/60">Core</div>
          <div
            class="stat-value text-2xl text-primary tabular-nums"
            data-testid="memory-stat-core"
          >
            {{ c.core }}
          </div>
        </div>
      </div>

      <div class="stats bg-base-200/40 border border-base-content/10 shadow-sm">
        <div class="stat p-4">
          <div class="stat-figure text-info">
            <lucide-angular
              [img]="DatabaseIcon"
              class="w-6 h-6"
              aria-hidden="true"
            />
          </div>
          <div class="stat-title text-base-content/60">Recall</div>
          <div
            class="stat-value text-2xl text-info tabular-nums"
            data-testid="memory-stat-recall"
          >
            {{ c.recall }}
          </div>
        </div>
      </div>

      <div class="stats bg-base-200/40 border border-base-content/10 shadow-sm">
        <div class="stat p-4">
          <div class="stat-figure text-base-content/50">
            <lucide-angular
              [img]="ArchiveIcon"
              class="w-6 h-6"
              aria-hidden="true"
            />
          </div>
          <div class="stat-title text-base-content/60">Archival</div>
          <div
            class="stat-value text-2xl text-base-content/70 tabular-nums"
            data-testid="memory-stat-archival"
          >
            {{ c.archival }}
          </div>
        </div>
      </div>

      <div
        class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
        title="Indexed code symbols (functions, classes, methods) — shown separately from curated memory"
      >
        <div class="stat p-4">
          <div class="stat-figure text-secondary">
            <lucide-angular
              [img]="CodeIcon"
              class="w-6 h-6"
              aria-hidden="true"
            />
          </div>
          <div class="stat-title text-base-content/60">Code index</div>
          <div
            class="stat-value text-2xl text-secondary tabular-nums"
            data-testid="memory-stat-code-index"
          >
            {{ c.codeIndex }}
          </div>
        </div>
      </div>

      <div class="stats bg-base-200/40 border border-base-content/10 shadow-sm">
        <div class="stat p-4">
          <div class="stat-figure text-base-content/40">
            <lucide-angular
              [img]="ClockIcon"
              class="w-6 h-6"
              aria-hidden="true"
            />
          </div>
          <div class="stat-title text-base-content/60">Last curated</div>
          <div class="stat-value text-sm font-medium text-base-content/70">
            {{ lastCuratedLabel() }}
          </div>
        </div>
      </div>
    </div>
  `,
})
export class MemoryStatsStripComponent {
  public readonly counts = input.required<MemoryStatCounts>();
  public readonly lastCuratedLabel = input<string>('never');

  protected readonly BrainIcon = Brain;
  protected readonly DatabaseIcon = Database;
  protected readonly ArchiveIcon = Archive;
  protected readonly CodeIcon = Code;
  protected readonly ClockIcon = Clock;
}
