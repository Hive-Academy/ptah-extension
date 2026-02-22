import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import { Calendar, Check, Crown, LucideAngularModule } from 'lucide-angular';
import { LicenseData } from '../models/license-data.interface';

/**
 * ProfileHeaderComponent - User profile header with avatar, stats, and badges
 *
 * Displays:
 * - Gradient hero background with decorative pattern
 * - User avatar with initials
 * - User name and member since date
 * - Plan and status badges
 * - Stats grid (features, days remaining, next billing)
 *
 * @input license - User license data
 * @output logout - Emits when user clicks logout
 */
@Component({
  selector: 'ptah-profile-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ViewportAnimationDirective, LucideAngularModule],
  template: `
    <!-- Hero Header with Gradient Background -->
    <div
      class="relative h-[28rem] md:h-[38rem] bg-gradient-to-br from-base-100 via-primary/30 to-base-100 overflow-hidden"
    >
      <!-- Background Image Layer -->
      <div
        viewportAnimation
        [viewportConfig]="cardConfig"
        class="absolute inset-0 bg-cover bg-center bg-no-repeat opacity-60"
        style="background-image: url('/assets/backgrounds/floating_obelisks.png')"
      ></div>

      <!-- Radial glow overlay -->
      <div
        class="absolute inset-0 z-[1] bg-gradient-to-b from-slate-950/30 via-slate-900/35 to-slate-950/45"
        aria-hidden="true"
      ></div>

      <!-- Bottom fade for smooth transition -->
      <div
        class="absolute bottom-0 left-0 right-0 h-44 bg-gradient-to-t from-base-100 to-transparent"
      ></div>
    </div>

    <!-- Profile Card (overlapping hero) -->
    <div
      class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-[240px] relative z-10"
    >
      <div
        viewportAnimation
        [viewportConfig]="cardConfig"
        class="bg-base-200/95 backdrop-blur-xl border border-secondary/20 rounded-3xl shadow-2xl overflow-hidden"
      >
        <!-- Avatar & Name Section -->
        <div class="px-6 md:px-8 pt-6 pb-8 border-b border-secondary/10">
          <div class="flex flex-col sm:flex-row items-center gap-6">
            <!-- Avatar -->
            <div
              class="w-28 h-28 rounded-full bg-gradient-to-br from-secondary to-accent
                       flex items-center justify-center text-4xl font-display font-bold text-base-100
                       ring-4 ring-base-200 shadow-glow-gold"
            >
              {{ userInitials() }}
            </div>

            <!-- User Info -->
            <div class="text-center sm:text-left flex-1">
              <h1
                class="text-2xl md:text-3xl font-display font-bold text-base-content"
              >
                {{ displayName() }}
              </h1>
              <p
                class="text-neutral-content mt-1 flex items-center justify-center sm:justify-start gap-2"
              >
                <lucide-angular
                  [img]="CalendarIcon"
                  class="w-4 h-4"
                  aria-hidden="true"
                />
                Member since
                {{ formatDate(license()?.user?.memberSince ?? null) }}
              </p>

              <!-- Plan Badge -->
              <div
                class="mt-3 flex flex-wrap gap-2 justify-center sm:justify-start"
              >
                <span
                  class="badge badge-lg gap-1"
                  [class]="getPlanBadgeClass()"
                >
                  <lucide-angular
                    [img]="CrownIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                  {{ getPlanDisplayName() }}
                </span>
                <span class="badge badge-lg" [class]="getStatusBadgeClass()">
                  {{ getStatusLabel() }}
                </span>
                @if (license()?.user?.emailVerified) {
                <span class="badge badge-lg badge-success gap-1">
                  <lucide-angular
                    [img]="CheckIcon"
                    class="w-3 h-3"
                    aria-hidden="true"
                  />
                  Verified
                </span>
                }
              </div>
            </div>
          </div>
        </div>

        <!-- Stats Grid -->
        <div
          class="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-secondary/10"
        >
          <!-- Plan Stats -->
          <div class="p-6 text-center">
            <div
              class="text-3xl font-bold bg-gradient-to-r from-secondary to-accent bg-clip-text text-transparent"
            >
              {{ featureCount() }}
            </div>
            <p class="text-sm text-neutral-content mt-1">Features Included</p>
          </div>

          <!-- Days/Status -->
          <div class="p-6 text-center">
            @if (license()?.plan === 'community') {
            <div class="text-3xl font-bold text-secondary">Free</div>
            <p class="text-sm text-neutral-content mt-1">Forever</p>
            } @else if (license()?.daysRemaining !== undefined) {
            <div class="text-3xl font-bold" [class]="getExpiryClass()">
              {{ license()?.daysRemaining }}
            </div>
            <p class="text-sm text-neutral-content mt-1">Days Remaining</p>
            } @else if (license()?.subscription) {
            <div class="text-3xl font-bold text-success">Active</div>
            <p class="text-sm text-neutral-content mt-1">Subscription</p>
            } @else {
            <div class="text-3xl font-bold text-secondary">∞</div>
            <p class="text-sm text-neutral-content mt-1">Lifetime Access</p>
            }
          </div>

          <!-- Next Billing / Expiry -->
          <div class="p-6 text-center">
            @if (license()?.plan === 'community') {
            <div class="text-lg font-bold text-secondary">Never</div>
            <p class="text-sm text-neutral-content mt-1">Expires</p>
            } @else if (license()?.subscription?.currentPeriodEnd) {
            <div class="text-lg font-bold text-base-content">
              {{
                formatDateShort(
                  license()?.subscription?.currentPeriodEnd ?? null
                )
              }}
            </div>
            <p class="text-sm text-neutral-content mt-1">Next Billing</p>
            } @else if (license()?.expiresAt) {
            <div class="text-lg font-bold" [class]="getExpiryClass()">
              {{ formatDateShort(license()?.expiresAt ?? null) }}
            </div>
            <p class="text-sm text-neutral-content mt-1">Expires On</p>
            } @else {
            <div class="text-lg font-bold text-secondary">Never</div>
            <p class="text-sm text-neutral-content mt-1">Expires</p>
            }
          </div>
        </div>
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
export class ProfileHeaderComponent {
  /** Lucide icon references */
  public readonly CheckIcon = Check;
  public readonly CrownIcon = Crown;
  public readonly CalendarIcon = Calendar;

  /** License data input */
  public readonly license = input<LicenseData | null>(null);

  // Animation config
  public readonly cardConfig: ViewportAnimationConfig = {
    animation: 'slideUp',
    duration: 0.6,
    threshold: 0.1,
    ease: 'power2.out',
  };

  // Computed signals for derived state
  public readonly userInitials = computed(() => {
    const user = this.license()?.user;
    if (user?.firstName && user?.lastName) {
      return `${user.firstName[0]}${user.lastName[0]}`.toUpperCase();
    }
    if (user?.email) {
      return user.email.substring(0, 2).toUpperCase();
    }
    return 'U';
  });

  public readonly displayName = computed(() => {
    const user = this.license()?.user;
    if (user?.firstName && user?.lastName) {
      return `${user.firstName} ${user.lastName}`;
    }
    if (user?.firstName) {
      return user.firstName;
    }
    return user?.email?.split('@')[0] || 'User';
  });

  public readonly featureCount = computed(() => {
    return this.license()?.features?.length || 0;
  });

  /**
   * Check if trial has ended (even if DB still shows trialing status)
   * TASK_2025_143: Use reason field to detect trial expiration
   */
  public isTrialEnded(): boolean {
    return this.license()?.reason === 'trial_ended';
  }

  public getPlanBadgeClass(): string {
    // Trial ended = show error badge
    if (this.isTrialEnded()) return 'badge-error';

    const plan = this.license()?.plan;
    if (plan === 'pro' || plan === 'trial_pro') return 'badge-primary';
    if (plan === 'community') return 'badge-secondary';
    return 'badge-ghost';
  }

  /**
   * Get display name for plan badge
   * TASK_2025_143: Show "Trial Expired" when trial has ended
   */
  public getPlanDisplayName(): string {
    if (this.isTrialEnded()) return 'Trial Expired';
    return this.license()?.planName || 'Unknown';
  }

  public getStatusBadgeClass(): string {
    // Trial ended = expired state
    if (this.isTrialEnded()) return 'badge-error';

    const status = this.license()?.status;
    if (status === 'active') return 'badge-success';
    if (status === 'expired') return 'badge-error';
    return 'badge-ghost';
  }

  public getStatusLabel(): string {
    // Trial ended = show Expired
    if (this.isTrialEnded()) return 'Expired';

    const status = this.license()?.status;
    if (status === 'active') return 'Active';
    if (status === 'expired') return 'Expired';
    if (status === 'none') return 'No License';
    return (status && (status as string).toUpperCase()) || 'Unknown';
  }

  public getExpiryClass(): string {
    const days = this.license()?.daysRemaining;
    if (days === undefined) return 'text-base-content';
    if (days <= 7) return 'text-error';
    if (days <= 30) return 'text-warning';
    return 'text-success';
  }

  public formatDate(isoDate: string | null): string {
    if (!isoDate) return 'N/A';
    return new Date(isoDate).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }

  public formatDateShort(isoDate: string | null): string {
    if (!isoDate) return 'N/A';
    return new Date(isoDate).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
