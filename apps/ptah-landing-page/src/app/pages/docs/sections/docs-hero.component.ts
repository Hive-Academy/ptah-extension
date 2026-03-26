import { Component, ChangeDetectionStrategy } from '@angular/core';

import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

@Component({
  selector: 'ptah-docs-hero',
  imports: [ViewportAnimationDirective],
  template: `
    <section id="docs-hero" class="pt-28 pb-12 sm:pt-32 sm:pb-16">
      <div class="max-w-3xl">
        <h1
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="text-4xl sm:text-5xl font-display font-bold gradient-text-gold mb-4"
        >
          Getting Started
        </h1>
        <p
          viewportAnimation
          [viewportConfig]="subtitleConfig"
          class="text-lg text-white/60 leading-relaxed"
        >
          Everything you need to install Ptah, connect your AI provider, and
          start building with intelligent agents inside VS Code.
        </p>
      </div>

      <!-- Decorative divider -->
      <div
        viewportAnimation
        [viewportConfig]="dividerConfig"
        class="mt-10 overflow-hidden"
      >
        <div
          class="h-[1px] w-full bg-gradient-to-r from-amber-500/40 via-amber-500/10 to-transparent"
        ></div>
      </div>
    </section>
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
export class DocsHeroComponent {
  public readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'scaleIn',
    duration: 0.7,
    threshold: 0.2,
  };

  public readonly subtitleConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.7,
    delay: 0.1,
    threshold: 0.2,
  };

  public readonly dividerConfig: ViewportAnimationConfig = {
    animation: 'custom',
    duration: 1,
    delay: 0.2,
    threshold: 0.2,
    from: { scaleX: 0, transformOrigin: 'left' },
    to: { scaleX: 1 },
  };
}
