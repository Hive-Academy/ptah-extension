import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ptah-docs-step-card',
  imports: [CommonModule],
  template: `
    <div class="flex gap-4 sm:gap-5">
      <!-- Step number -->
      <div
        class="shrink-0 w-9 h-9 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center"
      >
        <span class="text-sm font-bold text-amber-400">{{ stepNumber() }}</span>
      </div>
      <!-- Content -->
      <div class="flex-1 min-w-0 pt-0.5">
        <h4 class="text-base font-semibold text-white/90 mb-1.5">
          {{ title() }}
        </h4>
        <div class="text-sm text-white/60 leading-relaxed">
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
