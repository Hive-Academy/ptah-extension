import { Component, ChangeDetectionStrategy, signal } from '@angular/core';
import {
  ScrollAnimationDirective,
  ViewportAnimationDirective,
  HijackedScrollDirective,
  HijackedScrollItemDirective,
  ScrollSectionPinDirective,
} from '@hive-academy/angular-gsap';

/**
 * Animation Component Template
 *
 * This template provides a starting point for creating professional scroll
 * animations using the @hive-academy/angular-gsap library.
 *
 * CUSTOMIZATION CHECKLIST:
 * 1. Update selector and class name
 * 2. Import only directives used in template
 * 3. Configure viewport and scroll animations
 * 4. Set up parallax backgrounds
 * 5. Add hijacked scroll if needed
 * 6. Customize timing and easing
 * 7. Add accessibility (reduced motion support)
 * 8. Update host styles if needed
 */
@Component({
  selector: 'app-my-animation',
  standalone: true,
  imports: [
    ScrollAnimationDirective,
    ViewportAnimationDirective,
    HijackedScrollDirective,
    HijackedScrollItemDirective,
    ScrollSectionPinDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="relative">

      <!-- ============================================
           PARALLAX BACKGROUND LAYER
           ============================================ -->

      <!-- Background moves at 40% scroll speed -->
      <div
        scrollAnimation
        [scrollConfig]="{
          animation: 'parallax',
          speed: 0.4,
          scrub: 1.5,
          ease: 'none'
        }"
        class="absolute inset-0 -z-10">
        <img
          src="/assets/background.jpg"
          alt="Background"
          class="w-full h-full object-cover" />
      </div>

      <!-- ============================================
           AMBIENT GLOW BACKGROUNDS
           ============================================ -->

      <div class="absolute inset-0 pointer-events-none -z-5">
        <!-- Primary glow -->
        <div
          class="absolute top-1/4 left-1/4 w-[500px] h-[500px]
                 bg-indigo-500/10 rounded-full blur-[120px]">
        </div>

        <!-- Secondary glow -->
        <div
          class="absolute bottom-1/3 right-1/4 w-[400px] h-[400px]
                 bg-purple-500/10 rounded-full blur-[100px]">
        </div>
      </div>

      <!-- ============================================
           HERO SECTION - STAGGERED ENTRANCE
           ============================================ -->

      <section class="relative min-h-screen flex items-center justify-center">
        <div class="text-center max-w-4xl px-6">

          <!-- Badge - Scale in -->
          <div
            viewportAnimation
            [viewportConfig]="{
              animation: 'scaleIn',
              duration: 0.6,
              threshold: 0.1
            }"
            class="inline-flex items-center gap-2 px-4 py-2 mb-6
                   bg-gradient-to-r from-indigo-500/20 to-purple-500/20
                   rounded-full border border-indigo-500/30">
            <span class="text-sm font-semibold text-indigo-300">
              New Feature
            </span>
          </div>

          <!-- Main Headline - Slide up with gradient -->
          <h1
            viewportAnimation
            [viewportConfig]="{
              animation: 'slideUp',
              duration: 0.8,
              delay: 0.1,
              threshold: 0.1
            }"
            class="text-5xl md:text-7xl font-bold mb-6">
            <span
              class="bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400
                     bg-clip-text text-transparent">
              Amazing Scroll Animations
            </span>
          </h1>

          <!-- Subtitle - Fade in -->
          <p
            viewportAnimation
            [viewportConfig]="{
              animation: 'fadeIn',
              duration: 0.8,
              delay: 0.2,
              threshold: 0.1
            }"
            class="text-xl md:text-2xl text-gray-300 mb-8">
            Create stunning scroll experiences with GSAP and Angular
          </p>

          <!-- CTA Buttons - Slide up -->
          <div
            viewportAnimation
            [viewportConfig]="{
              animation: 'slideUp',
              duration: 0.6,
              delay: 0.3,
              threshold: 0.1
            }"
            class="flex gap-4 justify-center">
            <button
              class="px-8 py-3 bg-indigo-500 text-white rounded-lg
                     font-semibold hover:bg-indigo-600 transition-colors">
              Get Started
            </button>
            <button
              class="px-8 py-3 bg-slate-700 text-white rounded-lg
                     font-semibold hover:bg-slate-600 transition-colors">
              Learn More
            </button>
          </div>

        </div>

        <!-- Hero Fade-Out on Scroll -->
        <div
          scrollAnimation
          [scrollConfig]="{
            animation: 'custom',
            start: 'top 20%',
            end: 'bottom 60%',
            scrub: 1.2,
            from: { opacity: 1, y: 0 },
            to: { opacity: 0, y: -150 }
          }"
          class="absolute inset-0 pointer-events-none">
        </div>
      </section>

      <!-- ============================================
           FEATURES SECTION - STAGGERED CARDS
           ============================================ -->

      <section class="relative py-24 px-6">
        <div class="max-w-6xl mx-auto">

          <!-- Section Header -->
          <div class="text-center mb-16">
            <h2
              viewportAnimation
              [viewportConfig]="{
                animation: 'slideUp',
                duration: 0.8,
                threshold: 0.2
              }"
              class="text-4xl md:text-5xl font-bold text-white mb-4">
              Why Use This Library?
            </h2>

            <p
              viewportAnimation
              [viewportConfig]="{
                animation: 'fadeIn',
                duration: 0.8,
                delay: 0.1,
                threshold: 0.2
              }"
              class="text-xl text-gray-400">
              Professional animations with minimal effort
            </p>
          </div>

          <!-- Feature Cards Grid - Staggered with Bounce -->
          <div
            class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">

            @for (feature of features(); track feature.title; let i = $index) {
              <div
                viewportAnimation
                [viewportConfig]="{
                  animation: 'slideUp',
                  duration: 0.6,
                  delay: i * 0.1,
                  ease: 'back.out(1.7)',
                  threshold: 0.2
                }"
                class="p-6 rounded-2xl bg-slate-800/60
                       border border-slate-700/50 backdrop-blur-md">

                <!-- Icon -->
                <div class="text-5xl mb-4">{{ feature.icon }}</div>

                <!-- Title -->
                <h3 class="text-xl font-bold text-white mb-2">
                  {{ feature.title }}
                </h3>

                <!-- Description -->
                <p class="text-sm text-gray-400">
                  {{ feature.description }}
                </p>

              </div>
            }

          </div>

        </div>
      </section>

      <!-- ============================================
           PINNED SECTION EXAMPLE
           ============================================ -->

      <section
        scrollSectionPin
        [pinDuration]="'500px'"
        [start]="'top center'"
        class="relative py-24 bg-slate-900">

        <div class="max-w-4xl mx-auto text-center">
          <h2 class="text-4xl font-bold text-white mb-6">
            Pinned Section
          </h2>

          <p class="text-xl text-gray-300">
            This section stays pinned for 500px of scroll
          </p>
        </div>

      </section>

      <!-- ============================================
           STAGGERED LIST ITEMS
           ============================================ -->

      <section class="relative py-24 px-6">
        <div class="max-w-3xl mx-auto">

          <h2
            viewportAnimation
            [viewportConfig]="{
              animation: 'slideUp',
              duration: 0.8,
              threshold: 0.2
            }"
            class="text-3xl font-bold text-white mb-8">
            Key Benefits
          </h2>

          <!-- Staggered Pills -->
          <div class="flex flex-wrap gap-3">
            @for (benefit of benefits(); track benefit; let i = $index) {
              <div
                viewportAnimation
                [viewportConfig]="{
                  animation: 'slideUp',
                  duration: 0.5,
                  delay: i * 0.08,
                  threshold: 0.2
                }"
                class="px-4 py-2 bg-slate-800/60 border border-slate-700/50
                       rounded-xl text-sm text-slate-200">
                {{ benefit }}
              </div>
            }
          </div>

        </div>
      </section>

      <!-- ============================================
           OPTIONAL: HIJACKED SCROLL EXAMPLE
           ============================================
           Uncomment to use fullpage scroll presentation
           ============================================ -->

      <!--
      <agsp-hijacked-scroll-timeline
        [scrollHeightPerStep]="900"
        [animationDuration]="0.8"
        [ease]="'power3.inOut'"
        [scrub]="1.5"
        [stepHold]="0.9"
        (currentStepChange)="onStepChange($event)">

        <div hijackedScrollItem
             [slideDirection]="'left'"
             [fadeIn]="true"
             [scale]="true">
          <div class="h-screen flex items-center justify-center">
            <h2 class="text-6xl font-bold text-white">Step 1</h2>
          </div>
        </div>

        <div hijackedScrollItem
             [slideDirection]="'right'"
             [fadeIn]="true"
             [scale]="true">
          <div class="h-screen flex items-center justify-center">
            <h2 class="text-6xl font-bold text-white">Step 2</h2>
          </div>
        </div>

      </agsp-hijacked-scroll-timeline>
      -->

    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      background: linear-gradient(to bottom, #0f172a, #1e293b, #0f172a);
    }
  `,
})
export class MyAnimationComponent {
  // ============================================
  // SAMPLE DATA
  // ============================================

  features = signal([
    {
      icon: '⚡',
      title: 'Fast Performance',
      description: 'Optimized GSAP animations with minimal overhead',
    },
    {
      icon: '🎨',
      title: 'Beautiful Visuals',
      description: 'Smooth, professional scroll experiences',
    },
    {
      icon: '🔧',
      title: 'Easy to Use',
      description: 'Declarative API with Angular directives',
    },
    {
      icon: '📱',
      title: 'SSR Compatible',
      description: 'Works perfectly with server-side rendering',
    },
  ]);

  benefits = signal([
    'Declarative API',
    'SSR Compatible',
    'Type-Safe',
    'Zero Dependencies',
    'Production Ready',
    'Accessible',
    'Performant',
    'Customizable',
  ]);

  // ============================================
  // OPTIONAL: REDUCED MOTION SUPPORT
  // ============================================

  // Uncomment to add accessibility support
  /*
  private mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  prefersReducedMotion = signal(this.mediaQuery.matches);

  constructor() {
    this.mediaQuery.addEventListener('change', (e) => {
      this.prefersReducedMotion.set(e.matches);
    });
  }

  getAnimationConfig(baseConfig: ViewportAnimationConfig): ViewportAnimationConfig {
    if (this.prefersReducedMotion()) {
      return {
        ...baseConfig,
        duration: 0.1,
        ease: 'none'
      };
    }
    return baseConfig;
  }
  */

  // ============================================
  // OPTIONAL: HIJACKED SCROLL EVENT HANDLER
  // ============================================

  onStepChange(index: number) {
    console.log('Current step:', index);
  }
}
