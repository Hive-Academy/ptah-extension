import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  LucideAngularModule,
  User,
  Mail,
  Crown,
  CreditCard,
  Clock,
  Sparkles,
  Zap,
} from 'lucide-angular';
import {
  ViewportAnimationDirective,
  ViewportAnimationConfig,
} from '@hive-academy/angular-gsap';
import { LicenseData } from '../models/license-data.interface';

/**
 * ProfileDetailsComponent - Account details and subscription info
 *
 * Displays:
 * - Email and plan information
 * - Plan description
 * - Subscription status for Pro users
 * - Upgrade CTA for trial users
 *
 * @input license - User license data
 */
@Component({
  selector: 'ptah-profile-details',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, RouterLink, LucideAngularModule],
  template: `
    <!-- Upgrade CTA for Trial Users -->
    @if (license()?.message) {
    <div
      viewportAnimation
      [viewportConfig]="alertConfig"
      class="bg-gradient-to-r from-primary/20 to-secondary/20
               border border-secondary/30 rounded-2xl p-6 flex flex-col sm:flex-row items-center gap-4"
    >
      <lucide-angular
        [img]="SparklesIcon"
        class="w-10 h-10 text-secondary flex-shrink-0"
        aria-hidden="true"
      />
      <div class="flex-1 text-center sm:text-left">
        <p class="text-base-content font-medium">
          {{ license()?.message }}
        </p>
      </div>
      <a routerLink="/pricing" class="btn btn-secondary btn-sm sm:btn-md">
        <lucide-angular [img]="ZapIcon" class="w-4 h-4" aria-hidden="true" />
        Upgrade Now
      </a>
    </div>
    }

    <!-- Account Details Card -->
    <div
      viewportAnimation
      [viewportConfig]="detailsConfig"
      class="mt-6 bg-base-200/80 backdrop-blur-xl border border-secondary/20 rounded-2xl overflow-hidden"
    >
      <div
        class="px-6 py-4 border-b border-secondary/10 flex items-center gap-2"
      >
        <lucide-angular
          [img]="UserIcon"
          class="w-5 h-5 text-secondary"
          aria-hidden="true"
        />
        <h2 class="font-display text-lg font-semibold">Account Details</h2>
      </div>

      <div class="divide-y divide-secondary/10">
        <!-- Email -->
        <div class="px-6 py-4 flex justify-between items-center">
          <span class="text-neutral-content flex items-center gap-2">
            <lucide-angular
              [img]="MailIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Email
          </span>
          <span class="font-medium">{{ license()?.user?.email }}</span>
        </div>

        <!-- Plan -->
        <div class="px-6 py-4 flex justify-between items-center">
          <span class="text-neutral-content flex items-center gap-2">
            <lucide-angular
              [img]="CrownIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Current Plan
          </span>
          <span class="font-medium">{{ license()?.planName }}</span>
        </div>

        <!-- Plan Description -->
        @if (license()?.planDescription) {
        <div class="px-6 py-4">
          <span class="text-neutral-content text-sm">
            {{ license()?.planDescription }}
          </span>
        </div>
        }

        <!-- Subscription Status (for Pro users) -->
        @if (license()?.subscription) {
        <div class="px-6 py-4 flex justify-between items-center">
          <span class="text-neutral-content flex items-center gap-2">
            <lucide-angular
              [img]="CreditCardIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Billing Status
          </span>
          <span class="badge" [class]="getSubscriptionStatusClass()">
            {{ license()?.subscription?.status?.toUpperCase() }}
          </span>
        </div>

        @if (license()?.subscription?.canceledAt) {
        <div class="px-6 py-4 flex justify-between items-center bg-error/5">
          <span class="text-error flex items-center gap-2">
            <lucide-angular
              [img]="ClockIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Cancellation Date
          </span>
          <span class="text-error font-medium">
            {{ formatDate(license()?.subscription?.canceledAt ?? null) }}
          </span>
        </div>
        } }
      </div>
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
export class ProfileDetailsComponent {
  /** Lucide icon references */
  public readonly UserIcon = User;
  public readonly MailIcon = Mail;
  public readonly CrownIcon = Crown;
  public readonly CreditCardIcon = CreditCard;
  public readonly ClockIcon = Clock;
  public readonly SparklesIcon = Sparkles;
  public readonly ZapIcon = Zap;

  /** License data input */
  public readonly license = input<LicenseData | null>(null);

  // Animation configs
  public readonly alertConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.5,
    threshold: 0.1,
    delay: 0.1,
  };

  public readonly detailsConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.5,
    threshold: 0.1,
    delay: 0.2,
  };

  public getSubscriptionStatusClass(): string {
    const status = this.license()?.subscription?.status;
    if (status === 'active') return 'badge-success';
    if (status === 'paused') return 'badge-warning';
    if (status === 'canceled') return 'badge-error';
    if (status === 'past_due') return 'badge-error';
    return 'badge-ghost';
  }

  public formatDate(isoDate: string | null): string {
    if (!isoDate) return 'N/A';
    return new Date(isoDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
}
