import { NgOptimizedImage } from '@angular/common';
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import {
  FeatureShowcaseTimelineComponent,
  FeatureStepComponent,
  FeatureBadgeDirective,
  FeatureTitleDirective,
  FeatureDescriptionDirective,
  FeatureNotesDirective,
  FeatureVisualDirective,
  FeatureDecorationDirective,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { DecorativePatternComponent } from '../../../shared/components/decorative-pattern.component';
import type { TimelineStep } from '../../../shared/types/timeline-step.interface';

/**
 * Angular 3D Section - 3D Visualization Library Showcase
 *
 * Showcases:
 * - Pure Angular wrapper for Three.js
 * - Signal-based reactivity
 * - 10+ 3D primitive components
 * - GSAP-powered animations
 *
 * Design Pattern: Feature Showcase Timeline with Pre-Made Components
 * - Uses agsp-feature-showcase-timeline for container theming
 * - Uses agsp-feature-step for individual steps with built-in pinning & animations
 * - Dramatic code reduction from ~500 lines to ~150 lines
 */
@Component({
  selector: 'app-angular-3d-section',
  imports: [
    NgOptimizedImage,
    FeatureShowcaseTimelineComponent,
    FeatureStepComponent,
    FeatureBadgeDirective,
    FeatureTitleDirective,
    FeatureDescriptionDirective,
    FeatureNotesDirective,
    FeatureVisualDirective,
    FeatureDecorationDirective,
    ViewportAnimationDirective,
    DecorativePatternComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <agsp-feature-showcase-timeline [colorTheme]="'indigo'">
      <!-- Hero Section -->
      <div
        featureHero
        class="relative text-center py-16 flex flex-col justify-center"
      >
        <!-- Hero Content -->
        <div class="relative z-10">
          <!-- Layer Badge -->
          <div
            class="inline-block"
            viewportAnimation
            [viewportConfig]="{
              animation: 'scaleIn',
              duration: 0.6,
              threshold: 0.3
            }"
          >
            <span
              class="inline-flex items-center gap-2 px-6 py-2 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-indigo-400/30 rounded-full text-sm font-semibold text-indigo-300 mb-6 backdrop-blur-sm"
            >
              <svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  d="M3 12v3c0 1.657 3.134 3 7 3s7-1.343 7-3v-3c0 1.657-3.134 3-7 3s-7-1.343-7-3z"
                />
                <path
                  d="M3 7v3c0 1.657 3.134 3 7 3s7-1.343 7-3V7c0 1.657-3.134 3-7 3S3 8.657 3 7z"
                />
                <path
                  d="M17 5c0 1.657-3.134 3-7 3S3 6.657 3 5s3.134-3 7-3 7 1.343 7 3z"
                />
              </svg>
              3D VISUALIZATION LAYER
            </span>
          </div>

          <!-- Main Headline -->
          <h2
            class="text-7xl font-bold text-white mb-6 leading-tight"
            viewportAnimation
            [viewportConfig]="{
              animation: 'slideUp',
              duration: 0.8,
              delay: 0.1,
              threshold: 0.2
            }"
          >
            <span
              class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent"
            >
              Angular 3D
            </span>
          </h2>

          <!-- Subtitle -->
          <p
            class="text-2xl text-gray-300 leading-relaxed max-w-3xl mx-auto"
            viewportAnimation
            [viewportConfig]="{
              animation: 'fadeIn',
              duration: 0.8,
              delay: 0.2,
              threshold: 0.2
            }"
          >
            Pure Angular wrapper for Three.js with signal-based reactivity.
            <span class="block mt-2 text-indigo-400 font-semibold">
              Build immersive 3D experiences with familiar Angular patterns.
            </span>
          </p>

          <!-- Floating Metrics -->
          <div
            class="flex justify-center gap-12 mt-12"
            viewportAnimation
            [viewportConfig]="{
              animation: 'slideUp',
              duration: 0.8,
              delay: 0.3,
              threshold: 0.2
            }"
          >
            <div class="text-center">
              <div class="text-4xl font-bold text-indigo-400 mb-2">
                10+ Primitives
              </div>
              <div class="text-sm text-gray-400 uppercase tracking-wide">
                3D Components
              </div>
            </div>
            <div class="text-center">
              <div class="text-4xl font-bold text-purple-400 mb-2">
                Signal-Based
              </div>
              <div class="text-sm text-gray-400 uppercase tracking-wide">
                Reactivity
              </div>
            </div>
            <div class="text-center">
              <div class="text-4xl font-bold text-pink-400 mb-2">SSR-Safe</div>
              <div class="text-sm text-gray-400 uppercase tracking-wide">
                Server Compatible
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Feature Steps - Now using pre-made components! -->
      @for (step of codeTimeline(); track step.id; let i = $index) {
      <agsp-feature-step
        [layout]="step.layout === 'left' ? 'left' : 'right'"
        [stepNumber]="step.step"
        [pinDuration]="'400px'"
        [pinStart]="'top 15%'"
      >
        <!-- Decorations -->
        <div
          featureDecoration
          class="w-full h-full"
          [class.text-purple-400]="i === 0"
          [class.text-indigo-400]="i === 1"
          [class.text-purple-300]="i === 2"
          [class.text-indigo-300]="i === 3"
        >
          @if (i === 0) {
          <app-decorative-pattern [pattern]="'data-flow'" />
          } @else if (i === 1) {
          <app-decorative-pattern [pattern]="'network-nodes'" />
          } @else if (i === 2) {
          <app-decorative-pattern [pattern]="'circuit-board'" />
          } @else if (i === 3) {
          <app-decorative-pattern [pattern]="'gradient-blob'" />
          }
        </div>

        <!-- Step Badge -->
        <span
          featureBadge
          class="flex items-center justify-center w-14 h-14 rounded-full bg-gradient-to-br from-indigo-500 to-purple-600 text-white font-bold text-xl shadow-lg shadow-indigo-500/30"
        >
          {{ step.step }}
        </span>

        <!-- Title -->
        <h3
          featureTitle
          class="text-4xl lg:text-5xl font-bold text-white mb-6 leading-tight"
        >
          {{ step.title }}
        </h3>

        <!-- Description -->
        <p
          featureDescription
          class="text-lg text-gray-300 leading-relaxed mb-8"
        >
          {{ step.description }}
        </p>

        <!-- Notes -->
        <div featureNotes class="space-y-4">
          @for (note of step.notes; track $index) {
          <div class="flex items-start gap-3">
            <svg
              class="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="2"
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p class="text-sm text-gray-400">{{ note }}</p>
          </div>
          }
        </div>

        <!-- Visual -->
        <div featureVisual class="relative group overflow-hidden rounded-2xl">
          <!-- Glow backdrop -->
          <div
            class="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-purple-500/20 rounded-3xl blur-2xl scale-110 group-hover:scale-115 transition-transform duration-500"
          ></div>
          <div
            class="relative aspect-[4/3] w-[110%]  rounded-2xl overflow-hidden shadow-2xl shadow-indigo-500/20"
            [class.ml-auto]="step.layout === 'left'"
            [class.mr-auto]="step.layout === 'right'"
          >
            <img
              [ngSrc]="step.code"
              [alt]="step.title"
              fill
              class="object-cover transition-transform duration-500 group-hover:scale-105"
            />
            <!-- Subtle overlay gradient -->
            <div
              class="absolute inset-0 bg-gradient-to-t from-slate-900/40 via-transparent to-transparent pointer-events-none"
            ></div>
          </div>
        </div>
      </agsp-feature-step>
      }

      <!-- Footer Section - Integration Ecosystem -->
      <div featureFooter class="py-16">
        <div class="max-w-5xl mx-auto">
          <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
            @for (integration of integrations(); track integration.name) {
            <div
              class="integration-card bg-slate-800/80 backdrop-blur-sm rounded-xl p-6 border border-indigo-500/20 hover:border-indigo-500/40 hover:shadow-lg hover:shadow-indigo-500/10 transition-all duration-300"
            >
              <div class="text-4xl mb-3">{{ integration.icon }}</div>
              <h4 class="text-lg font-bold text-white mb-2">
                {{ integration.name }}
              </h4>
              <p class="text-sm text-gray-400">
                {{ integration.description }}
              </p>
            </div>
            }
          </div>
        </div>
      </div>
    </agsp-feature-showcase-timeline>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class Angular3dSectionComponent {
  /**
   * Angular 3D feature timeline
   * Based on @hive-academy/angular-3d library capabilities
   */
  public readonly codeTimeline = signal<TimelineStep[]>([
    {
      id: 'scene-container',
      step: 1,
      title: 'Scene3D - Zero-Config 3D Canvas',
      description:
        'The Scene3D component handles WebGL context, render loop, camera setup, and responsive sizing automatically. Simply declare your scene and let Angular 3D manage the complexity. Works with SSR out of the box with platform detection built-in.',
      code: 'images/showcase/angular-3d-step1.png',
      language: 'image',
      layout: 'left',
      notes: [
        'Automatic WebGL context management',
        'Built-in render loop with requestAnimationFrame',
        'Responsive canvas with resize handling',
        'SSR-safe with platform detection',
      ],
    },
    {
      id: 'primitives',
      step: 2,
      title: '10+ 3D Primitive Components',
      description:
        'Build complex 3D scenes using familiar Angular component patterns. Box, Sphere, Cylinder, Torus, Polyhedron, and more - all as declarative components with signal-based inputs for real-time updates. Full TypeScript type safety included.',
      code: 'images/showcase/angular-3d-step2.png',
      language: 'image',
      layout: 'right',
      notes: [
        'Declarative <app-box>, <app-sphere>, <app-torus>',
        'Signal-based inputs for reactive updates',
        'Position, rotation, scale as simple arrays',
        'Full Three.js mesh access when needed',
      ],
    },
    {
      id: 'animations',
      step: 3,
      title: 'GSAP-Powered 3D Animations',
      description:
        'Float3dDirective and Rotate3dDirective bring smooth GSAP animations to your 3D objects. Configure animation parameters with simple inputs - height, speed, easing. Play, pause, and control animations programmatically via public API.',
      code: 'images/showcase/angular-3d-hero.png',
      language: 'image',
      layout: 'left',
      notes: [
        'float3d directive for floating/bobbing',
        'rotate3d directive for continuous rotation',
        'Configurable speed, height, easing functions',
        'Full playback control: play(), pause(), stop()',
      ],
    },
    {
      id: 'advanced',
      step: 4,
      title: 'Advanced Primitives & Effects',
      description:
        'Beyond basic shapes, Angular 3D provides GltfModel for 3D models, StarField and Nebula for space scenes, ParticleSystem for effects, and SceneLighting for quick lighting setups. Build production-ready 3D experiences.',
      code: 'images/showcase/angular-gsap-hero.png',
      language: 'image',
      layout: 'right',
      notes: [
        'GLTF/GLB model loading with GltfModel',
        'Procedural StarField and Nebula components',
        'ParticleSystem for dynamic effects',
        'SceneLighting presets for quick setup',
      ],
    },
  ]);

  /**
   * Angular 3D ecosystem integrations
   */
  public readonly integrations = signal([
    {
      icon: '🎬',
      name: 'GSAP Animations',
      description:
        'Smooth float and rotate animations via Float3d and Rotate3d directives',
    },
    {
      icon: '📦',
      name: 'Three.js r150+',
      description: 'Full access to latest Three.js features and performance',
    },
    {
      icon: '🔄',
      name: 'Angular Signals',
      description: 'Reactive 3D property updates with signal-based inputs',
    },
  ]);
}
