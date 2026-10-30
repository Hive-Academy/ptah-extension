import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Check, CircleDashed, FastForward, LucideAngularModule } from 'lucide-angular';
import type { OnboardingStepLink } from '../shell/onboarding-step-link';

interface StepBase {
  readonly id: string;
  readonly label: string;
}

export type OnboardingStep = StepBase & (
  | { readonly state: 'completed'; readonly link?: OnboardingStepLink }
  | { readonly state: 'current' | 'current-complete' | 'upcoming' | 'skipped'; readonly link?: never }
);

@Component({
  selector: 'ptah-onboarding-stepper',
  standalone: true,
  imports: [RouterLink, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'block' },
  template: `
    <nav aria-label="Progress" class="w-full min-[720px]:sticky min-[720px]:top-4 min-[720px]:w-[210px]">
      <ol class="flex w-full items-center gap-1 min-[720px]:flex-col min-[720px]:items-stretch" data-testid="onboarding-stepper">
        @for (step of steps(); track step.id) {
          <li class="min-w-0 min-[720px]:w-full" [class.flex-1]="step.state === 'current' || step.state === 'current-complete'"
              [class.shrink-0]="step.state === 'current' || step.state === 'current-complete'" [class.shrink]="step.state !== 'current' && step.state !== 'current-complete'"
              [attr.data-state]="step.state" [attr.aria-current]="step.state === 'current' || step.state === 'current-complete' ? 'step' : null">
            @if (step.state === 'completed') {
              @if (step.link) {
                <a [routerLink]="step.link.commands" [queryParams]="step.link.queryParams"
                   class="flex min-h-8 items-center gap-2 rounded-full px-1 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary min-[720px]:px-3">
                  <lucide-angular [img]="icons.check" class="size-4 shrink-0 text-state-done" aria-hidden="true" />
                  <span class="max-[720px]:sr-only">{{ step.label }}<span class="sr-only">, completed</span></span>
                </a>
              } @else {
                <span class="flex min-h-8 items-center gap-2 rounded-full px-1 py-2 text-sm min-[720px]:px-3">
                  <lucide-angular [img]="icons.check" class="size-4 shrink-0 text-state-done" aria-hidden="true" />
                  <span class="max-[720px]:sr-only">{{ step.label }}<span class="sr-only">, completed</span></span>
                </span>
              }
            } @else {
              <span class="flex min-h-8 min-w-0 items-center gap-2 rounded-full py-2 text-sm min-[720px]:px-3"
                    [class.px-3]="step.state === 'current' || step.state === 'current-complete'"
                    [class.px-1]="step.state !== 'current' && step.state !== 'current-complete'"
                    [class.border]="step.state === 'current' || step.state === 'current-complete'"
                    [class.border-primary]="step.state === 'current' || step.state === 'current-complete'"
                    [attr.data-glass-surface]="step.state === 'current' || step.state === 'current-complete' ? 'chrome' : null">
                <lucide-angular [img]="step.state === 'skipped' ? icons.skipped : step.state === 'current-complete' ? icons.check : icons.pending" class="size-4 shrink-0" [class.text-state-done]="step.state === 'current-complete'" aria-hidden="true" />
                <span class="min-w-0 whitespace-nowrap" [class.max-[720px]:sr-only]="step.state !== 'current' && step.state !== 'current-complete'">{{ step.label }}@if (step.state === 'skipped') {<span class="text-base-content-muted">, skipped</span>}@if (step.state === 'current-complete') {<span class="sr-only">, completed</span>}</span>
              </span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
})
export class OnboardingStepperComponent {
  readonly steps = input.required<readonly OnboardingStep[]>();
  protected readonly icons = { check: Check, pending: CircleDashed, skipped: FastForward } as const;
}
