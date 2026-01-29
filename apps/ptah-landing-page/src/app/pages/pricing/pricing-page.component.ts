import { Component, ChangeDetectionStrategy } from '@angular/core';
import { NavigationComponent } from '../../components/navigation.component';
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
  imports: [NavigationComponent, PricingHeroComponent, PricingGridComponent],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <!-- Fixed Navigation -->
      <ptah-navigation />

      <!-- Hero Section -->
      <ptah-pricing-hero />

      <!-- Pricing Cards Grid (2 cards: Community + Pro with internal toggle) -->
      <ptah-pricing-grid />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class PricingPageComponent {}
