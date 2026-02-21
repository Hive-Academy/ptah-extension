import { Component, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ScrollTimelineComponent,
  HijackedScrollItemDirective,
} from '@hive-academy/angular-gsap';

/**
 * Library Showcase Section - Fullpage Scroll Experience
 *
 * Showcases Angular 3D/GSAP libraries with:
 * - Fullpage hijacked scroll (one slide at a time)
 * - True fullscreen slides (100vh x 100vw)
 * - 50/50 split layout
 * - Sticky numbered sidebar navigation
 */
@Component({
  selector: 'app-value-propositions-section',
  imports: [CommonModule, ScrollTimelineComponent, HijackedScrollItemDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- Fullpage Scroll Timeline with Built-in Step Indicator -->
    <agsp-scroll-timeline
      [scrollHeightPerStep]="900"
      [start]="'top top'"
      [animationDuration]="0.8"
      [ease]="'power3.inOut'"
      [scrub]="1.5"
      [stepHold]="0.9"
      [showStepIndicator]="true"
      [stepIndicatorPosition]="'left'"
      (currentStepChange)="onStepChange($event)"
    >
        @for (section of librarySections(); track section.id; let i = $index) {
          <div
            hijackedScrollItem
            [slideDirection]="i % 2 === 0 ? 'left' : 'right'"
            [fadeIn]="true"
            [scale]="true"
          >
            <!-- FULLSCREEN SLIDE -->
            <div class="h-screen w-screen flex overflow-hidden bg-gradient-to-b from-slate-950 via-slate-900 to-slate-950">
              <!-- Left Column (Content or Visual based on index) -->
              <div
                class="w-1/2 h-full flex items-center"
                [class.justify-end]="i % 2 === 0"
                [class.justify-start]="i % 2 !== 0"
              >
                @if (i % 2 === 0) {
                  <!-- Content on left -->
                  <div class="w-full max-w-2xl px-8 lg:px-16 lg:pl-24">
                    <ng-container *ngTemplateOutlet="contentTemplate; context: { $implicit: section, index: i }" />
                  </div>
                } @else {
                  <!-- Visual on left -->
                  <div class="w-full h-full flex items-center justify-center p-8 lg:p-16">
                    <ng-container *ngTemplateOutlet="visualTemplate; context: { $implicit: section }" />
                  </div>
                }
              </div>

              <!-- Right Column -->
              <div
                class="w-1/2 h-full flex items-center"
                [class.justify-start]="i % 2 === 0"
                [class.justify-end]="i % 2 !== 0"
              >
                @if (i % 2 === 0) {
                  <!-- Visual on right -->
                  <div class="w-full h-full flex items-center justify-center p-8 lg:p-16">
                    <ng-container *ngTemplateOutlet="visualTemplate; context: { $implicit: section }" />
                  </div>
                } @else {
                  <!-- Content on right -->
                  <div class="w-full max-w-2xl px-8 lg:px-16 lg:pr-24">
                    <ng-container *ngTemplateOutlet="contentTemplate; context: { $implicit: section, index: i }" />
                  </div>
                }
              </div>

              <!-- Background glow -->
              <div class="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
                <div
                  class="absolute w-[600px] h-[600px] rounded-full blur-[150px] opacity-20"
                  [class.left-1/4]="i % 2 === 0"
                  [class.right-1/4]="i % 2 !== 0"
                  [class.top-1/4]="i % 3 === 0"
                  [class.bottom-1/4]="i % 3 !== 0"
                  [class.bg-indigo-500]="i % 2 === 0"
                  [class.bg-violet-500]="i % 2 !== 0"
                ></div>
              </div>
            </div>
          </div>
        }
      </agsp-scroll-timeline>

      <!-- Content Template -->
      <ng-template #contentTemplate let-section let-index="index">
        <!-- Section Number -->
        <div class="flex items-center gap-4 mb-6">
          <span class="text-7xl font-black bg-gradient-to-br from-indigo-400 to-violet-500 bg-clip-text text-transparent leading-none">
            {{ (index + 1).toString().padStart(2, '0') }}
          </span>
          <div class="h-px flex-1 bg-gradient-to-r from-indigo-500/50 to-transparent"></div>
        </div>

        <!-- Package Name -->
        <p class="text-sm font-mono text-indigo-400 uppercase tracking-widest mb-4">
          {{ section.packageName }}
        </p>

        <!-- Headline -->
        <h2 class="text-4xl lg:text-5xl xl:text-6xl font-bold text-white leading-tight mb-6">
          {{ section.businessHeadline }}
        </h2>

        <!-- Description -->
        <p class="text-lg lg:text-xl text-slate-300 leading-relaxed mb-8">
          {{ section.solution }}
        </p>

        <!-- Capabilities Grid -->
        <div class="grid grid-cols-2 gap-3 mb-8">
          @for (capability of section.capabilities; track capability) {
            <div class="flex items-center gap-3 p-3 rounded-xl bg-slate-800/60 border border-slate-700/50 backdrop-blur-sm">
              <svg class="w-5 h-5 text-indigo-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
              </svg>
              <span class="text-sm text-slate-200">{{ capability }}</span>
            </div>
          }
        </div>

        <!-- Metric Badge -->
        <div class="inline-flex items-center gap-4 px-6 py-4 bg-gradient-to-r from-indigo-500/20 to-violet-500/20 rounded-2xl border border-indigo-500/30 backdrop-blur-sm">
          <div class="text-4xl font-black bg-gradient-to-br from-indigo-400 to-violet-500 bg-clip-text text-transparent">
            {{ section.metricValue }}
          </div>
          <div>
            <div class="text-sm font-bold text-white">{{ section.metricLabel }}</div>
            <div class="text-xs text-slate-400">vs traditional approach</div>
          </div>
        </div>
      </ng-template>

      <!-- Visual Template -->
      <ng-template #visualTemplate let-section>
        <div class="relative w-full max-w-lg aspect-square">
          <!-- Glow backdrop -->
          <div class="absolute inset-0 bg-gradient-to-br from-indigo-500/20 to-violet-500/20 rounded-3xl blur-2xl scale-110"></div>
          <!-- Card -->
          <div class="relative w-full h-full rounded-3xl bg-slate-800/60 border border-slate-700/50 backdrop-blur-md flex items-center justify-center">
            <div class="text-center p-8">
              <div class="text-9xl mb-8">{{ section.icon }}</div>
              <p class="text-xl font-semibold text-white mb-3">{{ section.visualTitle }}</p>
              <p class="text-base text-slate-400">{{ section.visualSubtitle }}</p>
            </div>
          </div>
        </div>
      </ng-template>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ValuePropositionsSectionComponent {
  // Step tracking state (synced from ScrollTimelineComponent)
  public readonly currentStep = signal(0);

  /**
   * Handle step change from scroll timeline
   */
  public onStepChange(step: number): void {
    this.currentStep.set(step);
  }

  /**
   * Library Showcase Sections
   */
  public readonly librarySections = signal([
    {
      id: 'angular-3d',
      packageName: '@hive-academy/angular-3d',
      businessHeadline: 'Three.js Made Angular-Native',
      solution:
        'Pure Angular components with signal-based inputs, automatic resource cleanup, and declarative scene composition. Write 3D scenes like Angular templates.',
      capabilities: [
        'Signal-based reactive inputs',
        'NG_3D_PARENT hierarchy',
        'Automatic dispose() cleanup',
        'OnPush change detection',
      ],
      metricValue: '10+',
      metricLabel: '3D Primitives',
      icon: '🎮',
      visualTitle: 'Scene3D Component',
      visualSubtitle: 'WebGL canvas with automatic resize',
    },
    {
      id: 'angular-gsap',
      packageName: '@hive-academy/angular-gsap',
      businessHeadline: 'GSAP Animations, Angular Style',
      solution:
        'Declarative directives for scroll-triggered animations, hijacked scroll sequences, and smooth scrolling. SSR-safe with automatic browser detection.',
      capabilities: [
        'ScrollAnimationDirective',
        'HijackedScrollTimeline',
        'LenisSmoothScroll',
        'SSR-safe detection',
      ],
      metricValue: '6+',
      metricLabel: 'Animation Directives',
      icon: '✨',
      visualTitle: 'Scroll Animations',
      visualSubtitle: 'Butter-smooth transitions',
    },
    {
      id: 'nx-workspace',
      packageName: 'Nx Monorepo',
      businessHeadline: 'Enterprise Architecture',
      solution:
        'Nx monorepo with intelligent task caching, project graph visualization, and affected-only testing.',
      capabilities: [
        'Nx 22+ project graph',
        'Affected-only test runs',
        'Shared library architecture',
        'Automated updates',
      ],
      metricValue: '80%',
      metricLabel: 'Faster CI Builds',
      icon: '🏗️',
      visualTitle: 'Project Graph',
      visualSubtitle: 'Visualize dependencies',
    },
    {
      id: 'signals',
      packageName: 'Angular Signals',
      businessHeadline: 'Fine-Grained Reactivity',
      solution:
        'Signal-based state management with computed() for derived values. Components re-render only when signals change.',
      capabilities: [
        'signal() for state',
        'computed() derived values',
        'effect() side effects',
        'input() signal inputs',
      ],
      metricValue: '100%',
      metricLabel: 'Signal-Based',
      icon: '📡',
      visualTitle: 'Reactive Primitives',
      visualSubtitle: 'Fine-grained updates',
    },
    {
      id: 'hierarchy',
      packageName: 'NG_3D_PARENT Token',
      businessHeadline: 'Parent-Child 3D Communication',
      solution:
        'Injection token pattern where child components automatically receive parent Object3D reference.',
      capabilities: [
        'NG_3D_PARENT injection',
        'Automatic scene graph',
        'Declarative hierarchy',
        'Type-safe references',
      ],
      metricValue: '0',
      metricLabel: 'Manual Wiring',
      icon: '🌳',
      visualTitle: 'Scene Hierarchy',
      visualSubtitle: 'Declarative composition',
    },
    {
      id: 'animation-directives',
      packageName: 'Animation Directives',
      businessHeadline: 'Declarative 3D Animations',
      solution:
        'Apply animations with directives: float3d for bobbing, rotate3d for spinning. All with automatic cleanup.',
      capabilities: [
        'Float3dDirective',
        'Rotate3dDirective',
        'Configurable axis/speed',
        'DestroyRef cleanup',
      ],
      metricValue: '1 Line',
      metricLabel: 'Per Animation',
      icon: '🎭',
      visualTitle: 'Directive Animations',
      visualSubtitle: 'Add motion declaratively',
    },
    {
      id: 'ssr-safety',
      packageName: 'SSR Compatibility',
      businessHeadline: 'Server-Side Rendering Safe',
      solution:
        'Platform detection with isPlatformBrowser(), afterNextRender() for browser-only code.',
      capabilities: [
        'isPlatformBrowser() guards',
        'afterNextRender() timing',
        'PLATFORM_ID injection',
        'Graceful SSR fallbacks',
      ],
      metricValue: '100%',
      metricLabel: 'SSR Compatible',
      icon: '🖥️',
      visualTitle: 'Universal Apps',
      visualSubtitle: 'Works everywhere',
    },
    {
      id: 'onpush',
      packageName: 'OnPush Strategy',
      businessHeadline: 'Optimized Change Detection',
      solution:
        'All components use OnPush change detection, only updating when inputs change.',
      capabilities: [
        'ChangeDetectionStrategy.OnPush',
        'Signal-triggered updates',
        'Minimal re-renders',
        '60fps 3D performance',
      ],
      metricValue: '60',
      metricLabel: 'FPS Target',
      icon: '⚡',
      visualTitle: 'Performance First',
      visualSubtitle: 'Optimized rendering',
    },
    {
      id: 'cleanup',
      packageName: 'Resource Cleanup',
      businessHeadline: 'Zero Memory Leaks',
      solution:
        'Automatic resource tracking with dispose() called on destroy. DestroyRef for subscription cleanup.',
      capabilities: [
        'Automatic dispose()',
        'DestroyRef subscriptions',
        'GPU memory cleanup',
        'Animation cleanup',
      ],
      metricValue: '0',
      metricLabel: 'Memory Leaks',
      icon: '🧹',
      visualTitle: 'Auto Cleanup',
      visualSubtitle: 'Dispose on destroy',
    },
    {
      id: 'testing',
      packageName: 'Testing Strategy',
      businessHeadline: 'Comprehensive Test Coverage',
      solution:
        'Co-located spec files with Jest, mocked Three.js objects, and TestBed setup utilities.',
      capabilities: [
        'Jest unit tests',
        'Co-located *.spec.ts',
        'Three.js mocking',
        'Component TestBed',
      ],
      metricValue: '80%+',
      metricLabel: 'Coverage Target',
      icon: '🧪',
      visualTitle: 'Test Coverage',
      visualSubtitle: 'Reliable components',
    },
  ]);
}
