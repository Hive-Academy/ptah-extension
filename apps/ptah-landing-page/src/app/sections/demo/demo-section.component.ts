import {
  Component,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
  inject,
  afterNextRender,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { DemoChatViewComponent } from '../../components/demo-chat-view.component';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * DemoSectionComponent - Live chat demo showcase with VS Code window chrome
 *
 * Complexity Level: 2 (Medium)
 * Patterns: Composition (uses DemoChatViewComponent), GSAP ScrollTrigger animations
 *
 * Features:
 * - VS Code-like window chrome with glassmorphism effect
 * - Gradient header bar (gold-to-transparent)
 * - Live demo chat embedded via DemoChatViewComponent
 * - GSAP scroll-triggered scale animation (0.95 → 1.0)
 * - Reduced motion support
 * - Proper GSAP cleanup on component destroy
 *
 * SOLID Principles:
 * - Single Responsibility: Display demo section with window chrome only
 * - Composition: Uses DemoChatViewComponent for chat rendering
 * - Open/Closed: Window chrome is fixed, content extensible via child component
 *
 * Design Spec Reference: visual-design-specification.md:Component 3: Live Demo Section
 * Task Reference: TASK_2025_072 Batch 4 Task 4.3
 */
@Component({
  selector: 'ptah-demo-section',
  standalone: true,
  imports: [CommonModule, DemoChatViewComponent],
  template: `
    <section #sectionRef id="demo" class="py-32 bg-base-200">
      <div class="container mx-auto px-6">
        <!-- Section Label (eyebrow) -->
        <p
          class="text-sm tracking-widest text-secondary uppercase text-center mb-4"
        >
          SEE IT IN ACTION
        </p>

        <!-- Section Header -->
        <h2
          class="text-5xl md:text-6xl font-display font-bold text-center mb-16"
        >
          Watch Your Codebase Come Alive
        </h2>

        <!-- Demo Container with VS Code Chrome -->
        <div class="demo-container max-w-4xl mx-auto">
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
  private readonly sectionRef = viewChild.required<ElementRef>('sectionRef');
  private readonly destroyRef = inject(DestroyRef);
  private gsapContext?: gsap.Context;

  constructor() {
    afterNextRender(() => this.initAnimations());
  }

  /**
   * Initialize GSAP scroll-triggered animations
   *
   * Animation Strategy:
   * - Scale animation (0.95 → 1.0) for dramatic entrance
   * - Fade-in with opacity transition
   * - Trigger when demo container reaches 80% of viewport
   * - Duration: 0.8s with power3.out easing
   * - Respects prefers-reduced-motion preference
   *
   * Cleanup:
   * - gsapContext.revert() called on component destroy via DestroyRef
   */
  private initAnimations(): void {
    // Respect user's motion preferences
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    // Create scoped GSAP context for animations
    this.gsapContext = gsap.context(() => {
      gsap.from('.demo-window', {
        scrollTrigger: {
          trigger: '.demo-container',
          start: 'top 80%',
          toggleActions: 'play none none reverse',
        },
        scale: 0.95,
        opacity: 0,
        duration: 0.8,
        ease: 'power3.out',
      });
    }, this.sectionRef().nativeElement);

    // Register cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      this.gsapContext?.revert();
    });
  }
}
