import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
} from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { PricingPlan } from '../models/pricing-plan.interface';

/**
 * PlanCardComponent - Reusable pricing plan card
 *
 * Features:
 * - Glass morphism design via Tailwind + DaisyUI
 * - Hover animations
 * - LIMITED badge for Early Adopter tier
 * - Responsive layout
 *
 * Design: Uses anubis theme from tailwind.config.js
 * Evidence: implementation-plan.md Phase 2 - plan-card.component.ts
 */
@Component({
  selector: 'ptah-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgOptimizedImage],
  template: `
    <div
      class="relative bg-base-300 border border-base-content/20 rounded-2xl p-8 
             transition-all duration-300 cursor-pointer h-full flex flex-col
             hover:-translate-y-2 hover:shadow-glow-gold group"
      [class.border-secondary]="plan().highlight"
      [class.shadow-glow-gold]="plan().highlight"
      [class.hover:border-secondary]="!plan().highlight"
      (click)="ctaClick.emit(plan())"
    >
      <!-- LIMITED Badge (Early Adopter only) -->
      @if (plan().badge) {
      <img
        [ngSrc]="'/assets/images/license-system/' + plan().badge"
        alt="LIMITED"
        width="128"
        height="64"
        class="absolute -top-3 right-6 w-32 drop-shadow-[0_0_20px_rgba(212,175,55,0.6)] 
                 animate-glow-pulse"
      />
      }

      <!-- Plan Header -->
      <div class="mb-8">
        <h3 class="font-display text-2xl font-semibold text-base-content mb-2">
          {{ plan().name }}
        </h3>
        <div
          class="text-4xl font-bold bg-gradient-to-r from-amber-300 to-secondary 
                 bg-clip-text text-transparent"
        >
          {{ plan().price }}
        </div>
      </div>

      <!-- Features List -->
      <ul class="list-none p-0 m-0 mb-8 flex-1 space-y-3">
        @for (feature of plan().features; track feature) {
        <li
          class="flex items-start gap-3 text-base-content/80 text-sm leading-relaxed"
        >
          <svg
            class="flex-shrink-0 w-5 h-5 text-success mt-0.5"
            viewBox="0 0 20 20"
            fill="none"
          >
            <path
              d="M16.25 5.625L7.5 14.375L3.75 10.625"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
          <span>{{ feature }}</span>
        </li>
        }
      </ul>

      <!-- CTA Button -->
      <button
        class="btn w-full transition-all duration-300"
        [class.btn-secondary]="plan().highlight"
        [class.btn-outline]="!plan().highlight"
        [class.btn-secondary-outline]="!plan().highlight"
        [class.hover:scale-102]="true"
        [disabled]="plan().ctaAction === 'checkout' && !plan().priceId"
      >
        {{ plan().ctaText }}
      </button>
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
export class PlanCardComponent {
  public readonly plan = input.required<PricingPlan>();
  public readonly ctaClick = output<PricingPlan>();
}
