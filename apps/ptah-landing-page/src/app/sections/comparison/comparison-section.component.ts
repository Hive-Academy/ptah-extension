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
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

@Component({
  selector: 'ptah-comparison-section',
  standalone: true,
  imports: [CommonModule],
  template: `
    <section #sectionRef class="py-24 bg-base-200">
      <div class="container mx-auto px-6">
        <h2
          class="text-3xl md:text-4xl font-display text-center text-base-content mb-16"
        >
          Transform Your Claude Experience
        </h2>

        <div
          class="relative grid md:grid-cols-2 gap-8 items-center max-w-5xl mx-auto"
        >
          <!-- Before Card -->
          <div
            class="comparison-card before-card bg-base-100 border border-error/30 rounded-2xl p-8 opacity-85"
          >
            <div
              class="inline-block px-3 py-1 rounded-full bg-error/20 text-error text-sm font-medium mb-6"
            >
              Before
            </div>
            <div
              class="bg-base-300 rounded-lg p-4 font-mono text-sm text-base-content/70 mb-6"
            >
              <div class="text-success">$ claude</div>
              <div class="text-base-content/50">Starting Claude CLI...</div>
            </div>
            <ul class="space-y-3">
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> Terminal-only interface
              </li>
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> No persistent sessions
              </li>
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> No visual context
              </li>
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> Complex CLI flags
              </li>
            </ul>
          </div>

          <!-- Arrow (hidden on mobile) -->
          <div
            class="hidden md:block absolute left-1/2 -translate-x-1/2 z-10"
            aria-hidden="true"
          >
            <div
              class="w-12 h-12 rounded-full bg-secondary flex items-center justify-center shadow-lg"
            >
              <span class="text-secondary-content text-xl font-bold">→</span>
            </div>
          </div>

          <!-- After Card -->
          <div
            class="comparison-card after-card bg-base-100 border-2 border-success/50 rounded-2xl p-8 shadow-[0_0_40px_rgba(212,175,55,0.2)]"
          >
            <div
              class="inline-block px-3 py-1 rounded-full bg-success/20 text-success text-sm font-medium mb-6"
            >
              After
            </div>
            <div class="bg-base-300 rounded-lg p-4 mb-6">
              <div class="flex items-center gap-2 mb-2">
                <div class="w-8 h-8 rounded bg-secondary/20"></div>
                <span class="font-medium text-accent">Ptah Extension</span>
              </div>
              <div class="text-sm text-base-content/60">
                Visual chat interface active
              </div>
            </div>
            <ul class="space-y-3">
              <li class="flex items-center gap-2 text-base-content">
                <span class="text-success">✓</span> Beautiful visual interface
              </li>
              <li class="flex items-center gap-2 text-base-content">
                <span class="text-success">✓</span> Session persistence &
                history
              </li>
              <li class="flex items-center gap-2 text-base-content">
                <span class="text-success">✓</span> Workspace-aware context
              </li>
              <li class="flex items-center gap-2 text-base-content">
                <span class="text-success">✓</span> One-click actions
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }

      .comparison-card {
        transition: all 0.3s ease;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ComparisonSectionComponent {
  private readonly sectionRef = viewChild.required<ElementRef>('sectionRef');
  private readonly destroyRef = inject(DestroyRef);
  private gsapContext?: gsap.Context;

  constructor() {
    afterNextRender(() => this.initAnimations());
  }

  private initAnimations(): void {
    // Respect user's motion preferences
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    this.gsapContext = gsap.context(() => {
      // Animate before card from left
      gsap.from('.before-card', {
        x: -50,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: '.comparison-card',
          start: 'top 80%',
        },
      });

      // Animate after card from right
      gsap.from('.after-card', {
        x: 50,
        opacity: 0,
        duration: 0.6,
        ease: 'power2.out',
        scrollTrigger: {
          trigger: '.comparison-card',
          start: 'top 80%',
        },
      });
    }, this.sectionRef().nativeElement);

    // Cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      this.gsapContext?.revert();
    });
  }
}
