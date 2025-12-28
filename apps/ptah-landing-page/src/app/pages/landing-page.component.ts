import {
  Component,
  ChangeDetectionStrategy,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { NavigationComponent } from '../components/navigation.component';
import { HeroSectionComponent } from '../sections/hero/hero-section.component';
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
 * - ✅ Single Responsibility: Only composes sections and initializes session data
 * - ✅ Open/Closed: New sections can be added via composition
 * - ✅ Composition Over Inheritance: Uses child components, no inheritance
 * - ✅ Dependency Inversion: Depends on StaticSessionProvider abstraction
 *
 * Patterns Applied:
 * - Composition Pattern: Composes NavigationComponent + 5 section components
 * - Container Pattern: Manages page-level concerns (session loading)
 * - Signal-Based State: Leverages signals from StaticSessionProvider
 *
 * Architecture:
 * ```
 * LandingPageComponent (Container)
 * ├── NavigationComponent (Fixed Header)
 * └── main
 *     ├── HeroSectionComponent (Full viewport with Three.js)
 *     ├── DemoSectionComponent (Live chat demo)
 *     ├── FeaturesSectionComponent (Features grid)
 *     ├── ComparisonSectionComponent (Before/After)
 *     └── CTASectionComponent (Final CTA + Footer)
 * ```
 *
 * Lifecycle:
 * - OnInit: Pre-load demo session data via StaticSessionProvider
 * - Session data flows reactively to DemoSectionComponent
 * - All GSAP animations managed by individual sections
 *
 * Design Spec Compliance:
 * - Anubis theme (DaisyUI)
 * - Smooth scroll behavior
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
    HeroSectionComponent,
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
        <!-- Hero Section: Full viewport with Egyptian theme -->
        <ptah-hero-section />

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
}
