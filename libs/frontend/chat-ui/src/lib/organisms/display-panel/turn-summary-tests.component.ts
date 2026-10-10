import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  CircleCheck,
  CircleHelp,
  CircleX,
  LoaderCircle,
  LucideAngularModule,
} from 'lucide-angular';
import type {
  TurnSummaryTestTone,
  TurnSummaryTestsCard,
} from '../../molecules/turn-recap/turn-summary.model';

/** The tests row's outcome colours (`TTR:39-44`), keyed by the model's tone. */
const TONE_CLASS: Readonly<Record<TurnSummaryTestTone, string>> = {
  success: 'diff-add-text',
  error: 'diff-del-text',
  info: 'text-info',
  muted: 'text-base-content-muted',
};

/**
 * TurnSummaryTestsComponent - the expanded Tests card of the panel's turn
 * summary (TASK_2026_623, component 5; R6.1, R6.3; parity-inventory section 1,
 * the tests row's capabilities).
 *
 * A progress bar of the passed share with a text percentage, then one row per
 * run: the outcome icon with an accessible name, the run label (Nx project or
 * outcome word, full command in `title`), an "Outcome · project" line, up to
 * five failure lines and a native `<details>` "Full command". Outcome is text,
 * never colour alone; colour rides along through the AA-measured overrides.
 */
@Component({
  selector: 'ptah-turn-summary-tests',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
        min-width: 0;
      }
      .ts-wrap {
        overflow-wrap: anywhere;
      }
    `,
  ],
  template: `
    @let tests = card();
      <div class="mb-2 flex min-w-0 items-center gap-2">
        <progress
          class="progress progress-success h-1.5 min-w-0 flex-1"
          [value]="tests.summary.passed"
          [max]="tests.summary.total"
          [attr.aria-label]="passedShareLabel()"
          data-testid="turn-summary-tests-progress"
        ></progress>
        <span class="shrink-0 tabular-nums text-base-content-muted"
          >{{ passedPercent() }}%</span
        >
      </div>
      <ul class="flex min-w-0 flex-col" role="list">
        @for (run of tests.runs; track $index) {
          <li
            class="flex min-w-0 flex-col gap-1 border-b border-base-content/10 py-1.5 last:border-b-0"
            data-testid="turn-summary-test-run"
          >
            <div class="flex min-w-0 items-start gap-1.5">
              @switch (run.outcome) {
                @case ('passed') {
                  <lucide-angular
                    [img]="PassedIcon"
                    [class]="'mt-0.5 h-3.5 w-3.5 shrink-0 ' + TONE_CLASS[run.tone]"
                    role="img"
                    [attr.aria-label]="run.outcomeName"
                  />
                }
                @case ('failed') {
                  <lucide-angular
                    [img]="FailedIcon"
                    [class]="'mt-0.5 h-3.5 w-3.5 shrink-0 ' + TONE_CLASS[run.tone]"
                    role="img"
                    [attr.aria-label]="run.outcomeName"
                  />
                }
                @case ('running') {
                  <lucide-angular
                    [img]="RunningIcon"
                    [class]="'mt-0.5 h-3.5 w-3.5 shrink-0 ' + TONE_CLASS[run.tone]"
                    role="img"
                    [attr.aria-label]="run.outcomeName"
                  />
                }
                @default {
                  <lucide-angular
                    [img]="UnknownIcon"
                    [class]="'mt-0.5 h-3.5 w-3.5 shrink-0 ' + TONE_CLASS[run.tone]"
                    role="img"
                    [attr.aria-label]="run.outcomeName"
                  />
                }
              }
              <span class="flex min-w-0 flex-1 flex-col">
                <span
                  class="ts-wrap font-mono font-semibold"
                  [title]="run.command"
                  data-testid="turn-summary-test-label"
                  >{{ run.label }}</span
                >
                <span
                  [class]="'ts-wrap ' + TONE_CLASS[run.tone]"
                  data-testid="turn-summary-test-outcome"
                  >{{ outcomeEyebrow(run.outcomeName, run.project) }}</span
                >
              </span>
            </div>
            @if (run.failures.length > 0) {
              <ul class="flex min-w-0 flex-col gap-0.5 pl-5" role="list">
                @for (failure of run.failures; track $index) {
                  <li
                    class="ts-wrap flex items-start gap-1 font-mono text-[11px] diff-del-text"
                    data-testid="turn-summary-test-failure"
                  >
                    <lucide-angular
                      [img]="FailedIcon"
                      class="mt-0.5 h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                    {{ failure }}
                  </li>
                }
              </ul>
            }
            <details class="pl-5" data-testid="turn-summary-test-command">
              <summary class="cursor-pointer text-base-content-muted">
                Full command
              </summary>
              <code
                class="ts-wrap mt-1 block whitespace-pre-wrap font-mono text-[11px]"
                >{{ run.command }}</code
              >
            </details>
          </li>
        }
      </ul>
  `,
})
export class TurnSummaryTestsComponent {
  /** The model's Tests card: counts, label, polarity and runs. */
  readonly card = input.required<TurnSummaryTestsCard>();

  protected readonly TONE_CLASS = TONE_CLASS;
  protected readonly PassedIcon = CircleCheck;
  protected readonly FailedIcon = CircleX;
  protected readonly RunningIcon = LoaderCircle;
  protected readonly UnknownIcon = CircleHelp;

  protected readonly passedPercent = computed(() => {
    const { passed, total } = this.card().summary;
    return total === 0 ? 0 : Math.round((passed / total) * 100);
  });

  protected readonly passedShareLabel = computed(() => {
    const { passed, total } = this.card().summary;
    return `${passed} of ${total} ${total === 1 ? 'test' : 'tests'} passed`;
  });

  /** "Failed · shared", or just the outcome when the run has no project. */
  protected outcomeEyebrow(outcomeName: string, project?: string): string {
    const word = outcomeName.charAt(0).toUpperCase() + outcomeName.slice(1);
    return project === undefined ? word : `${word} · ${project}`;
  }
}
