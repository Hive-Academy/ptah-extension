import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
  afterNextRender,
  DestroyRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { LenisSmoothScrollService } from '@hive-academy/angular-gsap';
import { NavigationComponent } from '../components/navigation.component';
import { HeroComponent } from '../sections/hero/hero.component';
import { DemoSectionComponent } from '../sections/demo/demo-section.component';
import { FeaturesSectionComponent } from '../sections/features/features-section.component';
import { ComparisonSectionComponent } from '../sections/comparison/comparison-section.component';
import { CTASectionComponent } from '../sections/cta/cta-section.component';
import { StaticSessionProvider } from '../services/static-session.provider';

/**
 * LandingPageComponent - Root page component that composes all landing page sections
 *
 * Complexity Level: 2 (Medium - Composition of multiple child components with lifecycle management)
 *
 * Single Responsibility: Compose and orchestrate all landing page sections with session data initialization
 *
 * SOLID Principles Applied:
 * - Single Responsibility: Only composes sections, initializes session data, and manages Lenis scroll
 * - Open/Closed: New sections can be added via composition
 * - Composition Over Inheritance: Uses child components, no inheritance
 * - Dependency Inversion: Depends on StaticSessionProvider and LenisSmoothScrollService abstractions
 *
 * Batch 5 Enhancements (Task 5.2):
 * - Lenis smooth scroll initialization via LenisSmoothScrollService
 * - afterNextRender() for client-side only initialization
 * - DestroyRef.onDestroy() for cleanup (handled automatically by service)
 *
 * Patterns Applied:
 * - Composition Pattern: Composes NavigationComponent + 5 section components
 * - Container Pattern: Manages page-level concerns (session loading, scroll)
 * - Signal-Based State: Leverages signals from StaticSessionProvider and LenisSmoothScrollService
 *
 * Architecture:
 * ```
 * LandingPageComponent (Container)
 * ├── NavigationComponent (Fixed Header)
 * └── main
 *     ├── HeroSectionComponent (Full viewport with @hive-academy/angular-3d)
 *     ├── DemoSectionComponent (Live chat demo)
 *     ├── FeaturesSectionComponent (Hijacked scroll timeline)
 *     ├── ComparisonSectionComponent (Parallax split scroll)
 *     └── CTASectionComponent (Final CTA + Footer)
 * ```
 *
 * Lifecycle:
 * - afterNextRender: Initialize Lenis smooth scroll (client-side only)
 * - OnInit: Pre-load demo session data via StaticSessionProvider
 * - Session data flows reactively to DemoSectionComponent
 * - Lenis service handles cleanup automatically via ngOnDestroy
 *
 * Design Spec Compliance:
 * - Anubis theme (DaisyUI)
 * - Lenis smooth scroll for premium feel
 * - Responsive layout (mobile-first)
 * - Accessibility: Semantic HTML structure
 *
 * @example
 * ```typescript
 * // Usage in app.ts
 * import { LandingPageComponent } from './pages/landing-page.component';
 *
 * @Component({
 *   selector: 'app-root',
 *   template: `<ptah-landing-page />`,
 *   imports: [LandingPageComponent]
 * })
 * export class App {}
 * ```
 */
@Component({
  selector: 'ptah-landing-page',
  standalone: true,
  imports: [
    CommonModule,
    NavigationComponent,
    HeroComponent,
    DemoSectionComponent,
    FeaturesSectionComponent,
    ComparisonSectionComponent,
    CTASectionComponent,
  ],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <!-- Fixed Navigation -->
      <ptah-navigation />

      <!-- Main Content Sections -->
      <main>
        <!-- Hero Section: Full viewport with Three.js -->
        <ptah-hero />

        <!-- Demo Section: Live chat interface showcase -->
        <ptah-demo-section />

        <!-- Features Section: Workspace-intelligence & LM Tools -->
        <ptah-features-section />

        <!-- Comparison Section: Before/After CLI vs Ptah -->
        <ptah-comparison-section />

        <!-- CTA Section: Final call-to-action + footer -->
        <ptah-cta-section />
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      /* Smooth scroll behavior for the entire page */
      :host ::ng-deep html {
        scroll-behavior: smooth;
      }

      /* Respect prefers-reduced-motion */
      @media (prefers-reduced-motion: reduce) {
        :host ::ng-deep html {
          scroll-behavior: auto;
        }
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPageComponent implements OnInit {
  // ============================================================================
  // DEPENDENCY INJECTION
  // ============================================================================
  // Pattern: inject() function for service dependencies
  // Evidence: All section components use this pattern

  private readonly sessionProvider = inject(StaticSessionProvider);
  private readonly lenisService = inject(LenisSmoothScrollService);
  private readonly destroyRef = inject(DestroyRef);

  // ============================================================================
  // CONSTRUCTOR - LENIS INITIALIZATION
  // ============================================================================

  constructor() {
    // Initialize Lenis smooth scroll after first render (client-side only)
    // This ensures the DOM is ready and we're in a browser environment
    afterNextRender(() => {
      this.initLenisScroll();
    });
  }

  // ============================================================================
  // LIFECYCLE HOOKS
  // ============================================================================

  /**
   * Initialize component and pre-load demo session data
   *
   * Why OnInit?
   * - Session data must load before DemoSectionComponent renders
   * - Async loading allows progressive page display
   * - Errors handled gracefully by StaticSessionProvider
   *
   * Session Loading Strategy:
   * - Load /assets/demo-sessions/sample.json
   * - StaticSessionProvider signals notify child components reactively
   * - DemoSectionComponent subscribes to sessionProvider.messages()
   * - Loading/error states handled by provider
   */
  ngOnInit(): void {
    // Pre-load demo session data
    // Path: public/assets/demo-sessions/sample.json (Task 3)
    this.sessionProvider.loadSession('/assets/demo-sessions/sample.json');
  }

  // ============================================================================
  // PRIVATE METHODS
  // ============================================================================

  /**
   * Initialize Lenis smooth scroll service
   *
   * Task 5.2: Lenis Smooth Scroll Integration
   * - Uses LenisSmoothScrollService from @hive-academy/angular-gsap
   * - Configuration is provided globally via provideLenis() in app.config.ts
   * - Service handles ScrollTrigger integration and cleanup automatically
   *
   * Accessibility:
   * - Lenis respects prefers-reduced-motion media query internally
   * - Native scroll behavior preserved for accessibility
   */
  private async initLenisScroll(): Promise<void> {
    try {
      // Initialize Lenis with default options (configured in app.config.ts)
      // The service will:
      // - Create Lenis instance with configured lerp and wheelMultiplier
      // - Integrate with GSAP ticker for smooth updates
      // - Connect with ScrollTrigger for animation coordination
      await this.lenisService.initialize();

      // Register cleanup on component destroy (though service handles its own cleanup)
      this.destroyRef.onDestroy(() => {
        // LenisSmoothScrollService implements OnDestroy and handles cleanup
        // This is here for explicit documentation of the cleanup chain
      });
    } catch (error) {
      // Lenis initialization may fail in SSR or restricted environments
      // Graceful degradation: native scroll behavior continues to work
      console.warn('Lenis smooth scroll initialization skipped:', error);
    }
  }
}
