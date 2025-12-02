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
 * - VS Code-like window chrome (traffic light window controls)
 * - Live demo chat embedded via DemoChatViewComponent
 * - GSAP scroll-triggered fade-in animation
 * - Reduced motion support
 * - Proper GSAP cleanup on component destroy
 *
 * SOLID Principles:
 * - Single Responsibility: Display demo section with window chrome only
 * - Composition: Uses DemoChatViewComponent for chat rendering
 * - Open/Closed: Window chrome is fixed, content extensible via child component
 *
 * Design Spec Reference: visual-design-specification.md:Component 3: Live Demo Section
 * - Background: base-200
 * - Padding: 128px vertical (py-32)
 * - Window chrome: 40px height, traffic light dots (red/yellow/green)
 * - Container: 560px chat area (600px total - 40px header)
 * - Animation: Fade-in with slight upward motion on scroll (trigger at 85% viewport)
 */
@Component({
  selector: 'ptah-demo-section',
  standalone: true,
  imports: [CommonModule, DemoChatViewComponent],
  template: `
    <section #sectionRef id="demo" class="py-32 bg-base-200">
      <div class="container mx-auto px-6">
        <!-- Section Header -->
        <h2
          class="text-3xl md:text-4xl font-display font-bold text-accent text-center mb-4"
        >
          See It In Action
        </h2>
        <p
          class="text-base-content/70 text-center mb-12 max-w-2xl mx-auto"
        >
          Real Claude Code conversation with Ptah enhancements - watch AI
          navigate your codebase
        </p>

        <!-- Demo Container with VS Code Chrome -->
        <div class="demo-container max-w-4xl mx-auto">
          <!-- VS Code-like window chrome -->
          <div
            class="bg-base-100 border border-secondary/20 rounded-3xl overflow-hidden shadow-[0_0_40px_rgba(0,0,0,0.3)]"
          >
            <!-- Title bar with traffic light dots -->
            <div
              class="h-10 bg-base-300 flex items-center gap-2 px-4 border-b border-base-200"
            >
              <!-- Window control dots (macOS style) -->
              <div class="w-3 h-3 rounded-full bg-error/60"></div>
              <div class="w-3 h-3 rounded-full bg-warning/60"></div>
              <div class="w-3 h-3 rounded-full bg-success/60"></div>
              <!-- Window title -->
              <span class="ml-4 text-sm text-base-content/50"
                >Ptah Extension - Chat Session</span
              >
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
   * - Fade-in with slight upward motion (y: 30px → 0)
   * - Trigger when demo container reaches 85% of viewport
   * - Duration: 0.8s with power2.out easing
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
      gsap.from('.demo-container', {
        y: 30,
        opacity: 0,
        duration: 0.8,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: '.demo-container',
          start: 'top 85%',
        },
      });
    }, this.sectionRef().nativeElement);

    // Register cleanup on component destroy
    this.destroyRef.onDestroy(() => this.gsapContext?.revert());
  }
}
