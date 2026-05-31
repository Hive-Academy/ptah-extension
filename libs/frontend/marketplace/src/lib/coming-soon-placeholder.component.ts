import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { LucideAngularModule, Construction } from 'lucide-angular';

/**
 * Disabled provider surface rendered for `status: 'coming-soon'` descriptors.
 * Static text only — fires ZERO network/RPC/SDK calls and holds no API keys.
 */
@Component({
  selector: 'ptah-coming-soon-placeholder',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="flex flex-col items-center justify-center h-full text-center px-6 py-12 gap-4"
    >
      <div
        class="w-14 h-14 rounded-2xl bg-base-300/50 border border-base-300 flex items-center justify-center"
      >
        <lucide-angular
          [img]="ConstructionIcon"
          class="w-7 h-7 text-base-content/40"
          aria-hidden="true"
        />
      </div>
      <div class="max-w-md">
        <h2 class="text-lg font-bold text-base-content">
          {{ providerName() }} is coming soon
        </h2>
        <p class="text-sm text-base-content/50 mt-2 leading-relaxed">
          Integration for {{ providerName() }} is on the way. You'll be able to
          browse and install its servers directly from the Marketplace once it's
          available.
        </p>
      </div>
      <span
        class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-base-300/60 text-xs font-medium text-base-content/50"
      >
        Coming soon
      </span>
    </div>
  `,
})
export class ComingSoonPlaceholderComponent {
  public readonly providerName = input<string>('This provider');
  protected readonly ConstructionIcon = Construction;
}
