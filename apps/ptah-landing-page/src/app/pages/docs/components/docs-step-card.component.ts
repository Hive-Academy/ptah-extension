import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ptah-docs-step-card',
  imports: [CommonModule],
  template: `
    <div class="flex gap-4 sm:gap-5">
      <!-- Step number -->
      <div
        class="shrink-0 w-9 h-9 rounded-full bg-secondary/10 border border-secondary/30 flex items-center justify-center"
      >
        <span class="text-sm font-bold text-secondary">{{ stepNumber() }}</span>
      </div>
      <!-- Content -->
      <div class="flex-1 min-w-0 pt-0.5">
        <h4 class="text-base font-semibold text-base-content/90 mb-1.5">
          {{ title() }}
        </h4>
        <div class="text-sm text-neutral-content leading-relaxed">
          <ng-content />
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocsStepCardComponent {
  public readonly stepNumber = input(1);
  public readonly title = input('');
}
