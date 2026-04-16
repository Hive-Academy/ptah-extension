/**
 * HarnessStepperComponent
 *
 * Horizontal step indicator showing the 6-step wizard progress.
 * Uses DaisyUI `steps` component for consistent styling.
 *
 * Each step shows an icon and label with active/completed/pending states.
 */

import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import {
  LucideAngularModule,
  Wand2,
  Bot,
  Wrench,
  FileText,
  Server,
  CheckCircle,
  type LucideIconData,
} from 'lucide-angular';
import type { HarnessWizardStep } from '@ptah-extension/shared';

interface StepDefinition {
  id: HarnessWizardStep;
  label: string;
  icon: LucideIconData;
}

const STEPS: StepDefinition[] = [
  { id: 'persona', label: 'Describe', icon: Wand2 },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'skills', label: 'Skills', icon: Wrench },
  { id: 'prompts', label: 'Prompts', icon: FileText },
  { id: 'mcp', label: 'MCP', icon: Server },
  { id: 'review', label: 'Review', icon: CheckCircle },
];

@Component({
  selector: 'ptah-harness-stepper',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul class="steps steps-horizontal w-full text-xs">
      @for (step of steps; track step.id) {
        <li
          class="step cursor-pointer transition-colors"
          [class.step-primary]="isActiveOrCompleted(step.id)"
          (click)="stepClicked.emit(step.id)"
          (keydown.enter)="stepClicked.emit(step.id)"
          (keydown.space)="stepClicked.emit(step.id)"
          [attr.aria-current]="step.id === currentStep() ? 'step' : null"
          [attr.tabindex]="0"
          role="listitem"
        >
          <span class="flex items-center gap-1">
            <lucide-angular
              [img]="step.icon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
            <span>{{ step.label }}</span>
          </span>
        </li>
      }
    </ul>
  `,
})
export class HarnessStepperComponent {
  public readonly currentStep = input.required<HarnessWizardStep>();
  public readonly completedSteps = input.required<Set<HarnessWizardStep>>();
  public readonly stepClicked = output<HarnessWizardStep>();

  public readonly steps = STEPS;

  public isActiveOrCompleted(stepId: HarnessWizardStep): boolean {
    return stepId === this.currentStep() || this.completedSteps().has(stepId);
  }
}
