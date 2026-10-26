import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { OutcomeFileRow } from './outcome-summary.component';

/** Outcomes that leave the user's existing file and grade as they were. */
const LEFT_AS_IS = new Set<OutcomeFileRow['status']>([
  'kept',
  'unchanged',
  'changed-since-preview',
]);

/**
 * C11 GradeExpectation (design-spec 3.9): what the Library grade will show
 * after this run. At least one agent written: the "About grades" callout.
 * Every agent kept or already current: "Nothing new was written". The parent
 * renders it only in Electron for the harness-root target.
 */
@Component({
  selector: 'ptah-grade-expectation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (state()) {
      @case ('written') {
        <div
          class="alert alert-info mt-3 block text-xs"
          role="status"
          data-testid="grade-expectation"
        >
          <strong>About grades.</strong> New agents show "No grade" in the
          Library. A grade appears after a task that uses the agent has been
          reviewed. Generating the file alone does not produce one.
        </div>
      }
      @case ('all-kept') {
        <div class="mt-3" data-testid="grade-all-kept">
          <h3 class="text-sm font-semibold">Nothing new was written</h3>
          <p class="mt-1 text-xs">
            All {{ rows().length }} agents were kept or already current. No new
            agents were added. Existing grades are unchanged.
          </p>
        </div>
      }
    }
  `,
})
export class GradeExpectationComponent {
  public readonly rows = input.required<readonly OutcomeFileRow[]>();

  protected readonly state = computed<'written' | 'all-kept' | null>(() => {
    const rows = this.rows();
    if (rows.some((row) => row.status === 'written')) return 'written';
    if (rows.length > 0 && rows.every((row) => LEFT_AS_IS.has(row.status))) {
      return 'all-kept';
    }
    return null;
  });
}
