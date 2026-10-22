import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';

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
      <p class="mt-2 text-xs text-base-content-muted">{{ specs().length }} specs, {{ staleSpecCount() }} stale</p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button type="button" class="btn btn-primary btn-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="skills-specs-harvest" [disabled]="specsLoading()" (click)="onHarvest()">Harvest now</button>
        <button type="button" class="btn btn-outline btn-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          data-testid="skills-specs-clear-stale" [disabled]="specsLoading() || staleSpecCount() === 0"
          (click)="onClearStale()">Clear stale ({{ staleSpecCount() }})</button>
      </div>
    </section>
  `,
})
export class SkillSpecsControlComponent implements OnInit {
  private readonly state = inject(SkillSynthesisStateService);
  protected readonly specs = this.state.specs;
  protected readonly specsLoading = this.state.specsLoading;
  protected readonly staleSpecCount = this.state.staleSpecCount;

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
