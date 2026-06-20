import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
} from '@angular/core';
import { TribunalStateService } from '../services/tribunal-state.service';
import type { RaceScore } from '../types/tribunal-ui.types';

@Component({
  selector: 'ptah-scorecard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div
      class="flex h-full flex-col overflow-auto p-3"
      data-testid="tribunal-scorecard"
      aria-label="Tribunal race scorecard"
    >
      @if (scores().length > 0) {
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr class="border-b border-base-300 text-base-content/55">
              <th class="px-2 py-1.5 text-left font-semibold">Vendor</th>
              @for (col of criteriaColumns(); track col) {
                <th class="px-2 py-1.5 text-left font-semibold">{{ col }}</th>
              }
              <th class="px-2 py-1.5 text-left font-semibold">Verify</th>
              <th class="px-2 py-1.5 text-left font-semibold">Rank</th>
            </tr>
          </thead>
          <tbody>
            @for (row of scores(); track row.vendor) {
              <tr class="border-b border-base-200">
                <td class="px-2 py-1.5 font-medium text-base-content/80">
                  {{ row.vendor }}
                </td>
                @for (col of criteriaColumns(); track col) {
                  <td class="px-2 py-1.5 text-base-content/65">
                    {{ valueFor(row, col) }}
                  </td>
                }
                <td class="px-2 py-1.5">
                  @if (row.verifyPassed === true) {
                    <span class="inline-flex items-center gap-1 text-success">
                      <span class="h-1.5 w-1.5 rounded-full bg-success"></span>
                      Pass
                    </span>
                  } @else if (row.verifyPassed === false) {
                    <span class="inline-flex items-center gap-1 text-error">
                      <span class="h-1.5 w-1.5 rounded-full bg-error"></span>
                      Fail
                    </span>
                  } @else {
                    <span class="text-base-content/40">—</span>
                  }
                </td>
                <td class="px-2 py-1.5 tabular-nums text-base-content/80">
                  {{ row.rank ?? '—' }}
                </td>
              </tr>
            }
          </tbody>
        </table>
      } @else {
        <div
          class="flex h-full flex-col items-center justify-center gap-2 text-center text-base-content/50"
        >
          <span class="loading loading-dots loading-sm"></span>
          <p class="text-xs">Awaiting the race results…</p>
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class ScorecardComponent {
  private readonly state = inject(TribunalStateService);

  protected readonly scores = this.state.raceScores;

  protected readonly criteriaColumns = computed<readonly string[]>(() => {
    const seen = new Set<string>();
    for (const score of this.scores()) {
      for (const criterion of score.criteria) {
        seen.add(criterion.label);
      }
    }
    return Array.from(seen);
  });

  protected valueFor(row: RaceScore, label: string): string {
    return row.criteria.find((c) => c.label === label)?.value ?? '—';
  }
}
