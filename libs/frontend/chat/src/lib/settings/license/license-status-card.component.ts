import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  Sparkles,
  Shield,
  Clock,
  CreditCard,
  UserPlus,
  Key,
  ExternalLink,
  AlertTriangle,
  LogOut,
  X,
  Check,
  Loader2,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { TRIAL_DURATION_DAYS } from '@ptah-extension/shared';
import { ChatStore } from '../../services/chat.store';
import { ConfirmationDialogService } from '@ptah-extension/chat-state';

/**
 * LicenseStatusCardComponent - License tier, trial status, user profile, and action buttons
 *
 * Extracted from SettingsComponent to reduce its complexity.
 * Self-contained: injects its own dependencies (ChatStore, ClaudeRpcService).
 */
@Component({
  selector: 'ptah-license-status-card',
  standalone: true,
  imports: [LucideAngularModule, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!isLoadingLicenseStatus()) {
      <div class="border border-secondary/30 rounded-md bg-secondary/5">
        <div class="p-3">
          <div class="flex items-center gap-1.5 mb-2">
            <lucide-angular [img]="ShieldIcon" class="w-4 h-4 text-secondary" />
            <h2 class="text-xs font-medium uppercase tracking-wide">
              License Status
            </h2>
          </div>

          <!-- Tier badge and validity -->
          <div class="flex items-center gap-2 mb-2">
            @if (licenseTier() === 'pro') {
              <span class="badge badge-primary badge-xs gap-1">
                <lucide-angular [img]="SparklesIcon" class="w-2.5 h-2.5" />
                <span>Pro</span>
              </span>
            } @else if (licenseTier() === 'trial_pro') {
              <span class="badge badge-primary badge-xs gap-1">
                <lucide-angular [img]="ClockIcon" class="w-2.5 h-2.5" />
                <span>Pro Trial</span>
              </span>
            } @else if (licenseTier() === 'community') {
              <span class="badge badge-ghost badge-xs">Community</span>
            } @else {
              <span class="badge badge-error badge-xs">Expired</span>
            }
            @if (licenseValid() && !licenseReason()) {
              <span class="text-xs text-success">Valid</span>
            } @else if (licenseValid() && licenseReason()) {
              <span class="text-xs text-warning">Needs Attention</span>
            } @else {
              <span class="text-xs text-error">Invalid</span>
            }
          </div>

          <!-- License issue warning: key not found or expired -->
          @if (isCommunity() && licenseReason() === 'no_license') {
            <div
              class="border border-warning rounded-md p-2.5 mb-2 bg-warning bg-opacity-5"
            >
              <div class="flex items-center gap-1.5 mb-1.5">
                <lucide-angular
                  [img]="AlertTriangleIcon"
                  class="w-3.5 h-3.5 text-warning"
                />
                <span class="text-xs font-medium text-warning"
                  >License Not Found</span
                >
              </div>
              <p class="text-xs text-base-content/60 mb-2">
                Your license key could not be verified. Please re-enter your
                license key to restore your plan.
              </p>
              <button
                class="btn btn-warning btn-xs w-full gap-1"
                (click)="enterLicenseKey()"
              >
                <lucide-angular [img]="KeyIcon" class="w-3 h-3" />
                Re-enter License Key
              </button>
            </div>
          } @else if (
            isCommunity() &&
            (licenseReason() === 'expired' || licenseReason() === 'trial_ended')
          ) {
            <div
              class="border border-warning rounded-md p-2.5 mb-2 bg-warning bg-opacity-5"
            >
              <div class="flex items-center gap-1.5 mb-1.5">
                <lucide-angular
                  [img]="AlertTriangleIcon"
                  class="w-3.5 h-3.5 text-warning"
                />
                <span class="text-xs font-medium text-warning"
                  >License Expired</span
                >
              </div>
              <p class="text-xs text-base-content/60 mb-2">
                Your previous license has expired. Re-enter a valid license key
                or upgrade to restore Pro features.
              </p>
              <div class="flex gap-2">
                <button
                  class="btn btn-warning btn-xs flex-1 gap-1"
                  (click)="enterLicenseKey()"
                >
                  <lucide-angular [img]="KeyIcon" class="w-3 h-3" />
                  Re-enter Key
                </button>
                <button
                  class="btn btn-primary btn-xs flex-1 gap-1"
                  (click)="openPricing()"
                >
                  <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
                  Upgrade
                </button>
              </div>
            </div>
          }

          <!-- User Profile (TASK_2025_129) -->
          @if (userEmail()) {
            <div
              class="flex items-center gap-2 mb-2 py-1.5 px-2 bg-base-300/30 rounded"
              aria-label="User profile"
            >
              <div
                class="flex items-center justify-center w-6 h-6 rounded-full bg-primary/20 text-primary text-xs font-bold shrink-0"
                aria-hidden="true"
              >
                {{ userInitials() }}
              </div>
              <div class="min-w-0 flex-1">
                @if (showUserName()) {
                  <div class="text-xs font-medium truncate">
                    {{ userDisplayName() }}
                  </div>
                }
                <div class="text-xs text-base-content/50 truncate">
                  {{ userEmail() }}
                </div>
              </div>
              <button
                class="btn btn-ghost btn-xs text-error gap-1 shrink-0"
                (click)="removeLicenseKey()"
                aria-label="Remove license key and log out"
              >
                <lucide-angular [img]="LogOutIcon" class="w-3 h-3" />
                <span>Log Out</span>
              </button>
            </div>
          }

          <!-- TASK_2025_142: Enhanced Trial Status Section -->
          @if (showTrialInfo()) {
            <div
              class="border rounded-md p-2.5 mb-2"
              [class.border-info]="trialUrgencyLevel() === 'info'"
              [class.border-warning]="trialUrgencyLevel() === 'warning'"
              [class.border-error]="trialUrgencyLevel() === 'error'"
              [class.bg-info]="trialUrgencyLevel() === 'info'"
              [class.bg-warning]="trialUrgencyLevel() === 'warning'"
              [class.bg-error]="trialUrgencyLevel() === 'error'"
              [class.bg-opacity-5]="true"
            >
              <!-- Header with icon and status badge -->
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-1.5">
                  <lucide-angular
                    [img]="ClockIcon"
                    class="w-3.5 h-3.5"
                    [class.text-info]="trialUrgencyLevel() === 'info'"
                    [class.text-warning]="trialUrgencyLevel() === 'warning'"
                    [class.text-error]="trialUrgencyLevel() === 'error'"
                  />
                  <span class="text-xs font-medium">Pro Trial Status</span>
                </div>
                <span
                  class="badge badge-xs"
                  [class.badge-info]="trialUrgencyLevel() === 'info'"
                  [class.badge-warning]="trialUrgencyLevel() === 'warning'"
                  [class.badge-error]="trialUrgencyLevel() === 'error'"
                >
                  {{ trialStatusText() }}
                </span>
              </div>

              <!-- Progress bar -->
              <div
                class="w-full h-1.5 bg-base-300 rounded-full overflow-hidden mb-2"
              >
                <div
                  class="h-full transition-all duration-300 rounded-full"
                  [class.bg-info]="trialUrgencyLevel() === 'info'"
                  [class.bg-warning]="trialUrgencyLevel() === 'warning'"
                  [class.bg-error]="trialUrgencyLevel() === 'error'"
                  [style.width.%]="trialProgress()"
                ></div>
              </div>

              <!-- End date -->
              @if (trialEndDate()) {
                <p class="text-xs text-base-content/60 mb-2">
                  Ends on {{ trialEndDate() }}
                </p>
              }

              <!-- Upgrade CTA -->
              <button
                class="btn btn-primary btn-xs w-full gap-1"
                (click)="openPricing()"
              >
                <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
                Upgrade to Pro
              </button>
            </div>
          }

          <!-- TASK_2025_142: Trial Expired Section -->
          @if (
            licenseTier() === 'expired' && licenseReason() === 'trial_ended'
          ) {
            <div
              class="border border-error rounded-md p-2.5 mb-2 bg-error bg-opacity-5"
            >
              <div class="flex items-center gap-1.5 mb-2">
                <lucide-angular
                  [img]="ClockIcon"
                  class="w-3.5 h-3.5 text-error"
                />
                <span class="text-xs font-medium text-error"
                  >Trial Expired</span
                >
              </div>
              <p class="text-xs text-base-content/60 mb-2">
                Your 100-day Pro trial has ended. Upgrade to restore Pro
                features.
              </p>
              <button
                class="btn btn-primary btn-xs w-full gap-1"
                (click)="openPricing()"
              >
                <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
                Upgrade to Pro
              </button>
            </div>
          }

          <!-- Subscription days remaining (paid, non-trial) -->
          @if (!trialActive() && daysRemaining() !== null && isPremium()) {
            <div
              class="flex items-center gap-1.5 text-xs text-base-content/70 mb-2"
            >
              <lucide-angular [img]="CreditCardIcon" class="w-3 h-3" />
              <span>{{ daysRemaining() }} days remaining</span>
            </div>
          }

          <!-- Plan description -->
          @if (planDescription()) {
            <p class="text-xs text-base-content/50 mb-3">
              {{ planDescription() }}
            </p>
          }

          <!-- Context-aware action buttons -->
          <div class="flex flex-wrap gap-2">
            @if (isCommunity()) {
              <!-- Community users -->
              <button
                class="btn btn-primary btn-xs gap-1"
                (click)="openSignup()"
              >
                <lucide-angular [img]="UserPlusIcon" class="w-3 h-3" />
                <span>Create Account</span>
              </button>
              <button
                class="btn btn-outline btn-xs gap-1"
                (click)="enterLicenseKey()"
              >
                <lucide-angular [img]="KeyIcon" class="w-3 h-3" />
                <span>Enter License Key</span>
              </button>
              <button
                class="btn btn-ghost btn-xs gap-1"
                (click)="openPricing()"
              >
                <lucide-angular [img]="ExternalLinkIcon" class="w-3 h-3" />
                <span>View Pricing</span>
              </button>
            } @else if (trialActive()) {
              <!-- Trial users -->
              <button
                class="btn btn-primary btn-xs gap-1"
                (click)="openPricing()"
              >
                <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
                <span>Upgrade to Pro</span>
              </button>
              <button
                class="btn btn-outline btn-xs gap-1"
                (click)="enterLicenseKey()"
              >
                <lucide-angular [img]="KeyIcon" class="w-3 h-3" />
                <span>Enter License Key</span>
              </button>
            } @else if (isPremium()) {
              <!-- Pro users -->
              <button
                class="btn btn-ghost btn-xs gap-1"
                (click)="openPricing()"
              >
                <lucide-angular [img]="ExternalLinkIcon" class="w-3 h-3" />
                <span>Manage Subscription</span>
              </button>
            } @else if (licenseTier() === 'expired') {
              <!-- Expired users -->
              <button
                class="btn btn-primary btn-xs gap-1"
                (click)="openPricing()"
              >
                <lucide-angular [img]="CreditCardIcon" class="w-3 h-3" />
                <span>Renew Subscription</span>
              </button>
              <button
                class="btn btn-outline btn-xs gap-1"
                (click)="enterLicenseKey()"
              >
                <lucide-angular [img]="KeyIcon" class="w-3 h-3" />
                <span>Enter License Key</span>
              </button>
            }
          </div>

          <!-- License Key Input Form (inline modal) -->
          @if (showLicenseInput()) {
            <div
              class="border border-primary rounded-md p-2.5 mt-2 bg-primary bg-opacity-5"
            >
              <div class="flex items-center justify-between mb-2">
                <div class="flex items-center gap-1.5">
                  <lucide-angular
                    [img]="KeyIcon"
                    class="w-3.5 h-3.5 text-primary"
                  />
                  <span class="text-xs font-medium">Enter License Key</span>
                </div>
                <button
                  class="btn btn-ghost btn-xs btn-circle"
                  (click)="cancelLicenseInput()"
                  aria-label="Cancel"
                >
                  <lucide-angular [img]="CloseIcon" class="w-3 h-3" />
                </button>
              </div>
              <div class="flex gap-2">
                <input
                  type="password"
                  class="input input-bordered input-xs flex-1 font-mono"
                  placeholder="ptah_lic_..."
                  [(ngModel)]="licenseKeyInput"
                  (keydown.enter)="submitLicenseKey()"
                  [disabled]="isSubmittingKey()"
                />
                <button
                  class="btn btn-primary btn-xs gap-1"
                  (click)="submitLicenseKey()"
                  [disabled]="isSubmittingKey() || !licenseKeyInput()"
                >
                  @if (isSubmittingKey()) {
                    <lucide-angular
                      [img]="LoaderIcon"
                      class="w-3 h-3 animate-spin"
                    />
                  } @else {
                    <lucide-angular [img]="CheckIcon" class="w-3 h-3" />
                  }
                  <span>{{
                    isSubmittingKey() ? 'Verifying...' : 'Activate'
                  }}</span>
                </button>
              </div>
              @if (licenseKeyError()) {
                <p class="text-xs text-error mt-1">{{ licenseKeyError() }}</p>
              }
              @if (licenseKeySuccess()) {
                <p class="text-xs text-success mt-1">
                  {{ licenseKeySuccess() }}
                </p>
              }
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class LicenseStatusCardComponent {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly chatStore = inject(ChatStore);
  private readonly confirmationDialog = inject(ConfirmationDialogService);

  // Lucide icons
  readonly SparklesIcon = Sparkles;
  readonly ShieldIcon = Shield;
  readonly ClockIcon = Clock;
  readonly CreditCardIcon = CreditCard;
  readonly UserPlusIcon = UserPlus;
  readonly KeyIcon = Key;
  readonly ExternalLinkIcon = ExternalLink;
  readonly AlertTriangleIcon = AlertTriangle;
  readonly LogOutIcon = LogOut;
  readonly CloseIcon = X;
  readonly CheckIcon = Check;
  readonly LoaderIcon = Loader2;

  // License key input state
  readonly showLicenseInput = signal(false);
  readonly licenseKeyInput = signal('');
  readonly licenseKeyError = signal('');
  readonly licenseKeySuccess = signal('');
  readonly isSubmittingKey = signal(false);

  // License status computed signals (derived from ChatStore)
  readonly isPremium = computed(
    () => this.chatStore.licenseStatus()?.isPremium ?? false,
  );

  readonly licenseTier = computed(
    () => this.chatStore.licenseStatus()?.tier ?? 'expired',
  );

  readonly isLoadingLicenseStatus = computed(
    () => this.chatStore.licenseStatus() === null,
  );

  readonly licenseValid = computed(
    () => this.chatStore.licenseStatus()?.valid ?? false,
  );

  readonly trialActive = computed(
    () => this.chatStore.licenseStatus()?.trialActive ?? false,
  );

  readonly trialDaysRemaining = computed(
    () => this.chatStore.licenseStatus()?.trialDaysRemaining ?? null,
  );

  readonly daysRemaining = computed(
    () => this.chatStore.licenseStatus()?.daysRemaining ?? null,
  );

  readonly planDescription = computed(
    () => this.chatStore.licenseStatus()?.plan?.description ?? null,
  );

  readonly isCommunity = computed(
    () => this.chatStore.licenseStatus()?.isCommunity ?? false,
  );

  readonly userEmail = computed(
    () => this.chatStore.licenseStatus()?.user?.email ?? null,
  );

  readonly userFirstName = computed(
    () => this.chatStore.licenseStatus()?.user?.firstName ?? null,
  );

  readonly userLastName = computed(
    () => this.chatStore.licenseStatus()?.user?.lastName ?? null,
  );

  readonly licenseReason = computed(
    () => this.chatStore.licenseStatus()?.reason,
  );

  readonly tierDisplayName = computed(() => {
    switch (this.licenseTier()) {
      case 'pro':
        return 'Pro';
      case 'trial_pro':
        return 'Pro Trial';
      case 'community':
        return 'Community';
      case 'expired':
        return 'Expired';
      default:
        return 'Unknown';
    }
  });

  readonly showTrialInfo = computed(
    () => this.trialActive() && this.trialDaysRemaining() !== null,
  );

  readonly userDisplayName = computed(() => {
    const first = this.userFirstName();
    const last = this.userLastName();
    if (first || last) {
      return [first, last].filter(Boolean).join(' ');
    }
    return this.userEmail();
  });

  readonly showUserName = computed(() => {
    const name = this.userDisplayName();
    return !!name && name !== this.userEmail();
  });

  readonly trialEndDate = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return null;
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    return endDate.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  });

  readonly trialProgress = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return 0;
    return Math.max(0, Math.min(100, (days / TRIAL_DURATION_DAYS) * 100));
  });

  readonly trialUrgencyLevel = computed((): 'info' | 'warning' | 'error' => {
    const days = this.trialDaysRemaining();
    if (days === null) return 'info';
    if (days <= 1) return 'error';
    if (days <= 3) return 'warning';
    return 'info';
  });

  readonly trialStatusText = computed(() => {
    const days = this.trialDaysRemaining();
    if (days === null) return '';
    if (days === 0) return 'Expires today';
    if (days === 1) return 'Expires tomorrow';
    return `${days} days remaining`;
  });

  readonly userInitials = computed(() => {
    const first = this.userFirstName();
    const last = this.userLastName();
    if (first && last) {
      return `${first[0]}${last[0]}`.toUpperCase();
    }
    if (first) {
      return first[0].toUpperCase();
    }
    if (last) {
      return last[0].toUpperCase();
    }
    const email = this.userEmail();
    if (email && email.length > 0) {
      return email[0].toUpperCase();
    }
    return '?';
  });

  // Action methods
  async openSignup(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openSignup',
    });
  }

  enterLicenseKey(): void {
    this.showLicenseInput.set(true);
    this.licenseKeyInput.set('');
    this.licenseKeyError.set('');
    this.licenseKeySuccess.set('');
  }

  cancelLicenseInput(): void {
    this.showLicenseInput.set(false);
    this.licenseKeyInput.set('');
    this.licenseKeyError.set('');
    this.licenseKeySuccess.set('');
  }

  async submitLicenseKey(): Promise<void> {
    const key = this.licenseKeyInput().trim();
    if (!key) return;

    // Client-side format validation
    if (!/^ptah_lic_[a-f0-9]{64}$/.test(key)) {
      this.licenseKeyError.set(
        'Invalid format. Key must start with "ptah_lic_" followed by 64 hex characters.',
      );
      return;
    }

    this.isSubmittingKey.set(true);
    this.licenseKeyError.set('');
    this.licenseKeySuccess.set('');

    try {
      const result = await this.rpcService.call('license:setKey', {
        licenseKey: key,
      });

      if (result.isSuccess() && result.data.success) {
        this.licenseKeySuccess.set(
          `License activated! Plan: ${result.data.plan?.name ?? result.data.tier}. Reloading...`,
        );
        this.licenseKeyInput.set('');
      } else {
        const errorMsg = result.isSuccess() ? result.data.error : result.error;
        this.licenseKeyError.set(
          errorMsg ?? 'License verification failed. Please check your key.',
        );
      }
    } catch {
      this.licenseKeyError.set(
        'Failed to verify license key. Please try again.',
      );
    } finally {
      this.isSubmittingKey.set(false);
    }
  }

  async removeLicenseKey(): Promise<void> {
    const confirmed = await this.confirmationDialog.confirm({
      title: 'Log Out',
      message:
        'Remove your license key and log out? You can enter a new license key after reloading.',
      confirmLabel: 'Log Out',
      cancelLabel: 'Cancel',
      confirmStyle: 'error',
    });

    if (!confirmed) return;

    await this.rpcService.call('license:clearKey', {});
  }

  async openPricing(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }
}
