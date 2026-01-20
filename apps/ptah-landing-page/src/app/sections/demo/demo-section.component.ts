import { Component, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DemoChatViewComponent } from '../../components/demo-chat-view.component';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
  ScrollAnimationDirective,
  ScrollAnimationConfig,
} from '@hive-academy/angular-gsap';

/**
 * DemoSectionComponent - Live chat demo showcase with VS Code window chrome
 *
 * Complexity Level: 2 (Medium)
 * Patterns: Composition (uses DemoChatViewComponent), @hive-academy/angular-gsap animations
 *
 * Batch 5 Enhancements (Task 5.3):
 * - Header text uses ViewportAnimationDirective for staggered entrance
 * - Demo window uses ScrollAnimationDirective for scroll-triggered scale animation
 * - No raw GSAP code - all via @hive-academy library directives
 * - Reduced motion support handled by library internally
 *
 * Features:
 * - VS Code-like window chrome with glassmorphism effect
 * - Gradient header bar (gold-to-transparent)
 * - Live demo chat embedded via DemoChatViewComponent
 * - Scroll-triggered scale animation (0.95 -> 1.0) via ScrollAnimationDirective
 *
 * SOLID Principles:
 * - Single Responsibility: Display demo section with window chrome only
 * - Composition: Uses DemoChatViewComponent for chat rendering
 * - Open/Closed: Window chrome is fixed, content extensible via child component
 *
 * Design Spec Reference: visual-design-specification.md:Component 3: Live Demo Section
 */
@Component({
  selector: 'ptah-demo-section',
  imports: [
    CommonModule,
    DemoChatViewComponent,
    ViewportAnimationDirective,
    ScrollAnimationDirective,
  ],
  template: `
    <section id="demo" class="py-32 bg-base-200">
      <div class="container mx-auto px-6">
        <!-- Section Label (eyebrow) with fadeIn animation -->
        <p
          viewportAnimation
          [viewportConfig]="eyebrowConfig"
          class="text-sm tracking-widest text-secondary uppercase text-center mb-4"
        >
          SEE IT IN ACTION
        </p>

        <!-- Section Header with slideUp animation -->
        <h2
          viewportAnimation
          [viewportConfig]="headlineConfig"
          class="text-5xl md:text-6xl font-display font-bold text-center mb-16"
        >
          Watch Your Codebase Come Alive
        </h2>

        <!-- Demo Container with VS Code Chrome - scroll-triggered scale animation -->
        <div
          scrollAnimation
          [scrollConfig]="demoWindowConfig"
          class="demo-container max-w-4xl mx-auto"
        >
          <!-- Demo Window with Glassmorphism -->
          <div
            class="demo-window glassmorphism rounded-2xl overflow-hidden border border-secondary/20
                   hover:animate-glow-pulse transition-all shadow-[0_0_40px_rgba(0,0,0,0.3)]"
          >
            <!-- Gradient Header Bar -->
            <div
              class="h-10 flex items-center gap-2 px-4 border-b border-secondary/10"
              style="background: linear-gradient(90deg, rgba(212,175,55,0.1) 0%, transparent 50%, rgba(212,175,55,0.1) 100%);"
            >
              <!-- Window control dots (macOS style) -->
              <div class="w-3 h-3 rounded-full bg-error"></div>
              <div class="w-3 h-3 rounded-full bg-warning"></div>
              <div class="w-3 h-3 rounded-full bg-success"></div>
            </div>

            <!-- Chat content area (560px = 600px total - 40px header) -->
            <div class="h-[560px]">
              <ptah-demo-chat-view />
            </div>
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
export class DemoSectionComponent {
  /**
   * Eyebrow text animation config - fadeIn for subtle entrance
   */
  readonly eyebrowConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.6,
    threshold: 0.2,
  };

  /**
   * Headline animation config - slideUp for dramatic entrance
   */
  readonly headlineConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.8,
    delay: 0.1,
    threshold: 0.2,
  };

  /**
   * Demo window scroll animation config
   *
   * Animation Strategy:
   * - Scale animation (0.95 -> 1.0) for dramatic entrance
   * - Fade-in with opacity transition
   * - Trigger when demo container reaches 80% of viewport
   * - Smooth scrub for scroll-linked animation
   */
  readonly demoWindowConfig: ScrollAnimationConfig = {
    animation: 'custom',
    start: 'top 85%',
    end: 'top 50%',
    scrub: 1,
    from: { scale: 0.95, opacity: 0 },
    to: { scale: 1, opacity: 1 },
  };
}
