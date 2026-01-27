import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { NgOptimizedImage, NgClass } from '@angular/common';
import { LucideAngularModule, Check, ArrowRight } from 'lucide-angular';
import { PricingPlan } from '../models/pricing-plan.interface';
import { isPriceIdPlaceholder } from '../../../utils/paddle-validation.util';

/**
 * PlanCardComponent - Premium pricing plan card
 *
 * Design inspired by reference with:
 * - Clean card layout with subtle borders
 * - "Ideal for" description
 * - Large price with subtext
 * - Feature sections with icons
 * - Gradient CTA button with arrow
 *
 * Design: Uses anubis theme from tailwind.config.js
 * Evidence: Redesign based on reference design with Ptah Egyptian theme
 */
@Component({
  selector: 'ptah-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage, NgClass, LucideAngularModule],
  template: `
    <div
      class="relative rounded-2xl p-6 lg:p-8 h-full flex flex-col
             transition-all duration-500 cursor-pointer group"
      [ngClass]="{
        'bg-gradient-to-b from-base-200/80 to-base-300/50 border border-secondary/50 shadow-xl shadow-amber-500/10':
          plan().highlight,
        'bg-base-200/40 border border-base-content/10 hover:border-base-content/20':
          !plan().highlight
      }"
      (click)="ctaClick.emit(plan())"
    >
      <!-- Popular Badge -->
      @if (plan().highlight) {
      <div
        class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
               bg-gradient-to-r from-amber-500 to-secondary rounded-full
               text-xs font-bold text-base-100 uppercase tracking-wider
               shadow-lg shadow-amber-500/30"
      >
        Most Popular
      </div>
      }

      <!-- Trial Badge -->
      @if (plan().trialDays && !plan().highlight) {
      <div
        class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
               bg-gradient-to-r from-sky-500 to-cyan-500 rounded-full
               text-xs font-bold text-base-100 uppercase tracking-wider
               shadow-lg shadow-sky-500/30"
      >
        {{ plan().trialDays }}-Day Free Trial
      </div>
      }

      <!-- LIMITED Badge (Early Adopter only) -->
      @if (plan().badge) {
      <img
        [ngSrc]="'/assets/images/license-system/' + plan().badge"
        alt="LIMITED"
        width="100"
        height="50"
        class="absolute -top-[-5px] -right-2 w-24 drop-shadow-[0_0_15px_rgba(212,175,55,0.5)]
               animate-pulse"
      />
      }

      <!-- Plan Header -->
      <div class="mb-6">
        <h3
          class="font-display text-xl lg:text-2xl font-semibold text-base-content tracking-wide uppercase mb-1"
        >
          {{ plan().name }}
        </h3>
        @if (plan().idealFor) {
        <p class="text-sm text-base-content/50">{{ plan().idealFor }}</p>
        }
      </div>

      <!-- Price Section -->
      <div class="mb-6">
        <div class="flex items-baseline gap-2">
          <span
            class="text-5xl lg:text-6xl font-bold"
            [ngClass]="{
              'bg-gradient-to-r from-amber-300 to-secondary bg-clip-text text-transparent':
                plan().highlight || plan().tier === 'pro',
              'text-base-content': plan().tier === 'basic'
            }"
          >
            {{ plan().price }}
          </span>
          @if (plan().priceSubtext) {
          <span class="text-base-content/50 text-sm">
            / {{ plan().priceSubtext }}
          </span>
          }
        </div>
        @if (plan().savings) {
        <div
          class="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold
                 bg-success/20 text-success"
        >
          {{ plan().savings }}
        </div>
        }
      </div>

      <!-- Divider -->
      <div class="h-px bg-base-content/10 mb-6"></div>

      <!-- Features Section -->
      <div class="flex-1 space-y-6">
        @if (plan().standoutFeatures && plan().standoutFeatures!.length > 0) {
        <div>
          <h4
            class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-3"
          >
            Standout Features
          </h4>
          <ul class="space-y-2.5">
            @for (feature of plan().standoutFeatures; track feature) {
            <li class="flex items-start gap-2.5">
              <lucide-angular
                [img]="CheckIcon"
                class="flex-shrink-0 w-4 h-4 text-amber-400 mt-0.5"
              />
              <span class="text-sm text-base-content/80">{{ feature }}</span>
            </li>
            }
          </ul>
        </div>
        }

        <!-- Regular features if no standout features -->
        @if (!plan().standoutFeatures || plan().standoutFeatures!.length === 0)
        {
        <ul class="space-y-2.5">
          @for (feature of plan().features; track feature) {
          <li class="flex items-start gap-2.5">
            <lucide-angular
              [img]="CheckIcon"
              class="flex-shrink-0 w-4 h-4 text-amber-400 mt-0.5"
            />
            <span class="text-sm text-base-content/80">{{ feature }}</span>
          </li>
          }
        </ul>
        }
      </div>

      <!-- CTA Button -->
      <button
        class="mt-8 w-full py-3.5 px-6 rounded-xl font-semibold text-sm
               flex items-center justify-center gap-2 transition-all duration-300
               group-hover:gap-3"
        [ngClass]="{
          'bg-gradient-to-r from-amber-500 to-secondary text-base-100 shadow-lg shadow-amber-500/25 hover:shadow-amber-500/40':
            plan().highlight,
          'bg-base-content/10 text-base-content hover:bg-base-content/20':
            !plan().highlight
        }"
        [class.opacity-50]="isButtonDisabled()"
        [class.cursor-not-allowed]="isButtonDisabled()"
        [disabled]="isButtonDisabled()"
        [attr.aria-busy]="isLoading()"
        [attr.aria-disabled]="isButtonDisabled()"
        (click)="
          $event.stopPropagation(); !isButtonDisabled() && ctaClick.emit(plan())
        "
      >
        @if (isLoading()) {
        <span class="loading loading-spinner loading-sm"></span>
        <span>Processing...</span>
        } @else {
        <span>{{ plan().ctaText }}</span>
        <lucide-angular
          [img]="ArrowRightIcon"
          class="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
        />
        }
      </button>

      <!-- Disabled tooltip -->
      @if (isButtonDisabled() && !isLoading() && plan().ctaAction ===
      'checkout') {
      <p class="text-center text-xs text-base-content/40 mt-2">
        Checkout temporarily unavailable
      </p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
})
export class PlanCardComponent {
  /** Lucide icon references */
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;

  public readonly plan = input.required<PricingPlan>();
  public readonly isLoading = input<boolean>(false);
  public readonly ctaClick = output<PricingPlan>();

  /**
   * Computed: Button should be disabled if:
   * - Checkout action with no price ID
   * - Currently loading
   * - Price ID is placeholder
   *
   * Evidence: Task 2.2 - Disable button when loading or price ID invalid/placeholder
   */
  protected isButtonDisabled(): boolean {
    const p = this.plan();

    // Always disable if loading
    if (this.isLoading()) return true;

    // Only validate for checkout actions
    if (p.ctaAction !== 'checkout') return false;

    // Check for placeholder patterns using shared utility
    return isPriceIdPlaceholder(p.priceId);
  }
}
