import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { SeoService } from '../../services/seo.service';
import { NavigationComponent } from '../../components/navigation.component';
import { FooterComponent } from '../../components/footer.component';
import { PricingHeroComponent } from './components/pricing-hero.component';
import { PricingGridComponent } from './components/pricing-grid.component';

/**
 * PricingPageComponent - Main pricing page container
 *
 * Composes navigation, hero section and pricing grid.
 * The Pro plan card has its own integrated billing toggle.
 *
 * Evidence: Redesign based on reference design with Ptah Egyptian theme
 */
@Component({
  selector: 'ptah-pricing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavigationComponent,
    FooterComponent,
    PricingHeroComponent,
    PricingGridComponent,
  ],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <!-- Fixed Navigation -->
      <ptah-navigation />

      <!-- Hero Section -->
      <ptah-pricing-hero />

      <!-- Pricing Cards Grid (2 cards: Community + Pro with internal toggle) -->
      <ptah-pricing-grid />

      <ptah-footer />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        contain: layout style;
      }

      /* Component containment for animation isolation */
      ptah-pricing-hero,
      ptah-pricing-grid {
        display: block;
        contain: layout style;
        backface-visibility: hidden;
      }
    `,
  ],
})
export class PricingPageComponent {
  constructor() {
    inject(SeoService).setPage({
      title: 'Ptah Pricing — Free, Open Source, Plus Ptah Builders Membership',
      description:
        'Ptah is free and open source — download the full desktop suite today. Join Ptah Builders for live training, a PRD-to-production curriculum, and member skill packs.',
      url: 'https://ptah.live/pricing',
      ogTitle: 'Ptah Pricing — Free and Open Source, Plus Ptah Builders',
      ogDescription:
        'The Ptah desktop app — Memory, Skills, Cron, and Gateways — is free and open source. Ptah Builders adds live training, curriculum, and member skill packs.',
    });
  }
}
