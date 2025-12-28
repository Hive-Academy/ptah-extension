import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * FeatureCardComponent - Reusable card for showcasing features
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection, input signals
 *
 * Features:
 * - Emoji icon with gold-tinted container
 * - Title, description, and capabilities list
 * - Golden glow hover effect with smooth transitions
 * - Responsive sizing with min-width constraint
 * - Glass morphism background effect
 *
 * SOLID Principles:
 * - Single Responsibility: Display feature card content only
 * - Composition: Used in FeaturesSectionComponent
 *
 * Design Spec Reference: visual-design-specification.md:Component 4
 */
@Component({
  selector: 'ptah-feature-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article
      class="group bg-base-200/70 backdrop-blur-xl border border-secondary/20 rounded-2xl p-8
             hover:translate-y-[-4px] hover:border-secondary/40 hover:shadow-[0_0_40px_rgba(212,175,55,0.3)]
             transition-all duration-300 min-w-[320px]"
      role="article"
    >
      <!-- Icon Container -->
      <div
        class="w-20 h-20 rounded-xl bg-secondary/10 flex items-center justify-center mb-6
               transition-colors duration-300 group-hover:bg-secondary/20"
      >
        <span class="text-4xl text-secondary" aria-hidden="true">{{
          iconEmoji()
        }}</span>
      </div>

      <!-- Title -->
      <h3 class="text-2xl font-bold text-base-content mb-4">
        {{ title() }}
      </h3>

      <!-- Description -->
      <p class="text-base text-base-content/80 mb-6 leading-relaxed">
        {{ description() }}
      </p>

      <!-- Capabilities List -->
      <ul class="space-y-2" role="list">
        @for (capability of capabilities(); track capability) {
        <li class="text-sm text-base-content/70 flex items-center gap-2">
          <span class="text-success flex-shrink-0" aria-hidden="true">✓</span>
          <span>{{ capability }}</span>
        </li>
        }
      </ul>
    </article>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureCardComponent {
  /**
   * Emoji icon to display (e.g., "🧠", "🪄")
   */
  readonly iconEmoji = input.required<string>();

  /**
   * Feature title (e.g., "Workspace Intelligence")
   */
  readonly title = input.required<string>();

  /**
   * Feature description paragraph
   */
  readonly description = input.required<string>();

  /**
   * List of feature capabilities/benefits
   */
  readonly capabilities = input.required<string[]>();
}
