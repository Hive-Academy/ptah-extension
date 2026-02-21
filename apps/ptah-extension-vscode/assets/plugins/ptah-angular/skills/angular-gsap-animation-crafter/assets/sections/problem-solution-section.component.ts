import { ChangeDetectionStrategy, Component } from '@angular/core';
import {
  ScrollAnimationDirective,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';

/**
 * Problem/Solution Section - Premium Visual Design
 * Establishes pain points developers face when building 3D and animated Angular apps
 * Positions solution with 4 proof metrics using enhanced visual components
 *
 * Design Pattern: Dark Theme with Gradient Accents (matching angular-3d-section)
 * - Deep dark gradient background
 * - Ambient glow effects
 * - Large gradient text for metrics
 * - Premium badge styling
 *
 * Uses ViewportAnimationDirective for simple enter animations (fade/slide)
 * and ScrollAnimationDirective for scroll-progress-linked animations (parallax)
 */
@Component({
  selector: 'app-problem-solution-section',
  imports: [ScrollAnimationDirective, ViewportAnimationDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Dark immersive background matching angular-3d-section -->
    <section
      class="relative min-h-screen py-24 overflow-hidden bg-gradient-to-b from-slate-900 via-indigo-950/50 to-slate-900"
    >
      <!-- Ambient glow effects -->
      <div class="absolute inset-0 pointer-events-none" aria-hidden="true">
        <div
          class="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-indigo-500/10 rounded-full blur-[120px]"
        ></div>
        <div
          class="absolute bottom-1/3 right-1/4 w-[400px] h-[400px] bg-purple-500/10 rounded-full blur-[100px]"
        ></div>
        <div
          class="absolute top-1/2 right-1/3 w-[300px] h-[300px] bg-pink-500/8 rounded-full blur-[80px]"
        ></div>
      </div>

      <div class="relative z-10 container mx-auto px-8">
        <div class="max-w-6xl mx-auto space-y-20">
          <!-- Problem Section - The Challenge -->
          <div
            class="text-center"
            scrollAnimation
            [scrollConfig]="{
              animation: 'custom',
              start: 'top 90%',
              end: 'top 40%',
              scrub: 0.8,
              from: { opacity: 0, y: 40 },
              to: { opacity: 1, y: 0 }
            }"
          >
            <!-- Challenge Badge -->
            <div
              class="inline-block mb-8"
              viewportAnimation
              [viewportConfig]="{
                animation: 'scaleIn',
                duration: 0.6,
                threshold: 0.3
              }"
            >
              <span
                class="inline-flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-red-500/20 to-orange-500/20 border border-red-400/30 rounded-full text-sm font-semibold text-red-300 backdrop-blur-sm"
              >
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clip-rule="evenodd"
                  />
                </svg>
                THE CHALLENGE
              </span>
            </div>

            <h2
              class="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight"
            >
              The Challenge
            </h2>
            <p
              class="text-xl md:text-2xl text-gray-300 max-w-4xl mx-auto leading-relaxed mb-10"
            >
              Angular developers want immersive 3D experiences and scroll-driven
              animations without the steep learning curve of Three.js and GSAP.
              Existing wrappers are outdated, lack proper typing, or don't
              follow Angular patterns.
            </p>

            <!-- Problem bullets - styled pills -->
            <div class="flex flex-wrap justify-center gap-4">
              @for (problem of problems; track $index) {
              <div
                class="flex items-center gap-2 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-full text-red-300 text-sm font-medium backdrop-blur-sm"
                viewportAnimation
                [viewportConfig]="{
                  animation: 'slideUp',
                  duration: 0.5,
                  delay: $index * 0.1,
                  threshold: 0.2
                }"
              >
                <span class="w-2 h-2 rounded-full bg-red-400"></span>
                {{ problem }}
              </div>
              }
            </div>
          </div>

          <!-- Divider with Lightning Icon -->
          <div
            class="flex items-center justify-center py-8"
            viewportAnimation
            [viewportConfig]="{
              animation: 'scaleIn',
              duration: 0.8,
              threshold: 0.3
            }"
          >
            <div
              class="h-px bg-gradient-to-r from-transparent via-indigo-500/40 to-transparent w-full max-w-xl"
            ></div>
            <div
              class="absolute w-20 h-20 bg-gradient-to-br from-amber-400 to-orange-500 rounded-full flex items-center justify-center shadow-2xl shadow-orange-500/30"
            >
              <span class="text-4xl">⚡</span>
            </div>
          </div>

          <!-- Solution Section -->
          <div
            class="text-center"
            scrollAnimation
            [scrollConfig]="{
              animation: 'custom',
              start: 'top 80%',
              end: 'top 30%',
              scrub: 0.8,
              from: { opacity: 0, y: 40 },
              to: { opacity: 1, y: 0 }
            }"
          >
            <!-- Solution Badge -->
            <div
              class="inline-block mb-8"
              viewportAnimation
              [viewportConfig]="{
                animation: 'scaleIn',
                duration: 0.6,
                delay: 0.2,
                threshold: 0.3
              }"
            >
              <span
                class="inline-flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 border border-emerald-400/30 rounded-full text-sm font-semibold text-emerald-300 backdrop-blur-sm"
              >
                <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path
                    fill-rule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clip-rule="evenodd"
                  />
                </svg>
                OUR SOLUTION
              </span>
            </div>

            <!-- Main Headline with Gradient -->
            <h2
              class="text-6xl md:text-7xl font-bold mb-6 leading-tight"
              scrollAnimation
              [scrollConfig]="{
                animation: 'custom',
                start: 'top 75%',
                end: 'top 35%',
                scrub: 1,
                from: { opacity: 0, y: 50 },
                to: { opacity: 1, y: 0 }
              }"
            >
              <span
                class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
              >
                Angular-First
              </span>
              <span class="block text-white mt-2">
                3D & Animation Libraries
              </span>
            </h2>

            <p
              class="text-xl md:text-2xl text-gray-300 max-w-4xl mx-auto leading-relaxed mb-10"
              scrollAnimation
              [scrollConfig]="{
                animation: 'fadeIn',
                start: 'top 70%',
                duration: 0.8
              }"
            >
              Declarative components for Three.js and GSAP that feel native to
              Angular. Signal-based reactivity, OnPush change detection,
              SSR-safe, and full TypeScript support out of the box.
            </p>

            <!-- Tech stack badges -->
            <div
              class="flex flex-wrap justify-center gap-3 mb-12"
              viewportAnimation
              [viewportConfig]="{
                animation: 'fadeIn',
                duration: 0.6,
                delay: 0.3,
                threshold: 0.2
              }"
            >
              <span
                class="px-4 py-2 bg-indigo-500/20 text-indigo-300 rounded-full text-sm font-semibold border border-indigo-500/30"
              >
                @hive-academy/angular-3d
              </span>
              <span class="text-gray-500 flex items-center">•</span>
              <span
                class="px-4 py-2 bg-purple-500/20 text-purple-300 rounded-full text-sm font-semibold border border-purple-500/30"
              >
                @hive-academy/angular-gsap
              </span>
              <span class="text-gray-500 flex items-center">•</span>
              <span
                class="px-4 py-2 bg-emerald-500/20 text-emerald-300 rounded-full text-sm font-semibold border border-emerald-500/30"
              >
                Angular 20+
              </span>
            </div>
          </div>

          <!-- Stats Grid - Premium floating metrics -->
          <div
            class="grid grid-cols-2 md:grid-cols-4 gap-6 md:gap-8 max-w-5xl mx-auto"
          >
            @for (metric of metrics; track $index) {
            <div
              class="relative group text-center p-6 rounded-2xl bg-slate-800/50 border border-slate-700/50 backdrop-blur-sm hover:border-indigo-500/30 hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-300"
              viewportAnimation
              [viewportConfig]="{
                animation: 'slideUp',
                duration: 0.6,
                delay: $index * 0.1,
                ease: 'back.out(1.7)',
                threshold: 0.2
              }"
            >
              <!-- Subtle glow on hover -->
              <div
                class="absolute inset-0 bg-gradient-to-br from-indigo-500/5 to-purple-500/5 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              ></div>

              <!-- Large number with gradient -->
              <div
                class="relative text-5xl md:text-6xl font-bold mb-3"
                [class]="metric.colorClass"
              >
                {{ metric.value }}
              </div>
              <!-- Label -->
              <div
                class="relative text-base md:text-lg font-bold text-white mb-1"
              >
                {{ metric.label }}
              </div>
              <!-- Description -->
              <div
                class="relative text-xs md:text-sm text-gray-400 leading-relaxed"
              >
                {{ metric.description }}
              </div>
            </div>
            }
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
})
export class ProblemSolutionSectionComponent {
  public readonly problems = [
    'Complex Three.js setup',
    'Manual lifecycle management',
    'No Angular patterns',
  ];

  public readonly metrics = [
    {
      value: '10+',
      label: '3D Primitives',
      description: 'Box, Sphere, Torus, GLTF, StarField & more',
      colorClass:
        'bg-gradient-to-br from-indigo-400 to-purple-400 bg-clip-text text-transparent',
    },
    {
      value: '10+',
      label: 'Animations',
      description: 'Fade, slide, scale, parallax, hijacked scroll',
      colorClass:
        'bg-gradient-to-br from-purple-400 to-pink-400 bg-clip-text text-transparent',
    },
    {
      value: '100%',
      label: 'Type Safe',
      description: 'Full TypeScript support with IntelliSense',
      colorClass:
        'bg-gradient-to-br from-cyan-400 to-blue-400 bg-clip-text text-transparent',
    },
    {
      value: 'SSR',
      label: 'Safe',
      description: 'Works with Angular Universal out of the box',
      colorClass:
        'bg-gradient-to-br from-emerald-400 to-teal-400 bg-clip-text text-transparent',
    },
  ];
}
