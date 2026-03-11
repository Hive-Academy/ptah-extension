import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * DocsSectionShellComponent - Two-column layout shell for docs sections.
 *
 * Desktop (lg+): Text content on left, media placeholder(s) sticky on right.
 * Mobile/tablet: Single column, media stacks below text content.
 *
 * Usage:
 * ```html
 * <ptah-docs-section-shell sectionId="installation">
 *   <!-- Text content projected into left column -->
 *   <h2>Installation</h2>
 *   <p>Steps...</p>
 *
 *   <!-- Media projected into right column -->
 *   <ng-container media>
 *     <ptah-docs-media-placeholder title="Demo" />
 *   </ng-container>
 * </ptah-docs-section-shell>
 * ```
 */
@Component({
  selector: 'ptah-docs-section-shell',
  imports: [ViewportAnimationDirective],
  template: `
    <section [id]="sectionId()" class="py-12 scroll-mt-24">
      <div class="flex flex-col lg:flex-row lg:items-center lg:gap-8 xl:gap-12">
        <!-- Left: Text content (40% on desktop) -->
        <div class="min-w-0 lg:w-[40%] lg:shrink-0">
          <ng-content />
        </div>

        <!-- Right: Media (60% on desktop) — sticky on desktop, stacked below on mobile -->
        <div
          class="mt-8 lg:mt-0 lg:flex-1"
          viewportAnimation
          [viewportConfig]="mediaConfig"
        >
          <div class="lg:sticky lg:top-24 space-y-4">
            <ng-content select="[media]" />
          </div>
        </div>
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
export class DocsSectionShellComponent {
  public readonly sectionId = input.required<string>();

  public readonly mediaConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    delay: 0.15,
    threshold: 0.1,
  };
}
