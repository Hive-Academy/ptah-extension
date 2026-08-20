import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';
import { LucideAngularModule, Info } from 'lucide-angular';

/**
 * Crucible's starting rubric, taken from `references/crucible.md:61-71`.
 *
 * A PREFILL, not a default the user cannot see: the rubric is the bar the judge
 * grades against, so shipping an invisible one would mean the loop terminates
 * on criteria nobody read. Editing it is the point of this step.
 */
export const DEFAULT_CRUCIBLE_RUBRIC = [
  '| #   | Criterion           | Pass condition                                                 | Checked by                        |',
  '| --- | ------------------- | -------------------------------------------------------------- | --------------------------------- |',
  '| 1   | Acceptance criteria | Every AC in the objective demonstrably satisfied               | Judge reads the diff              |',
  '| 2   | Type safety         | No `any`, `catch (error: unknown)` everywhere, no `@ts-ignore` | Judge + `typecheck`               |',
  '| 3   | Boundary validation | Zod schema on every new external boundary                      | Judge reads the diff              |',
  '| 4   | Test coverage       | New behaviour has a failing-before/passing-after test          | Conductor runs tests              |',
  '| 5   | Scope discipline    | No files touched outside the stated scope                      | Conductor reads `git diff --stat` |',
].join('\n');

/** The cap on the cap. `crucible.md` permits a 3rd round only on explicit user request, mid-run. */
export const MAX_CRUCIBLE_ROUND_CAP = 2;
export const MIN_CRUCIBLE_ROUND_CAP = 1;

@Component({
  selector: 'ptah-step-crucible-rubric',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LucideAngularModule],
  template: `
    <div
      class="flex flex-col gap-4"
      data-testid="tribunal-step-crucible-rubric"
    >
      <header class="flex flex-col gap-1">
        <h3 class="text-base font-semibold text-base-content">Set the bar</h3>
        <p class="text-sm text-base-content-muted">
          The judge grades every round against this rubric, and it is frozen
          after round 1. Keep it to 3–7 criteria, each with a condition that is
          either met or not.
        </p>
      </header>

      <label class="flex flex-col gap-1">
        <span
          class="text-[10px] uppercase tracking-wide text-base-content-muted"
          >Rubric</span
        >
        <textarea
          class="textarea textarea-bordered min-h-[11rem] w-full font-mono text-xs"
          aria-label="Crucible rubric"
          data-testid="tribunal-rubric-input"
          [value]="rubric()"
          (input)="onRubricInput($event)"
        ></textarea>
      </label>

      <label class="flex flex-col gap-1">
        <span
          class="text-[10px] uppercase tracking-wide text-base-content-muted"
          >Revise rounds</span
        >
        <input
          type="number"
          class="input input-bordered input-xs w-24 tabular-nums"
          aria-label="Revise round cap"
          data-testid="tribunal-round-cap-input"
          [min]="minRoundCap"
          [max]="maxRoundCap"
          [value]="roundCap()"
          (input)="onRoundCapInput($event)"
        />
        <span class="text-[11px] text-base-content-muted">
          After the first pass, the executor gets at most {{ roundCap() }}
          revise round(s). The loop stops at the cap and reports whatever
          defects are still open.
        </span>
      </label>

      <div
        class="flex items-start gap-2 rounded-lg border border-info/20 bg-info/5 px-3 py-2 text-xs text-base-content-muted"
      >
        <lucide-angular
          [img]="InfoIcon"
          class="mt-0.5 h-3.5 w-3.5 shrink-0 text-info"
          aria-hidden="true"
        />
        <span>
          A judge's PASS is an opinion, not proof — the conductor still verifies
          against the build before anything is called done.
        </span>
      </div>

      @if (isEmpty()) {
        <p class="text-xs text-error" role="alert">
          The rubric cannot be empty — the judge would have nothing to grade
          against.
        </p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class StepCrucibleRubricComponent {
  readonly rubric = input<string>(DEFAULT_CRUCIBLE_RUBRIC);
  readonly roundCap = input<number>(MAX_CRUCIBLE_ROUND_CAP);

  readonly rubricChanged = output<string>();
  readonly roundCapChanged = output<number>();

  protected readonly InfoIcon = Info;
  protected readonly minRoundCap = MIN_CRUCIBLE_ROUND_CAP;
  protected readonly maxRoundCap = MAX_CRUCIBLE_ROUND_CAP;

  protected readonly isEmpty = computed(
    () => this.rubric().trim().length === 0,
  );

  protected onRubricInput(event: Event): void {
    this.rubricChanged.emit((event.target as HTMLTextAreaElement).value);
  }

  /**
   * Clamp on the way OUT, not on the way in.
   *
   * A `max` attribute is advisory — a user can type 9 into a number input, and
   * a typed 9 that silently launched a 9-round loop is real money. Clamping
   * here means the value the wizard holds is always one the move permits.
   */
  protected onRoundCapInput(event: Event): void {
    const raw = Number.parseInt((event.target as HTMLInputElement).value, 10);
    if (Number.isNaN(raw)) return;
    this.roundCapChanged.emit(
      Math.min(Math.max(MIN_CRUCIBLE_ROUND_CAP, raw), MAX_CRUCIBLE_ROUND_CAP),
    );
  }
}
