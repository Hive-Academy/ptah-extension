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
    <nav aria-label="Progress" class="w-full">
      <ol class="flex w-full items-center gap-1" data-testid="onboarding-stepper">
        @for (step of steps(); track step.id) {
          <li class="step-item flex min-w-0 items-center gap-1" [class.flex-1]="step.state === 'current' || step.state === 'current-complete'"
              [class.shrink-0]="step.state === 'current' || step.state === 'current-complete'" [class.shrink]="step.state !== 'current' && step.state !== 'current-complete'"
              [attr.data-state]="step.state" [attr.aria-current]="step.state === 'current' || step.state === 'current-complete' ? 'step' : null">
            @if (step.state === 'completed') {
              @if (step.link) {
                <a [routerLink]="step.link.commands" [queryParams]="step.link.queryParams"
                   class="flex min-h-8 items-center gap-2 rounded-full px-1 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  <span class="grid size-6 shrink-0 place-items-center rounded-full border border-state-done text-state-done"><lucide-angular [img]="icons.check" class="size-4" aria-hidden="true" /></span>
                  <span class="max-[720px]:sr-only">{{ step.label }}<span class="sr-only">, completed</span></span>
                </a>
              } @else {
                <span class="flex min-h-8 items-center gap-2 rounded-full px-1 py-1 text-sm">
                  <span class="grid size-6 shrink-0 place-items-center rounded-full border border-state-done text-state-done"><lucide-angular [img]="icons.check" class="size-4" aria-hidden="true" /></span>
                  <span class="max-[720px]:sr-only">{{ step.label }}<span class="sr-only">, completed</span></span>
                </span>
              }
            } @else {
              <span class="flex min-h-8 min-w-0 items-center gap-2 rounded-full py-1 text-sm"
                    [class.px-3]="step.state === 'current' || step.state === 'current-complete'"
                    [class.px-1]="step.state !== 'current' && step.state !== 'current-complete'"
                    [class.border]="step.state === 'current' || step.state === 'current-complete'"
                    [class.border-base-300]="step.state === 'current' || step.state === 'current-complete'"
                    [class.bg-base-200]="step.state === 'current' || step.state === 'current-complete'"
                    [class.font-semibold]="step.state === 'current' || step.state === 'current-complete'"
                    [attr.data-glass-surface]="step.state === 'current' || step.state === 'current-complete' ? 'chrome' : null">
                <span class="grid size-6 shrink-0 place-items-center rounded-full border border-base-300 text-xs font-semibold"
                      [class.border-state-done]="step.state === 'current-complete'"
                      [class.text-state-done]="step.state === 'current-complete'"
                      [class.bg-base-content]="step.state === 'current'"
                      [class.text-base-100]="step.state === 'current'">
                  @if (step.state === 'current') { {{ $index + 1 }} }
                  @else { <lucide-angular [img]="step.state === 'skipped' ? icons.skipped : step.state === 'current-complete' ? icons.check : icons.pending" class="size-4" aria-hidden="true" /> }
                </span>
                <span class="min-w-0 whitespace-nowrap" [class.max-[720px]:sr-only]="step.state !== 'current' && step.state !== 'current-complete'">{{ step.label }}@if (step.state === 'skipped') {<span class="text-base-content-muted">, skipped</span>}@if (step.state === 'current-complete') {<span class="sr-only">, completed</span>}</span>
              </span>
            }
          </li>
        }
      </ol>
    </nav>
  `,
  styles: [`
    .step-item + .step-item::before { content: ''; flex: 0 0 24px; height: 1px; background: oklch(var(--b3)); }
  `],
})
export class OnboardingStepperComponent {
  readonly steps = input.required<readonly OnboardingStep[]>();
  protected readonly icons = { check: Check, pending: CircleDashed, skipped: FastForward } as const;
}
