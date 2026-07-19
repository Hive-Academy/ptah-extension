import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SeoService } from '../services/seo.service';
import { NavigationComponent } from '../components/navigation.component';
import { ComparisonSectionComponent } from '../sections/comparison/comparison-section.component';
import { CTASectionComponent } from '../sections/cta/cta-section.component';
import { FooterComponent } from '../components/footer.component';
import { HeroComponent } from '../sections/hero/hero.component';
import { ProblemSectionComponent } from '../sections/problem/problem-section.component';
import { VideoShowcaseComponent } from '../sections/video-showcase/video-showcase.component';
import { PillarsSpineComponent } from '../sections/pillars/pillars-spine.component';
import { ProviderStripComponent } from '../sections/provider-strip/provider-strip.component';
import { BuildersSectionComponent } from '../sections/builders/builders-section.component';
import { AlsoAvailableComponent } from '../sections/also-available/also-available.component';

@Component({
  selector: 'ptah-landing-page',
  standalone: true,
  imports: [
    NavigationComponent,
    HeroComponent,
    ProblemSectionComponent,
    VideoShowcaseComponent,
    PillarsSpineComponent,
    ProviderStripComponent,
    ComparisonSectionComponent,
    BuildersSectionComponent,
    AlsoAvailableComponent,
    CTASectionComponent,
    FooterComponent,
  ],
  template: `
    <div class="min-h-screen bg-ink-950 text-ink-100">
      <ptah-navigation />

      <main>
        <!-- S1 Promise -->
        <ptah-hero />

        <!-- S2 Problem -->
        <ptah-problem-section />

        <!-- S3 Demo -->
        <ptah-video-showcase />

        <!--
          S4–S7 render eagerly (not @defer) so their SEO/GEO-bearing copy and
          citable claims ship in the prerendered static HTML. They are lightweight
          coded DOM (no images), and their entrance animations are SSG-safe
          (final DOM state fully opaque; the from-state is applied post-hydration).
        -->
        <ptah-pillars-spine />

        <ptah-provider-strip />

        <!-- S8 Comparison -->
        <ptah-comparison-section />

        <!-- S8.5 Ptah Builders -->
        <ptah-builders-section />

        <!-- S9 Also Available (single VS Code / CLI mention) -->
        <ptah-also-available />

        <!-- S10 Final CTA -->
        <ptah-cta-section />
      </main>

      <!-- S11 Footer -->
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
export class LandingPageComponent {
  constructor() {
    inject(SeoService).setPage({
      title: 'Ptah — It Knows Your Architecture. It Ships the SaaS.',
      description:
        'The AI dev team that ships production-shaped SaaS — multi-tenant, billing-integrated, security-reviewed, and architecturally consistent from the first commit. Free and open source.',
      url: 'https://ptah.live',
      ogTitle: 'Ptah — It Knows Your Architecture. It Ships the SaaS.',
      ogDescription:
        'The AI dev team that ships production-shaped SaaS — multi-tenant, billing-integrated, security-reviewed, and architecturally consistent from the first commit. Free and open source.',
    });
  }
}
