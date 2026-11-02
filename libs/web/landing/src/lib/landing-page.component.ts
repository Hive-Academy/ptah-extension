import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { SeoService } from '@ptah-web/core';
import { NavigationComponent } from '@ptah-web/ui';
import { ComparisonSectionComponent } from './sections/comparison/comparison-section.component';
import { CTASectionComponent } from './sections/cta/cta-section.component';
import { FooterComponent } from '@ptah-web/ui';
import { HeroComponent } from './sections/hero/hero.component';
import { ProblemSectionComponent } from './sections/problem/problem-section.component';
import { PillarsSpineComponent } from './sections/pillars/pillars-spine.component';
import { ProviderStripComponent } from './sections/provider-strip/provider-strip.component';

@Component({
  selector: 'ptah-landing-page',
  standalone: true,
  imports: [
    NavigationComponent,
    HeroComponent,
    ProblemSectionComponent,
    PillarsSpineComponent,
    ProviderStripComponent,
    ComparisonSectionComponent,
    CTASectionComponent,
    FooterComponent,
  ],
  template: `
    <div class="min-h-screen bg-ink-950 text-ink-100">
      <ptah-navigation />

      <main>
        <ptah-hero />
        <ptah-problem-section />

        <!--
          Render eagerly so SEO copy ships in the prerendered static HTML.
          Entrance animations apply their from-state only after hydration.
        -->
        <ptah-pillars-spine />
        <ptah-provider-strip />
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
export class LandingPageComponent {
  constructor() {
    inject(SeoService).setPage({
      title: 'PtahCode — It Knows Your Architecture. It Ships the SaaS.',
      description:
        'The AI dev team that ships production-shaped SaaS — multi-tenant, billing-integrated, security-reviewed, and architecturally consistent from the first commit. Free and open source.',
      url: 'https://ptah.live',
      ogTitle: 'PtahCode — It Knows Your Architecture. It Ships the SaaS.',
      ogDescription:
        'The AI dev team that ships production-shaped SaaS — multi-tenant, billing-integrated, security-reviewed, and architecturally consistent from the first commit. Free and open source.',
    });
  }
}
