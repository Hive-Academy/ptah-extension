import {
  ChangeDetectionStrategy,
  Component,
  computed,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule, ChevronLeft, ChevronRight } from 'lucide-angular';
import { StepObjectiveComponent } from './step-objective.component';
import { StepPickMoveComponent } from './step-pick-move.component';
import { StepPanelPreviewComponent } from './step-panel-preview.component';
import { StepConfirmCostComponent } from './step-confirm-cost.component';
import { StepRunComponent } from './step-run.component';
import type { TribunalMove, VendorLane } from '../types/tribunal-ui.types';

interface WizardStep {
  readonly index: number;
  readonly label: string;
}

@Component({
  selector: 'ptah-tribunal-wizard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    LucideAngularModule,
    StepObjectiveComponent,
    StepPickMoveComponent,
    StepPanelPreviewComponent,
    StepConfirmCostComponent,
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
        @for (step of steps; track step.index) {
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
              [class.text-base-content/40]="stepIndex() < step.index"
            >
              {{ step.label }}
            </span>
            @if (step.index < steps.length - 1) {
              <span class="h-px flex-1 bg-base-300"></span>
            }
          </div>
        }
      </nav>

      <div class="flex-1 overflow-auto">
        @switch (stepIndex()) {
          @case (0) {
            <ptah-step-objective
              [objective]="objective()"
              (objectiveChanged)="onObjective($event)"
            />
          }
          @case (1) {
            <ptah-step-pick-move
              [selected]="move()"
              (moveSelected)="onMove($event)"
            />
          }
          @case (2) {
            <ptah-step-panel-preview
              [selectedLanes]="lanes()"
              (lanesChanged)="onLanes($event)"
            />
          }
          @case (3) {
            <ptah-step-confirm-cost [move]="move()" [lanes]="lanes()" />
          }
          @case (4) {
            <ptah-step-run
              [move]="move()"
              [lanes]="lanes()"
              [objective]="objective()"
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
        @if (stepIndex() < steps.length - 1) {
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

  protected readonly steps: readonly WizardStep[] = [
    { index: 0, label: 'Objective' },
    { index: 1, label: 'Move' },
    { index: 2, label: 'Panel' },
    { index: 3, label: 'Confirm' },
    { index: 4, label: 'Run' },
  ];

  private readonly _stepIndex = signal(0);
  private readonly _objective = signal('');
  private readonly _move = signal<TribunalMove>('council');
  private readonly _lanes = signal<readonly VendorLane[]>([]);

  protected readonly stepIndex = this._stepIndex.asReadonly();
  protected readonly objective = this._objective.asReadonly();
  protected readonly move = this._move.asReadonly();
  protected readonly lanes = this._lanes.asReadonly();

  protected readonly BackIcon = ChevronLeft;
  protected readonly NextIcon = ChevronRight;

  protected readonly canAdvance = computed(() => {
    switch (this._stepIndex()) {
      case 0:
        return this._objective().trim().length > 0;
      case 2:
        return this._lanes().length > 0;
      default:
        return true;
    }
  });

  protected onObjective(objective: string): void {
    this._objective.set(objective);
  }

  protected onMove(move: TribunalMove): void {
    this._move.set(move);
  }

  protected onLanes(lanes: readonly VendorLane[]): void {
    this._lanes.set(lanes);
  }

  protected next(): void {
    if (!this.canAdvance()) return;
    this._stepIndex.update((i) => Math.min(i + 1, this.steps.length - 1));
  }

  protected back(): void {
    this._stepIndex.update((i) => Math.max(i - 1, 0));
  }
}
