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
  Eye,
  EyeOff,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import { NativePopoverComponent } from '@ptah-extension/ui';
import { ChatStore } from '../../services/chat.store';

/** One fixed sentence per action (F1): no host, server or transport text reaches the UI. */
const ACTIVATE_KEY_FAILED = 'Could not activate the membership key.';
const LOGOUT_FAILED = 'Could not log out.';

/**
 * LicenseStatusCardComponent — the "Membership & data" section card
 * (TASK_2026_555 Advanced tab, pattern map rows A1-A7).
 *
 * Displays membership status, user identity, and sign-in / key-entry actions.
 * Ptah's local features are free for everyone; this card carries membership
 * identity only — no trial countdowns, no lockouts, no upgrade CTAs.
 *
 * One primary action per region (BRIEF #4): "Create Account" (community) or
 * "Manage Membership" (member) in the header; every other header action is
 * ghost/outline. The Data Portability actions (Export/Import, rows A8/A9)
 * are projected by `AdvancedSettingsComponent` through the
 * `[membership-actions]` / `[membership-notices]` slots — the writes and
 * their results stay owned by that shell.
 *
 * The membership key entry is a credential popover (P12): single password
 * field with show/hide, format check plus the `license:setKey` server verify
 * before anything is shown as active (S-verify), error and success inline.
 * A key typed into the popover never persists in component state once it
 * closes, whatever route closed it (Cancel button, Esc, backdrop).
 *
 * Log out is an inline confirm (P8, S-confirm, no Undo): a successful
 * `license:clearKey` reloads the window host-side, so no success toast exists
 * to show; a failed write keeps the confirm open with the failure inline.
 *
 * Self-contained: injects its own dependencies (ChatStore, ClaudeRpcService).
 */
@Component({
  selector: 'ptah-license-status-card',
  standalone: true,
  imports: [LucideAngularModule, FormsModule, NativePopoverComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!isLoadingLicenseStatus()) {
      <div class="card bg-base-200 border border-base-300 p-3">
        <!-- Header: heading + one primary action; Export/Import are projected by the Advanced shell (A8/A9). -->
        <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div class="flex items-center gap-1.5">
            <lucide-angular
              [img]="ShieldIcon"
              class="w-4 h-4 text-secondary"
              aria-hidden="true"
            />
            <h2 class="text-xs font-bold uppercase tracking-wider text-base-content">
              Membership &amp; data
            </h2>
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <ng-content select="[membership-actions]" />
            @if (isPremium()) {
              <button
                type="button"
                class="btn btn-primary btn-xs gap-1"
                (click)="openPricing()"
              >
                <lucide-angular
                  [img]="ExternalLinkIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
                <span>Manage Membership</span>
              </button>
            } @else {
              <ptah-native-popover
                [isOpen]="keyPopoverOpen()"
                placement="bottom-end"
                [hasBackdrop]="true"
                backdropClass="transparent"
                (closed)="closeKeyPopover()"
              >
                <button
                  trigger
                  type="button"
                  class="btn btn-ghost btn-xs gap-1 text-base-content"
                  (click)="openKeyPopover()"
                  data-testid="membership-key-trigger"
                >
                  <lucide-angular
                    [img]="KeyIcon"
                    class="w-3 h-3"
                    aria-hidden="true"
                  />
                  <span>Enter Membership Key</span>
                </button>
                <div
                  content
                  role="dialog"
                  aria-labelledby="membership-key-popover-title"
                  class="w-80 max-w-[calc(100vw-2rem)] p-3 text-xs"
                  data-testid="membership-key-popover"
                >
                  <div class="flex items-center justify-between gap-2 mb-2">
                    <div class="flex items-center gap-1.5">
                      <lucide-angular
                        [img]="KeyIcon"
                        class="w-3.5 h-3.5 text-primary"
                        aria-hidden="true"
                      />
                      <h3
                        id="membership-key-popover-title"
                        class="text-xs font-bold text-base-content"
                      >
                        Enter Membership Key
                      </h3>
                    </div>
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs btn-square"
                      (click)="closeKeyPopover()"
                      aria-label="Close"
                    >
                      <lucide-angular
                        [img]="CloseIcon"
                        class="w-3 h-3"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <label
                    for="membership-key-input"
                    class="block text-[11px] font-semibold text-base-content-muted mb-1"
                  >
                    Membership key
                  </label>
                  <div class="relative">
                    <input
                      id="membership-key-input"
                      [attr.type]="keyVisible() ? 'text' : 'password'"
                      autocomplete="off"
                      spellcheck="false"
                      class="input input-bordered input-sm w-full pr-9 font-mono text-xs text-base-content"
                      placeholder="ptah_lic_..."
                      aria-describedby="membership-key-help"
                      [(ngModel)]="licenseKeyInput"
                      (keydown.enter)="submitLicenseKey()"
                      [disabled]="isSubmittingKey()"
                      data-testid="membership-key-input"
                    />
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs absolute right-1 top-1"
                      (click)="keyVisible.set(!keyVisible())"
                      [attr.aria-label]="
                        keyVisible() ? 'Hide membership key' : 'Show membership key'
                      "
                      [attr.aria-pressed]="keyVisible()"
                      data-testid="membership-key-visibility"
                    >
                      <lucide-angular
                        [img]="keyVisible() ? EyeOffIcon : EyeIcon"
                        class="h-3.5 w-3.5"
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                  <p
                    id="membership-key-help"
                    class="text-[11px] text-base-content-muted mt-1"
                  >
                    Starts with "ptah_lic_" followed by 64 hex characters.
                  </p>
                  <button
                    type="button"
                    class="btn btn-primary btn-xs gap-1 mt-2 w-full"
                    (click)="submitLicenseKey()"
                    [disabled]="isSubmittingKey() || !licenseKeyInput()"
                    data-testid="membership-key-activate"
                  >
                    @if (isSubmittingKey()) {
                      <span
                        class="loading loading-spinner loading-xs"
                        aria-hidden="true"
                      ></span>
                    } @else {
                      <lucide-angular
                        [img]="CheckIcon"
                        class="w-3 h-3"
                        aria-hidden="true"
                      />
                    }
                    <span>{{
                      isSubmittingKey() ? 'Verifying...' : 'Activate'
                    }}</span>
                  </button>
                  @if (licenseKeyError()) {
                    <p
                      role="alert"
                      class="flex items-center gap-1.5 mt-2 text-base-content"
                      data-testid="membership-key-error"
                    >
                      <span
                        class="h-2 w-2 shrink-0 rounded-full bg-error"
                        aria-hidden="true"
                      ></span>
                      {{ licenseKeyError() }}
                    </p>
                  }
                  @if (licenseKeySuccess()) {
                    <p
                      role="status"
                      class="flex items-center gap-1.5 mt-2 text-base-content"
                      data-testid="membership-key-success"
                    >
                      <span
                        class="h-2 w-2 shrink-0 rounded-full bg-success"
                        aria-hidden="true"
                      ></span>
                      {{ licenseKeySuccess() }}
                    </p>
                  }
                </div>
              </ptah-native-popover>
              <button
                type="button"
                class="btn btn-ghost btn-xs gap-1 text-base-content"
                (click)="openPricing()"
              >
                <lucide-angular
                  [img]="SparklesIcon"
                  class="w-3 h-3 text-secondary"
                  aria-hidden="true"
                />
                <span>Explore Ptah Builders</span>
              </button>
              <button
                type="button"
                class="btn btn-primary btn-xs gap-1"
                (click)="openSignup()"
              >
                <lucide-angular
                  [img]="UserPlusIcon"
                  class="w-3 h-3"
                  aria-hidden="true"
                />
                <span>Create Account</span>
              </button>
            }
          </div>
        </div>

        <!-- Import confirm / outcome, projected by the Advanced shell (A9). -->
        <ng-content select="[membership-notices]" />

        <!-- Membership badges (A1): outline badges, colour on the dot/icon only. -->
        <div class="flex flex-wrap items-center gap-2 mb-2">
          @if (isPremium()) {
            <span class="badge badge-outline badge-xs gap-1 text-base-content">
              <lucide-angular
                [img]="SparklesIcon"
                class="w-2.5 h-2.5 text-secondary"
                aria-hidden="true"
              />
              <span>Builder</span>
            </span>
          } @else {
            <span class="badge badge-outline badge-xs text-base-content">
              Community
            </span>
          }
          @if (licenseValid() && !licenseReason()) {
            <span class="badge badge-outline badge-xs gap-1 text-base-content">
              <span
                class="w-2 h-2 rounded-full bg-success"
                aria-hidden="true"
              ></span>
              <span>Active</span>
            </span>
          } @else if (licenseValid() && licenseReason()) {
            <span class="badge badge-outline badge-xs gap-1 text-base-content">
              <span
                class="w-2 h-2 rounded-full bg-warning"
                aria-hidden="true"
              ></span>
              <span>Needs Attention</span>
            </span>
          }
        </div>

        <!-- Membership key issue: key not found or inactive (A2). -->
        @if (
          isCommunity() &&
          (licenseReason() === 'no_license' || licenseReason() === 'expired')
        ) {
          <div
            class="flex items-start gap-2 rounded border border-warning/40 bg-warning/10 p-2.5 mb-2"
            role="alert"
            data-testid="membership-key-alert"
          >
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="w-3.5 h-3.5 mt-0.5 shrink-0 text-warning"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <p class="text-xs font-medium text-base-content mb-1">
                Membership Key Not Active
              </p>
              <p class="text-xs text-base-content-muted mb-2">
                Your membership key could not be verified. Re-enter your key to
                restore your Ptah Builders membership. Ptah's local features
                remain available either way.
              </p>
              <button
                type="button"
                class="btn btn-outline btn-xs gap-1 text-base-content"
                (click)="openKeyPopover()"
                data-testid="membership-key-alert-action"
              >
                <lucide-angular
                  [img]="KeyIcon"
                  class="w-3 h-3 text-warning"
                  aria-hidden="true"
                />
                <span>Re-enter Membership Key</span>
              </button>
            </div>
          </div>
        }

        <!-- User profile (A3) with the inline Log out confirm (A4). -->
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
              <div class="text-xs text-base-content-muted truncate">
                {{ userEmail() }}
              </div>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-xs gap-1 shrink-0 text-base-content"
              (click)="requestLogout()"
              aria-label="Remove membership key and log out"
              data-testid="logout-button"
            >
              <lucide-angular
                [img]="LogOutIcon"
                class="w-3 h-3 text-error"
                aria-hidden="true"
              />
              <span>Log Out</span>
            </button>
          </div>
          @if (confirmingLogout()) {
            <div
              role="group"
              aria-label="Confirm log out"
              class="rounded border border-base-300 p-2 mb-2"
              data-testid="logout-confirm"
            >
              <p class="text-xs text-base-content mb-2">
                Remove your membership key and log out? You can enter a new key
                after reloading.
              </p>
              @if (logoutError()) {
                <p
                  role="alert"
                  class="flex items-center gap-1.5 text-xs text-base-content mb-2"
                  data-testid="logout-error"
                >
                  <span
                    class="h-2 w-2 shrink-0 rounded-full bg-error"
                    aria-hidden="true"
                  ></span>
                  {{ logoutError() }}
                </p>
              }
              <div class="flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-outline btn-xs border-error text-base-content"
                  [disabled]="isLoggingOut()"
                  (click)="confirmLogout()"
                  data-testid="logout-confirm-button"
                >
                  @if (isLoggingOut()) {
                    <span
                      class="loading loading-spinner loading-xs"
                      aria-hidden="true"
                    ></span>
                  }
                  <span>Log Out</span>
                </button>
                <button
                  type="button"
                  class="btn btn-ghost btn-xs text-base-content"
                  [disabled]="isLoggingOut()"
                  (click)="cancelLogout()"
                >
                  Cancel
                </button>
              </div>
            </div>
          }
        }

        <!-- Plan description (A7). -->
        @if (planDescription()) {
          <p class="text-xs text-base-content-muted">
            {{ planDescription() }}
          </p>
        }
      </div>
    }
  `,
})
export class LicenseStatusCardComponent {
  private readonly rpcService = inject(ClaudeRpcService);
  private readonly chatStore = inject(ChatStore);

  readonly SparklesIcon = Sparkles;
  readonly ShieldIcon = Shield;
  readonly UserPlusIcon = UserPlus;
  readonly KeyIcon = Key;
  readonly ExternalLinkIcon = ExternalLink;
  readonly AlertTriangleIcon = AlertTriangle;
  readonly LogOutIcon = LogOut;
  readonly CloseIcon = X;
  readonly CheckIcon = Check;
  readonly EyeIcon = Eye;
  readonly EyeOffIcon = EyeOff;

  /** The membership key popover (A5, P12). */
  readonly keyPopoverOpen = signal(false);
  readonly keyVisible = signal(false);
  readonly licenseKeyInput = signal('');
  readonly licenseKeyError = signal('');
  readonly licenseKeySuccess = signal('');
  readonly isSubmittingKey = signal(false);

  /** The inline Log out confirm (A4, P8). */
  readonly confirmingLogout = signal(false);
  readonly isLoggingOut = signal(false);
  readonly logoutError = signal('');

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

  /** Opens the key popover from either trigger; a fresh open starts empty. */
  openKeyPopover(): void {
    this.resetKeyState();
    this.keyPopoverOpen.set(true);
  }

  /**
   * Closes the popover and drops every draft field, so a typed key never
   * persists in component state after it closes (Cancel, Esc and backdrop all
   * land here — the `(closed)` output covers the last two).
   */
  closeKeyPopover(): void {
    this.keyPopoverOpen.set(false);
    this.resetKeyState();
  }

  /**
   * Activates the membership key (S-verify): the format is checked locally,
   * then `license:setKey` verifies against the server; success is shown only
   * from the write's own result (D15). The app reloads on success, so the
   * success copy stays as it is.
   */
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
        this.licenseKeyError.set(ACTIVATE_KEY_FAILED);
      }
    } catch {
      // A thrown transport error gets the same fixed sentence.
      this.licenseKeyError.set(ACTIVATE_KEY_FAILED);
    } finally {
      this.isSubmittingKey.set(false);
    }
  }

  /** Shows the inline confirm; a failed earlier attempt is cleared. */
  requestLogout(): void {
    this.logoutError.set('');
    this.confirmingLogout.set(true);
  }

  cancelLogout(): void {
    this.confirmingLogout.set(false);
    this.logoutError.set('');
  }

  /**
   * Confirmed log out (S-confirm, no Undo). A successful `license:clearKey`
   * reloads the window host-side, so nothing is shown on success; a failed
   * write keeps the confirm open with the failure inline (D15).
   */
  async confirmLogout(): Promise<void> {
    if (this.isLoggingOut()) return;
    this.isLoggingOut.set(true);
    this.logoutError.set('');
    try {
      const result = await this.rpcService.call('license:clearKey', {});
      if (result.isSuccess() && result.data.success) {
        this.confirmingLogout.set(false);
      } else {
        this.logoutError.set(LOGOUT_FAILED);
      }
    } catch {
      // A thrown transport error gets the same fixed sentence.
      this.logoutError.set(LOGOUT_FAILED);
    } finally {
      this.isLoggingOut.set(false);
    }
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

  private resetKeyState(): void {
    this.licenseKeyInput.set('');
    this.licenseKeyError.set('');
    this.licenseKeySuccess.set('');
    this.keyVisible.set(false);
  }
}