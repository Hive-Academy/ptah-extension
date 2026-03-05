import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
  effect,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  LucideAngularModule,
  ChevronDown,
  type LucideIconData,
} from 'lucide-angular';

@Component({
  selector: 'ptah-docs-collapsible-card',
  imports: [CommonModule, LucideAngularModule],
  template: `
    <div
      class="bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl overflow-hidden"
    >
      <!-- Header — always visible, clickable to toggle -->
      <button
        type="button"
        class="w-full px-5 sm:px-6 py-4 flex items-center gap-3 text-left transition-colors"
        [ngClass]="{
          'border-b border-secondary/10': isExpanded(),
          'hover:bg-base-300/30': !isExpanded()
        }"
        (click)="toggle()"
      >
        <div
          class="w-8 h-8 rounded-lg bg-secondary/10 flex items-center justify-center shrink-0"
        >
          <lucide-angular
            [img]="icon()"
            class="w-4 h-4 text-secondary"
            aria-hidden="true"
          />
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="font-display text-base font-semibold">{{ title() }}</h3>
          @if (subtitle()) {
          <span class="text-xs text-neutral-content/60">{{ subtitle() }}</span>
          }
        </div>
        <lucide-angular
          [img]="ChevronDownIcon"
          class="w-4 h-4 text-neutral-content/40 shrink-0 transition-transform duration-200"
          [class.rotate-180]="isExpanded()"
          aria-hidden="true"
        />
      </button>

      <!-- Collapsible content -->
      @if (isExpanded()) {
      <div class="p-5 sm:p-6">
        <ng-content />
      </div>
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
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocsCollapsibleCardComponent {
  public readonly icon = input.required<LucideIconData>();
  public readonly title = input.required<string>();
  public readonly subtitle = input('');
  public readonly expanded = input(false);

  public readonly isExpanded = signal(false);

  public readonly ChevronDownIcon = ChevronDown;

  public constructor() {
    effect(() => {
      this.isExpanded.set(this.expanded());
    });
  }

  public toggle(): void {
    this.isExpanded.update((v) => !v);
  }
}
