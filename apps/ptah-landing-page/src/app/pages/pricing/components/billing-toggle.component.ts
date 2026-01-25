import { Component, ChangeDetectionStrategy, model } from '@angular/core';
import { NgClass } from '@angular/common';

/**
 * BillingToggleComponent - Monthly/Yearly billing period selector
 *
 * Visual toggle inspired by reference design with savings badge.
 * Uses Ptah's Egyptian gold theme colors.
 */
@Component({
  selector: 'ptah-billing-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgClass],
  template: `
    <div
      class="inline-flex items-center gap-1 p-1 bg-base-300/50 backdrop-blur-sm
             border border-base-content/10 rounded-full"
    >
      <!-- Monthly Option -->
      <button
        type="button"
        class="px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300"
        [ngClass]="{
          'bg-gradient-to-r from-amber-500 to-secondary text-base-100 shadow-lg shadow-amber-500/25':
            billingPeriod() === 'monthly',
          'text-base-content/70 hover:text-base-content':
            billingPeriod() !== 'monthly'
        }"
        (click)="billingPeriod.set('monthly')"
      >
        Monthly billing
      </button>

      <!-- Yearly Option -->
      <button
        type="button"
        class="px-6 py-2.5 rounded-full text-sm font-medium transition-all duration-300
               flex items-center gap-2"
        [ngClass]="{
          'bg-gradient-to-r from-amber-500 to-secondary text-base-100 shadow-lg shadow-amber-500/25':
            billingPeriod() === 'yearly',
          'text-base-content/70 hover:text-base-content':
            billingPeriod() !== 'yearly'
        }"
        (click)="billingPeriod.set('yearly')"
      >
        Yearly billing
        <span
          class="px-2 py-0.5 text-xs font-bold rounded-full"
          [ngClass]="{
            'bg-base-100/20 text-base-100': billingPeriod() === 'yearly',
            'bg-success/20 text-success': billingPeriod() !== 'yearly'
          }"
        >
          Save ~17%
        </span>
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
export class BillingToggleComponent {
  /** Two-way binding for billing period */
  public readonly billingPeriod = model<'monthly' | 'yearly'>('monthly');
}
