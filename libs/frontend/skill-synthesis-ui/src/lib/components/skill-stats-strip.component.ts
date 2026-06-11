import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  LucideAngularModule,
  FlaskConical,
  CircleCheck,
  CircleX,
  Sparkles,
  Play,
} from 'lucide-angular';
import type { SkillSynthesisStatsResult } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-skill-stats-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    @if (stats(); as s) {
      <div
        class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
        aria-label="Skill synthesis statistics"
      >
        <div
          class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
        >
          <div class="stat p-4">
            <div class="stat-figure text-info">
              <lucide-angular
                [img]="FlaskConicalIcon"
                class="w-6 h-6"
                aria-hidden="true"
              />
            </div>
            <div class="stat-title text-base-content/60">Candidates</div>
            <div
              class="stat-value text-2xl text-info"
              data-testid="skills-stat-candidates"
            >
              {{ s.totalCandidates }}
            </div>
          </div>
        </div>

        <div
          class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
        >
          <div class="stat p-4">
            <div class="stat-figure text-success">
              <lucide-angular
                [img]="CircleCheckIcon"
                class="w-6 h-6"
                aria-hidden="true"
              />
            </div>
            <div class="stat-title text-base-content/60">Promoted</div>
            <div
              class="stat-value text-2xl text-success"
              data-testid="skills-stat-promoted"
            >
              {{ s.totalPromoted }}
            </div>
          </div>
        </div>

        <div
          class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
        >
          <div class="stat p-4">
            <div class="stat-figure text-error">
              <lucide-angular
                [img]="CircleXIcon"
                class="w-6 h-6"
                aria-hidden="true"
              />
            </div>
            <div class="stat-title text-base-content/60">Rejected</div>
            <div class="stat-value text-2xl text-error">
              {{ s.totalRejected }}
            </div>
          </div>
        </div>

        <div
          class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
        >
          <div class="stat p-4">
            <div class="stat-figure text-secondary">
              <lucide-angular
                [img]="SparklesIcon"
                class="w-6 h-6"
                aria-hidden="true"
              />
            </div>
            <div class="stat-title text-base-content/60">Active skills</div>
            <div class="stat-value text-2xl text-secondary">
              {{ s.activeSkills }}
            </div>
          </div>
        </div>

        <div
          class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
        >
          <div class="stat p-4">
            <div class="stat-figure text-primary">
              <lucide-angular
                [img]="PlayIcon"
                class="w-6 h-6"
                aria-hidden="true"
              />
            </div>
            <div class="stat-title text-base-content/60">Invocations</div>
            <div class="stat-value text-2xl text-primary">
              {{ s.totalInvocations }}
            </div>
          </div>
        </div>
      </div>
    } @else {
      <div
        class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5"
        aria-label="Skill synthesis statistics"
        aria-busy="true"
      >
        @for (i of skeletonSlots; track i) {
          <div
            class="stats bg-base-200/40 border border-base-content/10 shadow-sm"
          >
            <div class="stat gap-2 p-4">
              <div class="skeleton h-4 w-20"></div>
              <div class="skeleton h-7 w-12"></div>
            </div>
          </div>
        }
      </div>
    }
  `,
})
export class SkillStatsStripComponent {
  public readonly stats = input.required<SkillSynthesisStatsResult | null>();

  protected readonly FlaskConicalIcon = FlaskConical;
  protected readonly CircleCheckIcon = CircleCheck;
  protected readonly CircleXIcon = CircleX;
  protected readonly SparklesIcon = Sparkles;
  protected readonly PlayIcon = Play;

  protected readonly skeletonSlots = [0, 1, 2, 3, 4];
}
