import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { LucideAngularModule, Check, ArrowRight } from 'lucide-angular';
import { PricingPlan } from '../models/pricing-plan.interface';
import { isPriceIdPlaceholder } from '../../../utils/paddle-validation.util';

/**
 * BasicPlanCardComponent - Basic plan card with integrated billing toggle
 *
 * This component handles the Basic plan which has both monthly and yearly options.
 * The billing toggle is integrated directly into the card.
 *
 * Evidence: TASK_2025_121 - Two-Tier Paid Extension Model
 */
@Component({
  selector: 'ptah-basic-plan-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass, LucideAngularModule],
  template: `
    <div
      class="relative rounded-2xl p-6 lg:p-8 h-full flex flex-col
             bg-base-200/40 border border-base-content/10 hover:border-base-content/20
             transition-all duration-500 group"
    >
      <!-- Trial Badge -->
      @if (activePlan().trialDays) {
      <div
        class="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1
               bg-gradient-to-r from-sky-500 to-cyan-500 rounded-full
               text-xs font-bold text-base-100 uppercase tracking-wider
               shadow-lg shadow-sky-500/30"
      >
        {{ activePlan().trialDays }}-Day Free Trial
      </div>
      }

      <!-- Plan Header -->
      <div class="mb-4 mt-2">
        <h3
          class="font-display text-xl lg:text-2xl font-semibold text-base-content tracking-wide uppercase mb-1"
        >
          {{ activePlan().name }}
        </h3>
        <p class="text-sm text-base-content/50">{{ activePlan().idealFor }}</p>
      </div>

      <!-- Billing Toggle (inside card) -->
      <div class="mb-6">
        <div
          class="inline-flex items-center p-1 rounded-full bg-base-100/50 border border-base-content/10"
        >
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-300"
            [ngClass]="{
              'bg-sky-500 text-base-100 shadow-md':
                billingPeriod() === 'monthly',
              'text-base-content/60 hover:text-base-content':
                billingPeriod() !== 'monthly'
            }"
            (click)="billingPeriod.set('monthly')"
          >
            Monthly
          </button>
          <button
            type="button"
            class="px-4 py-1.5 text-sm font-medium rounded-full transition-all duration-300 flex items-center gap-2"
            [ngClass]="{
              'bg-sky-500 text-base-100 shadow-md':
                billingPeriod() === 'yearly',
              'text-base-content/60 hover:text-base-content':
                billingPeriod() !== 'yearly'
            }"
            (click)="billingPeriod.set('yearly')"
          >
            Yearly
            <span
              class="px-1.5 py-0.5 text-[10px] font-bold rounded bg-success text-success-content"
            >
              -17%
            </span>
          </button>
        </div>
      </div>

      <!-- Price Section -->
      <div class="mb-6">
        <div class="flex items-baseline gap-2">
          <span class="text-5xl lg:text-6xl font-bold text-base-content">
            {{ activePlan().price }}
          </span>
          <span class="text-base-content/50 text-sm">
            / {{ activePlan().priceSubtext }}
          </span>
        </div>
        @if (activePlan().savings) {
        <div
          class="inline-block mt-2 px-3 py-1 rounded-full text-xs font-semibold
                 bg-success/20 text-success"
        >
          {{ activePlan().savings }}
        </div>
        }
      </div>

      <!-- Divider -->
      <div class="h-px bg-base-content/10 mb-6"></div>

      <!-- Features Section -->
      <div class="flex-1">
        <h4
          class="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-3"
        >
          Core Features
        </h4>
        <ul class="space-y-2.5">
          @for (feature of basicFeatures; track feature) {
          <li class="flex items-start gap-2.5">
            <lucide-angular
              [img]="CheckIcon"
              class="flex-shrink-0 w-4 h-4 text-sky-400 mt-0.5"
            />
            <span class="text-sm text-base-content/80">{{ feature }}</span>
          </li>
          }
        </ul>
      </div>

      <!-- CTA Button -->
      <button
        class="mt-8 w-full py-3.5 px-6 rounded-xl font-semibold text-sm
               bg-base-content/10 text-base-content hover:bg-base-content/20
               flex items-center justify-center gap-2 transition-all duration-300
               group-hover:gap-3 cursor-pointer"
        [class.opacity-50]="isButtonDisabled()"
        [class.cursor-not-allowed]="isButtonDisabled()"
        [disabled]="isButtonDisabled()"
        [attr.aria-busy]="isLoading()"
        (click)="handleClick()"
      >
        @if (isLoading()) {
        <span class="loading loading-spinner loading-sm"></span>
        <span>Processing...</span>
        } @else {
        <span>{{ activePlan().ctaText }}</span>
        <lucide-angular
          [img]="ArrowRightIcon"
          class="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1"
        />
        }
      </button>

      <!-- Disabled tooltip -->
      @if (isButtonDisabled() && !isLoading()) {
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
export class BasicPlanCardComponent {
  /** Lucide icon references */
  public readonly CheckIcon = Check;
  public readonly ArrowRightIcon = ArrowRight;

  /** Monthly plan data */
  public readonly monthlyPlan = input.required<PricingPlan>();

  /** Yearly plan data */
  public readonly yearlyPlan = input.required<PricingPlan>();

  /** Loading state */
  public readonly isLoading = input<boolean>(false);

  /** CTA click event */
  public readonly ctaClick = output<PricingPlan>();

  /** Internal billing period state */
  public readonly billingPeriod = signal<'monthly' | 'yearly'>('monthly');

  /** Computed active plan based on billing period */
  public readonly activePlan = computed(() =>
    this.billingPeriod() === 'yearly' ? this.yearlyPlan() : this.monthlyPlan()
  );

  /** Basic features list (same for both monthly and yearly) */
  public readonly basicFeatures = [
    'Beautiful visual interface',
    'Use your Claude Pro/Max subscription',
    'Native VS Code integration',
    'Real-time streaming responses',
    'Session history & management',
    'Basic workspace context',
  ];

  /**
   * Check if button should be disabled
   */
  protected isButtonDisabled(): boolean {
    if (this.isLoading()) return true;
    return isPriceIdPlaceholder(this.activePlan().priceId);
  }

  /**
   * Handle CTA click
   */
  protected handleClick(): void {
    if (!this.isButtonDisabled()) {
      this.ctaClick.emit(this.activePlan());
    }
  }
}
