import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { SkillSynthesisStatsResult } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-skill-stats-strip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (stats(); as s) {
      <div
        class="stats stats-horizontal w-full bg-base-100 border border-base-300 rounded-lg overflow-x-auto"
        aria-label="Skill synthesis statistics"
      >
        <div class="stat px-4 py-2">
          <div class="stat-title text-xs uppercase">Candidates</div>
          <div class="stat-value text-2xl" data-testid="skills-stat-candidates">
            {{ s.totalCandidates }}
          </div>
        </div>
        <div class="stat px-4 py-2">
          <div class="stat-title text-xs uppercase">Promoted</div>
          <div class="stat-value text-2xl" data-testid="skills-stat-promoted">
            {{ s.totalPromoted }}
          </div>
        </div>
        <div class="stat px-4 py-2">
          <div class="stat-title text-xs uppercase">Rejected</div>
          <div class="stat-value text-2xl">{{ s.totalRejected }}</div>
        </div>
        <div class="stat px-4 py-2">
          <div class="stat-title text-xs uppercase">Active skills</div>
          <div class="stat-value text-2xl">{{ s.activeSkills }}</div>
        </div>
        <div class="stat px-4 py-2">
          <div class="stat-title text-xs uppercase">Invocations</div>
          <div class="stat-value text-2xl">{{ s.totalInvocations }}</div>
        </div>
      </div>
    } @else {
      <div
        class="stats stats-horizontal w-full bg-base-100 border border-base-300 rounded-lg"
        aria-label="Skill synthesis statistics"
      >
        <div class="stat px-4 py-2">
          <div class="stat-title text-xs uppercase">Stats</div>
          <div class="stat-value text-sm font-medium text-base-content/60">
            Loading&hellip;
          </div>
        </div>
      </div>
    }
  `,
})
export class SkillStatsStripComponent {
  public readonly stats = input.required<SkillSynthesisStatsResult | null>();
}
