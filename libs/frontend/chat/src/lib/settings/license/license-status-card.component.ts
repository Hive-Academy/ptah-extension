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
import { ChatStore } from '../../services/chat.store';
import { ConfirmationDialogService } from '@ptah-extension/chat-state';

/**
 * LicenseStatusCardComponent — Ptah Builders membership card.
 *
 * Displays membership status, user identity, and sign-in / key-entry actions.
 * Ptah's local features are free for everyone; this card carries membership
 * identity only — no trial countdowns, no lockouts, no upgrade CTAs.
 *
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
              Membership
            </h2>
          </div>

          <!-- Membership badge and validity -->
          <div class="flex items-center gap-2 mb-2">
            @if (isPremium()) {
              <span class="badge badge-primary badge-xs gap-1">
                <lucide-angular [img]="SparklesIcon" class="w-2.5 h-2.5" />
                <span>Builder</span>
              </span>
            } @else {
              <span class="badge badge-ghost badge-xs">Community</span>
            }
            @if (licenseValid() && !licenseReason()) {
              <span class="text-xs text-success">Active</span>
            } @else if (licenseValid() && licenseReason()) {
              <span class="text-xs text-warning">Needs Attention</span>
            }
          </div>

          <!-- Membership key issue: key not found or inactive -->
          @if (
            isCommunity() &&
            (licenseReason() === 'no_license' ||
              licenseReason() === 'expired' ||
              licenseReason() === 'trial_ended')
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
                  >Membership Key Not Active</span
                >
              </div>
              <p class="text-xs text-base-content/60 mb-2">
                Your membership key could not be verified. Re-enter your key to
                restore your Ptah Builders membership. Ptah's local features
                remain available either way.
              </p>
              <button
                class="btn btn-warning btn-xs w-full gap-1"
                (click)="enterLicenseKey()"
              >
                <lucide-angular [img]="KeyIcon" class="w-3 h-3" />
                Re-enter Membership Key
              </button>
            </div>
          }

          <!-- User Profile -->
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
                aria-label="Remove membership key and log out"
              >
                <lucide-angular [img]="LogOutIcon" class="w-3 h-3" />
                <span>Log Out</span>
              </button>
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
            @if (isPremium()) {
              <!-- Active members -->
              <button
                class="btn btn-ghost btn-xs gap-1"
                (click)="openPricing()"
              >
                <lucide-angular [img]="ExternalLinkIcon" class="w-3 h-3" />
                <span>Manage Membership</span>
              </button>
            } @else {
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
                <span>Enter Membership Key</span>
              </button>
              <button
                class="btn btn-ghost btn-xs gap-1"
                (click)="openPricing()"
              >
                <lucide-angular [img]="SparklesIcon" class="w-3 h-3" />
                <span>Explore Ptah Builders</span>
              </button>
            }
          </div>

          <!-- Membership Key Input Form (inline) -->
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
                  <span class="text-xs font-medium">Enter Membership Key</span>
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
  readonly SparklesIcon = Sparkles;
  readonly ShieldIcon = Shield;
  readonly UserPlusIcon = UserPlus;
  readonly KeyIcon = Key;
  readonly ExternalLinkIcon = ExternalLink;
  readonly AlertTriangleIcon = AlertTriangle;
  readonly LogOutIcon = LogOut;
  readonly CloseIcon = X;
  readonly CheckIcon = Check;
  readonly LoaderIcon = Loader2;
  readonly showLicenseInput = signal(false);
  readonly licenseKeyInput = signal('');
  readonly licenseKeyError = signal('');
  readonly licenseKeySuccess = signal('');
  readonly isSubmittingKey = signal(false);

  readonly isPremium = computed(
    () => this.chatStore.licenseStatus()?.isPremium ?? false,
  );

  readonly isLoadingLicenseStatus = computed(
    () => this.chatStore.licenseStatus() === null,
  );

  readonly licenseValid = computed(
    () => this.chatStore.licenseStatus()?.valid ?? false,
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
          `Membership activated! Plan: ${result.data.plan?.name ?? result.data.tier}. Reloading...`,
        );
        this.licenseKeyInput.set('');
      } else {
        const errorMsg = result.isSuccess() ? result.data.error : result.error;
        this.licenseKeyError.set(
          errorMsg ?? 'Membership verification failed. Please check your key.',
        );
      }
    } catch {
      this.licenseKeyError.set(
        'Failed to verify membership key. Please try again.',
      );
    } finally {
      this.isSubmittingKey.set(false);
    }
  }

  async removeLicenseKey(): Promise<void> {
    const confirmed = await this.confirmationDialog.confirm({
      title: 'Log Out',
      message:
        'Remove your membership key and log out? You can enter a new key after reloading.',
      confirmLabel: 'Log Out',
      cancelLabel: 'Cancel',
      confirmStyle: 'error',
    });

    if (!confirmed) return;

    await this.rpcService.call('license:clearKey', {});
  }

  /**
   * Open an external page (Ptah Builders / membership) in the browser via the
   * host `ptah.openPricing` command. The target URL is resolved host-side.
   */
  async openPricing(): Promise<void> {
    await this.rpcService.call('command:execute', {
      command: 'ptah.openPricing',
    });
  }
}
