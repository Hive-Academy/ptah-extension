import { Component, ChangeDetectionStrategy } from '@angular/core';
import { NavigationComponent } from '../../components/navigation.component';
import { PricingHeroComponent } from './components/pricing-hero.component';
import { PricingGridComponent } from './components/pricing-grid.component';

/**
 * PricingPageComponent - Main pricing page container
 *
 * Composes navigation, hero section and pricing grid.
 * Uses DaisyUI base-100 background from anubis theme.
 *
 * Evidence: implementation-plan.md Phase 2 - Pricing Page
 */
@Component({
  selector: 'ptah-pricing-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavigationComponent, PricingHeroComponent, PricingGridComponent],
  template: `
    <div class="min-h-screen bg-base-100 text-base-content">
      <!-- Fixed Navigation -->
      <ptah-navigation />

      <ptah-pricing-hero />
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
