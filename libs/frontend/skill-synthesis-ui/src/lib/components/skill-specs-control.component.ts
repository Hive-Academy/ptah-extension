import {
  ChangeDetectionStrategy,
  Component,
  LOCALE_ID,
  OnInit,
  computed,
  inject,
} from '@angular/core';
import { formatDate } from '@angular/common';

import { SkillSynthesisStateService } from '../services/skill-synthesis-state.service';

@Component({
  selector: 'ptah-skill-specs-control',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="surface-2 rounded-xl p-4" aria-labelledby="skills-specs-heading" data-testid="skills-specs-control">
      <h3 id="skills-specs-heading" class="text-sm font-semibold">Orchestration specs</h3>
      <p class="mt-1 text-xs text-base-content-muted">
        Harvest reads review verdicts from <code>.ptah/specs</code> into skill success rates.
        Clear stale archives harvested specs older than the retention period.
      </p>
      <p class="mt-2 text-xs text-base-content-muted" data-testid="skills-specs-counts">
        {{ specs().length }} specs, {{ staleSpecCount() }} stale, {{ pendingCount() }} waiting to harvest
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary btn-xs gap-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="skills-specs-harvest" [disabled]="specsLoading()" [attr.aria-busy]="harvesting()"
          (click)="onHarvest()">
          @if (harvesting()) {
            <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            Harvesting…
          } @else {
            Harvest now
          }
        </button>
        <button type="button" class="btn btn-outline btn-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="skills-specs-clear-stale" [disabled]="specsLoading() || staleSpecCount() === 0"
          (click)="onClearStale()">Clear stale ({{ staleSpecCount() }})</button>
      </div>
      @if (harvestError(); as message) {
        <p class="mt-2 text-xs text-error" role="alert" data-testid="skills-harvest-error">{{ message }}</p>
      }
      @if (harvestSummary(); as summary) {
        <p class="mt-2 text-xs text-base-content-muted" role="status" data-testid="skills-harvest-result">{{ summary }}</p>
      }
      <details class="mt-3 text-xs">
        <summary class="cursor-pointer font-medium">How this works</summary>
        <p class="mt-1 text-base-content-muted" data-testid="skills-harvest-how-it-works">
          When a task in .ptah/specs is marked done or cancelled, harvest records the skill and agent
          runs of that task as succeeded (done, with an approving final review) or failed (cancelled,
          or a rejecting final review), and adds review grades to skill success rates. It runs
          automatically about 90 seconds after a chat turn ends; Harvest now runs it immediately.
          Tasks still in progress, and folders without a task.md, are not harvested.
        </p>
      </details>
    </section>
  `,
})
export class SkillSpecsControlComponent implements OnInit {
  private readonly state = inject(SkillSynthesisStateService);
  private readonly locale = inject(LOCALE_ID);
  protected readonly specs = this.state.specs;
  protected readonly specsLoading = this.state.specsLoading;
  protected readonly staleSpecCount = this.state.staleSpecCount;
  protected readonly harvesting = this.state.harvesting;
  protected readonly harvestError = this.state.harvestError;

  /** Finished specs the harvester has not recorded yet. */
  protected readonly pendingCount = computed(
    () => this.specs().filter((spec) => spec.status === 'complete-unharvested').length,
  );

  /** Result line of the last successful harvest (or `null`). */
  protected readonly harvestSummary = computed<string | null>(() => {
    const run = this.state.lastHarvest();
    if (!run) return null;
    const time = formatDate(run.at, 'shortTime', this.locale);
    const scanned = plural(run.scanned, 'task', 'tasks');
    const reconciled = plural(run.reconciled, 'skill run', 'skill runs');
    const body = run.harvested === 0
      ? `Nothing new to harvest (${scanned} scanned, ${reconciled} reconciled)`
      : `${scanned} scanned, ${run.harvested} harvested, ${reconciled} reconciled`;
    const skipped = run.skippedFolders
      ? `. ${plural(run.skippedFolders, 'folder', 'folders')} skipped (no task.md)`
      : '';
    return `Last run ${time}: ${body}${skipped}`;
  });

  ngOnInit(): void {
    void this.state.refreshSpecs();
  }

  protected onHarvest(): void {
    void this.state.harvestSpecs();
  }

  protected onClearStale(): void {
    void this.state.clearStaleSpecs({ mode: 'archive' });
  }
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
