import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { CommonModule } from '@angular/common';

/**
 * FeatureCardComponent - Reusable card for showcasing features
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection, input signals
 *
 * Features:
 * - 80px icon container with gradient background circle
 * - Title, description, and capabilities badge pills (DaisyUI)
 * - Golden glow hover effect with translateY + rotate transform
 * - Responsive sizing with min-h-[400px] for visual weight
 * - Glass morphism background effect
 *
 * SOLID Principles:
 * - Single Responsibility: Display feature card content only
 * - Composition: Used in FeaturesSectionComponent
 *
 * Design Spec Reference: visual-design-specification.md:Component 4
 * Task Reference: TASK_2025_072 Batch 4 Task 4.1
 */
@Component({
  selector: 'ptah-feature-card',
  standalone: true,
  imports: [CommonModule],
  template: `
    <article
      class="feature-card group bg-base-200/70 backdrop-blur-xl border border-secondary/20 rounded-2xl p-8
             min-h-[400px] transition-all duration-300"
      role="article"
    >
      <!-- Icon Container with Gradient Background Circle (80px) -->
      <div
        class="icon-container w-20 h-20 rounded-full flex items-center justify-center mb-6"
        style="background: radial-gradient(circle, rgba(212,175,55,0.2), transparent);"
      >
        <span class="text-6xl" aria-hidden="true">{{ iconEmoji() }}</span>
      </div>

      <!-- Title -->
      <h3 class="text-2xl font-display font-bold text-accent mb-4">
        {{ title() }}
      </h3>

      <!-- Description -->
      <p class="text-base text-base-content/70 mb-6 leading-relaxed">
        {{ description() }}
      </p>

      <!-- Capability Pills (DaisyUI badges) -->
      <div class="flex flex-wrap gap-2" role="list">
        @for (capability of capabilities(); track capability) {
        <span class="badge badge-secondary badge-outline">{{
          capability
        }}</span>
        }
      </div>
    </article>
  `,
  styles: [
    `
      .feature-card:hover {
        transform: translateY(-8px) rotate(1deg);
        box-shadow: 0 0 60px rgba(212, 175, 55, 0.3);
        border-color: rgba(212, 175, 55, 0.4);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FeatureCardComponent {
  /**
   * Emoji icon to display (e.g., "🧠", "🪄", "🖥️", "⚡", "🌐")
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
