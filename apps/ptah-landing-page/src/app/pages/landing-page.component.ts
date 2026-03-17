import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavigationComponent } from '../components/navigation.component';
import { ComparisonSectionComponent } from '../sections/comparison/comparison-section.component';
import { CTASectionComponent } from '../sections/cta/cta-section.component';
import { FooterComponent } from '../components/footer.component';
import { FeaturesHijackedScrollComponent } from '../sections/features/features-hijacked-scroll.component';
import { HeroComponent } from '../sections/hero/hero.component';
import { PremiumShowcaseScrollComponent } from '../sections/premium-showcase/premium-showcase-scroll.component';

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
    PremiumShowcaseScrollComponent,
    FeaturesHijackedScrollComponent,
    ComparisonSectionComponent,
    CTASectionComponent,
    FooterComponent,
  ],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <!-- Fixed Navigation -->
      <ptah-navigation />

      <!-- Main Content Sections -->
      <main>
        <ptah-hero />

        <section id="premium-showcase" aria-label="Why Ptah">
          <ptah-premium-showcase-scroll />
        </section>

        <section id="features" aria-label="Features">
          <ptah-features-hijacked-scroll />
        </section>

        <ptah-comparison-section />
        <ptah-cta-section />
      </main>

      <ptah-footer />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        overflow-x: hidden;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LandingPageComponent {}
