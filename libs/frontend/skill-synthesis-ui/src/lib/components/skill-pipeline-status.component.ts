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
    <section
      class="overflow-hidden rounded-xl border border-base-300 bg-base-200/40"
      data-testid="skills-pipeline-status"
      aria-label="Skill synthesis pipeline status"
    >
      <div class="border-b border-base-300 px-4 py-3">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
          <span class="text-base-content/60">Last analysis:</span>
          <span class="font-medium">{{ lastAnalysisLabel() }}</span>
          @if (reasonChip(); as chip) {
            <span
              class="inline-flex items-center gap-1.5 text-xs text-base-content/70"
              data-testid="skills-pipeline-reason"
            >
              <span
                class="inline-block size-1.5 rounded-full bg-warning"
                aria-hidden="true"
              ></span>
              {{ chip.label }}
            </span>
          }
        </div>
        <p class="mt-1 text-xs text-base-content/60">
          Today:
          <span class="tabular-nums text-base-content/80">{{
            acceptedToday()
          }}</span>
          accepted,
          <span class="tabular-nums text-base-content/80">{{
            ineligibleToday()
          }}</span>
          ineligible
        </p>
      </div>
    </section>
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
  } | null>(() => {
    const events = this.recentEvents();
    if (events.length === 0) return null;
    const latest = events[0];
    if (latest.kind === 'ineligible') {
      return { label: 'ineligible' };
    }
    if (latest.kind === 'rate-limited') {
      return { label: 'rate-limited' };
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
