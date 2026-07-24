import {
  Component,
  ChangeDetectionStrategy,
  input,
  computed,
} from '@angular/core';
import { LucideAngularModule, Check, Crown, Star } from 'lucide-angular';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import {
  FeatureDisplay,
  FEATURE_DISPLAY_MAP,
} from '../models/license-data.interface';

/**
 * ProfileFeaturesComponent - What's included, honestly framed
 *
 * Splits the license's `features` array into two truthful groups instead of
 * a "Premium Features" gating framing:
 * - "Included — Free & Open Source": whatever's part of the free local
 *   product that this license carries.
 * - "Included — Ptah Builders": whatever's part of the paid membership that
 *   this license carries (only ever populated for Builders members).
 *
 * @input features - Array of feature keys from license data
 */
@Component({
  selector: 'ptah-profile-features',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, LucideAngularModule],
  template: `
    @if (hasFeatures()) {
      <div
        viewportAnimation
        [viewportConfig]="animationConfig"
        class="bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl overflow-hidden"
      >
        <div
          class="px-6 py-4 border-b border-secondary/10 flex items-center gap-2"
        >
          <lucide-angular
            [img]="StarIcon"
            class="w-5 h-5 text-secondary"
            aria-hidden="true"
          />
          <h2 class="font-display text-lg font-semibold">What's Included</h2>
        </div>

        <div class="p-6">
          <!-- Free & Open Source -->
          @if (coreFeatures().length > 0) {
            <div class="mb-6">
              <h3
                class="text-sm font-semibold text-neutral-content uppercase tracking-wider mb-3"
              >
                Free &amp; Open Source
              </h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                @for (feature of coreFeatures(); track feature.key) {
                  <div
                    class="flex items-start gap-3 p-3 bg-base-300/50 rounded-xl border border-secondary/10 hover:border-secondary/30 transition-colors"
                  >
                    <lucide-angular
                      [img]="CheckIcon"
                      class="w-5 h-5 text-success flex-shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div>
                      <p class="font-medium text-base-content">
                        {{ feature.label }}
                      </p>
                      <p class="text-sm text-neutral-content">
                        {{ feature.description }}
                      </p>
                    </div>
                  </div>
                }
              </div>
            </div>
          }

          <!-- Ptah Builders membership -->
          @if (builderFeatures().length > 0) {
            <div>
              <h3
                class="text-sm font-semibold text-accent uppercase tracking-wider mb-3"
              >
                Ptah Builders Membership
              </h3>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                @for (feature of builderFeatures(); track feature.key) {
                  <div
                    class="flex items-start gap-3 p-3 bg-gradient-to-r from-secondary/10 to-accent/10 rounded-xl border border-accent/20 hover:border-accent/40 transition-colors"
                  >
                    <lucide-angular
                      [img]="CrownIcon"
                      class="w-5 h-5 text-accent flex-shrink-0 mt-0.5"
                      aria-hidden="true"
                    />
                    <div>
                      <p class="font-medium text-base-content">
                        {{ feature.label }}
                      </p>
                      <p class="text-sm text-neutral-content">
                        {{ feature.description }}
                      </p>
                    </div>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
  styles: [
    `
      :host {
        display: block;
      }
    `,
  ],
})
export class ProfileFeaturesComponent {
  /** Lucide icon references */
  public readonly CheckIcon = Check;
  public readonly CrownIcon = Crown;
  public readonly StarIcon = Star;

  /** Feature keys from license data */
  public readonly features = input<string[]>([]);

  /** Animation configuration */
  public readonly animationConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.5,
    threshold: 0.1,
    delay: 0.3,
  };

  /** Check if there are any features to display */
  public readonly hasFeatures = computed(() => {
    return this.features().length > 0;
  });

  /** Free, open-source core features carried by this license */
  public readonly coreFeatures = computed(() => {
    return this.getFeaturesByCategory('core');
  });

  /** Paid Ptah Builders membership features carried by this license */
  public readonly builderFeatures = computed(() => {
    return this.getFeaturesByCategory('builders');
  });

  private getFeaturesByCategory(
    category: 'core' | 'builders',
  ): FeatureDisplay[] {
    return this.features()
      .map((key) => FEATURE_DISPLAY_MAP[key])
      .filter(
        (f): f is FeatureDisplay => f !== undefined && f.category === category,
      );
  }
}
