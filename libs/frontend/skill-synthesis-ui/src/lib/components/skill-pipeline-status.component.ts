import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type {
  EligibilityHistogramDto,
  SkillSynthesisEventWire,
} from '@ptah-extension/shared';

@Component({
  selector: 'ptah-skill-pipeline-status',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-base-300 bg-base-100 px-4 py-2 text-xs text-base-content/70"
      data-testid="skills-pipeline-status"
      aria-label="Skill synthesis pipeline status"
    >
      <span>
        Last analysis:
        <span class="font-medium text-base-content">{{
          lastAnalysisLabel()
        }}</span>
      </span>
      <span aria-hidden="true">&middot;</span>
      <span>
        today:
        <span class="font-medium text-base-content">{{ acceptedToday() }}</span>
        accepted,
        <span class="font-medium text-base-content">{{
          ineligibleToday()
        }}</span>
        ineligible
      </span>
      @if (reasonChip(); as chip) {
        <span
          class="badge badge-sm"
          [class]="chip.badgeClass"
          data-testid="skills-pipeline-reason"
        >
          {{ chip.label }}
        </span>
      }
    </div>
  `,
})
export class SkillPipelineStatusComponent {
  public readonly lastAnalyzeRunAt = input.required<number | null>();
  public readonly histogram = input.required<EligibilityHistogramDto>();
  public readonly recentEvents =
    input.required<readonly SkillSynthesisEventWire[]>();

  protected readonly lastAnalysisLabel = computed<string>(() => {
    const ts = this.lastAnalyzeRunAt();
    if (ts === null) return 'never';
    return this.formatRelative(Date.now() - ts);
  });

  protected readonly acceptedToday = computed<number>(
    () => this.histogram().accepted,
  );

  protected readonly ineligibleToday = computed<number>(() => {
    const h = this.histogram();
    return h.tooFewTurns + h.lowFidelity + h.insufficientAbstraction;
  });

  protected readonly reasonChip = computed<{
    readonly label: string;
    readonly badgeClass: string;
  } | null>(() => {
    const events = this.recentEvents();
    if (events.length === 0) return null;
    const latest = events[0];
    if (latest.kind === 'ineligible') {
      return { label: 'ineligible', badgeClass: 'badge-warning' };
    }
    if (latest.kind === 'rate-limited') {
      return { label: 'rate-limited', badgeClass: 'badge-warning' };
    }
    return null;
  });

  private formatRelative(diffMs: number): string {
    if (!Number.isFinite(diffMs) || diffMs < 0) return 'never';
    const sec = Math.floor(diffMs / 1000);
    if (sec < 60) return sec + 's ago';
    const min = Math.floor(sec / 60);
    if (min < 60) return min + 'm ago';
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    const days = Math.floor(hr / 24);
    return days + 'd ago';
  }
}
