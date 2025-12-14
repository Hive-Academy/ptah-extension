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
          From Terminal Chaos to Visual Clarity
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
              Claude Code CLI Alone
            </div>
            <div
              class="bg-base-300 rounded-lg p-4 font-mono text-sm text-base-content/70 mb-6"
            >
              <div class="text-success">$ claude</div>
              <div class="text-base-content/50">Starting Claude CLI...</div>
            </div>
            <ul class="space-y-3">
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> Context-switching between
                terminal and editor kills flow
              </li>
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> No visual feedback—just text
                scrolling in a black box
              </li>
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> Session management means
                memorizing CLI flags and paths
              </li>
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> File context requires manual
                specification every time
              </li>
              <li class="flex items-center gap-2 text-base-content/70">
                <span class="text-error">✗</span> Tracking token usage and costs
                means parsing logs
              </li>
            </ul>
          </div>

          <!-- SVG Arrow (hidden on mobile) -->
          <div
            class="hidden md:block absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10"
            aria-hidden="true"
          >
            <svg class="arrow-svg" viewBox="0 0 120 60" width="120" height="60">
              <defs>
                <linearGradient
                  id="arrowGradient"
                  x1="0%"
                  y1="0%"
                  x2="100%"
                  y2="0%"
                >
                  <stop offset="0%" stop-color="#6b7280" />
                  <stop offset="100%" stop-color="#d4af37" />
                </linearGradient>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                  <feMerge>
                    <feMergeNode in="coloredBlur" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              <path
                d="M 10 30 L 90 30 M 75 15 L 90 30 L 75 45"
                stroke="url(#arrowGradient)"
                stroke-width="4"
                fill="none"
                filter="url(#glow)"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-dasharray="100"
                stroke-dashoffset="100"
                class="arrow-path"
              />
            </svg>
          </div>

          <!-- After Card -->
          <div
            class="comparison-card after-card bg-base-100 border-2 border-secondary shadow-glow-gold rounded-2xl p-8"
          >
            <div
              class="inline-block px-3 py-1 rounded-full bg-secondary/20 text-secondary text-sm font-medium mb-6"
            >
              Ptah Extension
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
                <span class="text-secondary">✓</span> Native sidebar keeps chat
                next to code—zero context loss
              </li>
              <li class="flex items-center gap-2 text-base-content">
                <span class="text-secondary">✓</span> ExecutionNode trees
                visualize agent spawning in real-time
              </li>
              <li class="flex items-center gap-2 text-base-content">
                <span class="text-secondary">✓</span> Click to switch sessions,
                track costs, manage multiple contexts
              </li>
              <li class="flex items-center gap-2 text-base-content">
                <span class="text-secondary">✓</span> Workspace intelligence
                auto-ranks files by relevance
              </li>
              <li class="flex items-center gap-2 text-base-content">
                <span class="text-secondary">✓</span> Real-time dashboard shows
                tokens, costs, performance metrics
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
      // Timeline for coordinated animations
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: this.sectionRef().nativeElement,
          start: 'top 80%',
          toggleActions: 'play none none reverse',
        },
      });

      // 1. Before card shake animation
      tl.from('.before-card', {
        x: -20,
        opacity: 0,
        duration: 0.6,
        ease: 'power3.out',
      });

      // 2. Arrow draw animation (stroke-dashoffset 100 → 0)
      tl.to(
        '.arrow-path',
        {
          strokeDashoffset: 0,
          duration: 1.2,
          ease: 'power2.inOut',
        },
        '-=0.2'
      );

      // 3. After card scale with bounce
      tl.from(
        '.after-card',
        {
          scale: 0.9,
          opacity: 0,
          duration: 0.6,
          ease: 'back.out(1.7)',
        },
        '-=0.6'
      );
    }, this.sectionRef().nativeElement);

    // Cleanup on component destroy
    this.destroyRef.onDestroy(() => {
      ScrollTrigger.getAll().forEach((trigger) => trigger.kill());
      this.gsapContext?.revert();
    });
  }
}
