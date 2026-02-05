import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
} from '@angular/core';
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
  RefreshCw,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Eye,
  EyeOff,
  KeyRound,
  Copy,
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
 * - Sync with Paddle button for subscription management
 * - Manage Subscription link to Paddle customer portal
 * - License key reveal with show/hide toggle and copy-to-clipboard
 *
 * @input license - User license data
 * @input isSyncing - Whether a sync operation is in progress
 * @input syncError - Error message from sync operation
 * @input syncSuccess - Whether sync completed successfully
 * @input licenseKey - Revealed license key (null until fetched)
 * @input isRevealingKey - Whether a key reveal operation is in progress
 * @input revealKeyError - Error message from key reveal operation
 * @output syncRequested - Emits when user clicks Sync with Paddle button
 * @output manageSubscriptionRequested - Emits when user clicks Manage Subscription
 * @output revealKeyRequested - Emits when user clicks Get License Key button
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
          <span class="font-medium" [class.text-error]="isTrialEnded()">
            {{ getPlanDisplayName() }}
          </span>
        </div>

        <!-- License Key - Hide when trial ended (no valid license) -->
        @if (license()?.status !== 'none' && !isTrialEnded()) {
        <div class="px-6 py-4 flex justify-between items-center">
          <span class="text-neutral-content flex items-center gap-2">
            <lucide-angular
              [img]="KeyRoundIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            License Key
          </span>

          @if (licenseKey()) {
          <div class="flex items-center gap-2">
            <code
              class="text-xs font-mono bg-base-300 px-2 py-1 rounded select-all max-w-[200px] truncate"
            >
              {{ showLicenseKey() ? licenseKey() : maskedKey() }}
            </code>
            <button
              type="button"
              (click)="toggleLicenseKeyVisibility()"
              class="btn btn-xs btn-ghost"
              [attr.aria-label]="
                showLicenseKey() ? 'Hide license key' : 'Show license key'
              "
            >
              <lucide-angular
                [img]="showLicenseKey() ? EyeOffIcon : EyeIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
            </button>
            <button
              type="button"
              (click)="copyLicenseKey()"
              class="btn btn-xs btn-ghost"
              aria-label="Copy license key"
            >
              @if (copiedToClipboard()) {
              <lucide-angular
                [img]="CheckCircleIcon"
                class="w-3.5 h-3.5 text-success"
                aria-hidden="true"
              />
              } @else {
              <lucide-angular
                [img]="CopyIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
              }
            </button>
          </div>
          } @else {
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            [disabled]="isRevealingKey()"
            (click)="revealKeyRequested.emit()"
          >
            @if (isRevealingKey()) {
            <span class="loading loading-spinner loading-xs"></span>
            Retrieving... } @else { Get License Key }
          </button>
          }
        </div>

        <!-- License Key Error -->
        @if (revealKeyError()) {
        <div class="px-6 py-4 flex items-center gap-2 bg-error/10 text-error">
          <lucide-angular
            [img]="AlertCircleIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          <span class="text-sm">{{ revealKeyError() }}</span>
        </div>
        } }

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
            {{ getBillingStatusLabel() }}
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

        <!-- Sync Success Message -->
        @if (syncSuccess()) {
        <div
          class="px-6 py-4 flex items-center gap-2 bg-success/10 text-success"
        >
          <lucide-angular
            [img]="CheckCircleIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          <span class="text-sm font-medium"
            >Subscription synced successfully</span
          >
        </div>
        }

        <!-- Sync Error Message -->
        @if (syncError()) {
        <div class="px-6 py-4 flex items-center gap-2 bg-error/10 text-error">
          <lucide-angular
            [img]="AlertCircleIcon"
            class="w-4 h-4"
            aria-hidden="true"
          />
          <span class="text-sm">{{ syncError() }}</span>
        </div>
        }

        <!-- Sync with Paddle Button (only for users with real Paddle subscription) -->
        @if (hasPaddleSubscription()) {
        <div class="px-6 py-4 flex justify-between items-center">
          <span class="text-neutral-content flex items-center gap-2">
            <lucide-angular
              [img]="RefreshCwIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Subscription Sync
          </span>
          <button
            class="btn btn-sm btn-ghost"
            [disabled]="isSyncing()"
            (click)="syncRequested.emit()"
          >
            @if (isSyncing()) {
            <span class="loading loading-spinner loading-xs"></span>
            Syncing... } @else { Sync with Paddle }
          </button>
        </div>
        }

        <!-- Manage Subscription Link (only for users with real Paddle subscription) -->
        @if (hasPaddleSubscription()) {
        <div class="px-6 py-4 flex justify-between items-center">
          <span class="text-neutral-content flex items-center gap-2">
            <lucide-angular
              [img]="ExternalLinkIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Subscription Management
          </span>
          <button
            class="btn btn-sm btn-secondary"
            (click)="manageSubscriptionRequested.emit()"
          >
            Manage Subscription
          </button>
        </div>
        }
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
  public readonly RefreshCwIcon = RefreshCw;
  public readonly ExternalLinkIcon = ExternalLink;
  public readonly CheckCircleIcon = CheckCircle;
  public readonly AlertCircleIcon = AlertCircle;
  public readonly KeyRoundIcon = KeyRound;
  public readonly EyeIcon = Eye;
  public readonly EyeOffIcon = EyeOff;
  public readonly CopyIcon = Copy;

  /** License data input */
  public readonly license = input<LicenseData | null>(null);

  /** Sync state inputs from parent component */
  public readonly isSyncing = input<boolean>(false);
  public readonly syncError = input<string | null>(null);
  public readonly syncSuccess = input<boolean>(false);

  /** License key reveal inputs from parent component */
  public readonly licenseKey = input<string | null>(null);
  public readonly isRevealingKey = input<boolean>(false);
  public readonly revealKeyError = input<string | null>(null);

  /** Output events for sync, manage subscription, and license key actions */
  public readonly syncRequested = output<void>();
  public readonly manageSubscriptionRequested = output<void>();
  public readonly revealKeyRequested = output<void>();

  /** Local state for license key visibility toggle and clipboard feedback */
  public readonly showLicenseKey = signal(false);
  public readonly copiedToClipboard = signal(false);

  /** Toggle license key visibility between masked and full display */
  public toggleLicenseKeyVisibility(): void {
    this.showLicenseKey.update((show) => !show);
  }

  /** Copy license key to clipboard with 2-second visual feedback */
  public async copyLicenseKey(): Promise<void> {
    const key = this.licenseKey();
    if (key) {
      try {
        await navigator.clipboard.writeText(key);
        this.copiedToClipboard.set(true);
        setTimeout(() => this.copiedToClipboard.set(false), 2000);
      } catch {
        // Clipboard API may fail in insecure contexts or when permission is denied
        console.error('[Profile] Failed to copy license key to clipboard');
      }
    }
  }

  /** Masked license key showing prefix and last 4 chars */
  public readonly maskedKey = computed(() => {
    const key = this.licenseKey();
    if (!key) return '';
    if (key.length < 20) return key.substring(0, 4) + '...';
    return key.substring(0, 12) + '...' + key.substring(key.length - 4);
  });

  /**
   * Check if user has a real Paddle subscription (not trialing)
   * Trial users don't have a real Paddle customer ID, so we can't:
   * - Sync with Paddle
   * - Open customer portal
   */
  public hasPaddleSubscription(): boolean {
    const licenseData = this.license();
    if (!licenseData?.subscription) return false;

    // Trial users have subscription.status = 'trialing' but no real Paddle customer
    // They also have plan = 'trial_pro'
    const isTrialing =
      licenseData.subscription.status === 'trialing' ||
      licenseData.plan?.startsWith('trial_');

    return !isTrialing;
  }

  /**
   * Check if license requires sync with Paddle
   * This can be true when local data differs from Paddle data
   */
  public requiresSync(): boolean {
    // Show sync button only if user has a real Paddle subscription
    return this.hasPaddleSubscription();
  }

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

  /**
   * Check if trial has ended (even if DB still shows trialing status)
   * TASK_2025_143: Use reason field to detect trial expiration
   */
  public isTrialEnded(): boolean {
    return this.license()?.reason === 'trial_ended';
  }

  /**
   * Get display name for plan
   * TASK_2025_143: Show "Trial Expired" when trial has ended
   */
  public getPlanDisplayName(): string {
    if (this.isTrialEnded()) return 'Trial Expired';
    return this.license()?.planName || 'Unknown';
  }

  /**
   * Get billing status label
   * TASK_2025_143: Show "EXPIRED" when trial has ended
   */
  public getBillingStatusLabel(): string {
    if (this.isTrialEnded()) return 'EXPIRED';
    return this.license()?.subscription?.status?.toUpperCase() || 'UNKNOWN';
  }

  public getSubscriptionStatusClass(): string {
    // Trial ended = error badge
    if (this.isTrialEnded()) return 'badge-error';

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
