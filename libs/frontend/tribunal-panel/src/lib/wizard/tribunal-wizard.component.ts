import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, ChevronLeft, ChevronRight } from 'lucide-angular';
import { StepPickMoveComponent } from './step-pick-move.component';
import { StepPanelPreviewComponent } from './step-panel-preview.component';
import { StepRoleRosterComponent } from './step-role-roster.component';
import {
  StepCrucibleRubricComponent,
  DEFAULT_CRUCIBLE_RUBRIC,
  MAX_CRUCIBLE_ROUND_CAP,
} from './step-crucible-rubric.component';
import { StepRunComponent } from './step-run.component';
import { rosterIsLaunchable } from '../services/tribunal-roster-rules';
import {
  rolesForMove,
  type TribunalMove,
  type VendorLane,
} from '../types/tribunal-ui.types';

/**
 * What a step EDITS, not where it sits. The index is positional and changes per
 * move; the kind is what the template switches on, so adding Crucible's rubric
 * step could not silently shift another move's Run step under a `@case (2)`.
 */
type WizardStepKind = 'move' | 'flat-lanes' | 'roster' | 'rubric' | 'run';

interface WizardStep {
  readonly index: number;
  readonly label: string;
  readonly kind: WizardStepKind;
}

const STEP_LABEL: Record<WizardStepKind, string> = {
  move: 'Move',
  'flat-lanes': 'Panel',
  roster: 'Roster',
  rubric: 'Rubric',
  run: 'Run',
};

@Component({
  selector: 'ptah-tribunal-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    StepPickMoveComponent,
    StepPanelPreviewComponent,
    StepRoleRosterComponent,
    StepCrucibleRubricComponent,
    StepRunComponent,
  ],
  template: `
    <div
      class="mx-auto flex h-full w-full max-w-2xl flex-col gap-6 p-6"
      data-testid="tribunal-wizard"
    >
      <nav
        class="flex items-center gap-2"
        aria-label="Tribunal wizard progress"
      >
        @for (step of steps(); track step.kind) {
          <div class="flex flex-1 items-center gap-2">
            <span
              class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
              [class.bg-primary]="stepIndex() >= step.index"
              [class.text-primary-content]="stepIndex() >= step.index"
              [class.bg-base-300]="stepIndex() < step.index"
              [class.text-base-content]="stepIndex() < step.index"
            >
              {{ step.index + 1 }}
            </span>
            <span
              class="hidden text-xs sm:inline"
              [class.text-base-content]="stepIndex() >= step.index"
              [class.text-base-content-muted]="stepIndex() < step.index"
            >
              {{ step.label }}
            </span>
            @if (step.index < steps().length - 1) {
              <span class="h-px flex-1 bg-base-300"></span>
            }
          </div>
        }
      </nav>

      <div class="flex-1 overflow-auto">
        @switch (currentStep().kind) {
          @case ('move') {
            <ptah-step-pick-move
              [selected]="move()"
              (moveSelected)="onMove($event)"
            />
          }
          @case ('flat-lanes') {
            <ptah-step-panel-preview
              [selectedLanes]="lanes()"
              [move]="move()"
              (lanesChanged)="onLanes($event)"
            />
          }
          @case ('roster') {
            <ptah-step-role-roster
              [selectedLanes]="lanes()"
              [move]="move()"
              (lanesChanged)="onLanes($event)"
            />
          }
          @case ('rubric') {
            <ptah-step-crucible-rubric
              [rubric]="rubric()"
              [roundCap]="roundCap()"
              (rubricChanged)="onRubric($event)"
              (roundCapChanged)="onRoundCap($event)"
            />
          }
          @case ('run') {
            <ptah-step-run
              [move]="move()"
              [lanes]="lanes()"
              [rubric]="rubric()"
              [roundCap]="roundCap()"
              (launched)="launched.emit()"
            />
          }
        }
      </div>

      <footer class="flex items-center justify-between">
        <button
          type="button"
          class="btn btn-ghost btn-sm gap-1"
          [disabled]="stepIndex() === 0"
          aria-label="Previous step"
          (click)="back()"
        >
          <lucide-angular [img]="BackIcon" class="h-4 w-4" aria-hidden="true" />
          Back
        </button>
        @if (stepIndex() < steps().length - 1) {
          <button
            type="button"
            class="btn btn-primary btn-sm gap-1"
            [disabled]="!canAdvance()"
            aria-label="Next step"
            (click)="next()"
          >
            Next
            <lucide-angular
              [img]="NextIcon"
              class="h-4 w-4"
              aria-hidden="true"
            />
          </button>
        }
      </footer>
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
export class TribunalWizardComponent {
  readonly launched = output<void>();

  private readonly _stepIndex = signal(0);
  private readonly _move = signal<TribunalMove>('council');
  private readonly _lanes = signal<readonly VendorLane[]>([]);
  private readonly _rubric = signal<string>(DEFAULT_CRUCIBLE_RUBRIC);
  private readonly _roundCap = signal<number>(MAX_CRUCIBLE_ROUND_CAP);

  protected readonly stepIndex = this._stepIndex.asReadonly();
  protected readonly move = this._move.asReadonly();
  protected readonly lanes = this._lanes.asReadonly();
  protected readonly rubric = this._rubric.asReadonly();
  protected readonly roundCap = this._roundCap.asReadonly();

  protected readonly BackIcon = ChevronLeft;
  protected readonly NextIcon = ChevronRight;

  /**
   * Which lane EDITOR this move needs. The flat picker is untouched for
   * council/forge/race; the role roster emits the same `VendorLane[]`, so the
   * fork is one `@switch`, not a second wizard.
   */
  private readonly laneStepKind = computed<WizardStepKind>(() =>
    rolesForMove(this._move()).length > 0 ? 'roster' : 'flat-lanes',
  );

  protected readonly steps = computed<readonly WizardStep[]>(() => {
    const kinds: WizardStepKind[] = ['move', this.laneStepKind()];
    if (this._move() === 'crucible') kinds.push('rubric');
    kinds.push('run');
    return kinds.map((kind, index) => ({
      index,
      kind,
      label: STEP_LABEL[kind],
    }));
  });

  protected readonly currentStep = computed<WizardStep>(() => {
    const steps = this.steps();
    return steps[Math.min(this._stepIndex(), steps.length - 1)];
  });

  protected readonly canAdvance = computed(() => {
    switch (this.currentStep().kind) {
      case 'flat-lanes':
        return this._lanes().length > 0;
      case 'roster':
        // The roster rules own this: an unfilled slot, a self-reviewing relay
        // lane and a same-family Crucible judge all block here rather than
        // failing at launch (AC-2.3, AC-2.5).
        return (
          this._lanes().length > 0 &&
          rosterIsLaunchable(this._move(), this._lanes())
        );
      case 'rubric':
        return this._rubric().trim().length > 0;
      case 'move':
      case 'run':
        return true;
    }
  });

  /**
   * Changing the move discards the roster.
   *
   * A flat panel carries no roles and a role roster carries no spare lanes, so
   * keeping the old selection across a move change would hand `prepare()` a
   * roster shaped for a different move. Restarting at the lane step is also the
   * honest signal that the previous picks no longer apply.
   */
  protected onMove(move: TribunalMove): void {
    if (move === this._move()) return;
    this._move.set(move);
    this._lanes.set([]);
    this._stepIndex.set(0);
  }

  protected onLanes(lanes: readonly VendorLane[]): void {
    this._lanes.set(lanes);
  }

  protected onRubric(rubric: string): void {
    this._rubric.set(rubric);
  }

  protected onRoundCap(roundCap: number): void {
    this._roundCap.set(roundCap);
  }

  protected next(): void {
    if (!this.canAdvance()) return;
    this._stepIndex.update((i) => Math.min(i + 1, this.steps().length - 1));
  }

  protected back(): void {
    this._stepIndex.update((i) => Math.max(i - 1, 0));
  }
}
