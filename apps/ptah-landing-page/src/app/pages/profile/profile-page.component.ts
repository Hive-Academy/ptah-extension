import { HttpClient } from '@angular/common/http';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  OnDestroy,
  OnInit,
  signal,
} from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import {
  ViewportAnimationConfig,
  ViewportAnimationDirective,
} from '@hive-academy/angular-gsap';
import {
  LucideAngularModule,
  Settings,
  Shield,
  GraduationCap,
  MessageSquare,
  User,
} from 'lucide-angular';
import { Subject, takeUntil } from 'rxjs';
import { NavigationComponent } from '../../components/navigation.component';
import { AuthService } from '../../services/auth.service';
import { SSEEventsService } from '../../services/sse-events.service';
import {
  ProfileDetailsComponent,
  ProfileFeaturesComponent,
  ProfileHeaderComponent,
} from './components';
import { LicenseData } from './models/license-data.interface';
import { SessionsGridComponent } from '../sessions/components/sessions-grid.component';
import { ContactFormComponent } from '../contact/components/contact-form.component';

export type ProfileTab = 'account' | 'sessions' | 'contact';

/**
 * ProfilePageComponent - Enhanced user account dashboard
 *
 * Orchestrating component that composes:
 * - NavigationComponent: Top navigation bar
 * - ProfileHeaderComponent: Hero with avatar, stats, badges
 * - ProfileDetailsComponent: Account info and subscription status
 * - ProfileFeaturesComponent: Categorized feature list
 *
 * Responsibilities:
 * - Data fetching from /api/v1/licenses/me
 * - Loading/error state management
 * - Logout handling
 * - Action buttons
 *
 * Angular 21 patterns:
 * - signal() for state management
 * - inject() for DI
 * - Composition over inheritance
 * - Tailwind/DaisyUI with Anubis theme
 *
 * Protected Route: Requires authentication via AuthGuard
 * Backend API: GET /api/v1/licenses/me
 */
@Component({
  selector: 'ptah-profile-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ViewportAnimationDirective,
    RouterLink,
    LucideAngularModule,
    ProfileHeaderComponent,
    ProfileDetailsComponent,
    ProfileFeaturesComponent,
    NavigationComponent,
    SessionsGridComponent,
    ContactFormComponent,
  ],
  template: `
    <div class="min-h-screen bg-base-100">
      <!-- Navigation Header -->
      <ptah-navigation />

      <!-- Loading State -->
      @if (isLoading()) {
        <div class="min-h-screen flex items-center justify-center">
          <div class="text-center">
            <span
              class="loading loading-spinner loading-lg text-secondary"
            ></span>
            <p class="mt-4 text-neutral-content">Loading your account...</p>
          </div>
        </div>
      }

      <!-- Error State -->
      @if (errorMessage() && !isLoading()) {
        <div class="min-h-screen flex items-center justify-center p-4">
          <div
            class="max-w-md w-full bg-base-200/95 backdrop-blur-xl border border-error/30 rounded-3xl p-8 shadow-2xl"
          >
            <div class="alert alert-error mb-4">
              <h3 class="font-bold">Error Loading Account</h3>
              <p>{{ errorMessage() }}</p>
            </div>
            <button class="btn btn-error w-full" (click)="loadLicense()">
              Retry
            </button>
          </div>
        </div>
      }

      <!-- Main Profile Content -->
      @if (license() && !isLoading()) {
        <!-- Profile Header with Avatar, Stats, Badges -->
        <ptah-profile-header [license]="license()" />

        <!-- Content Container -->
        <div class="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-6">
          <!-- Tab Navigation -->
          <div
            class="flex gap-1 bg-base-200/50 border border-white/10 rounded-xl p-1 mb-6"
            role="tablist"
          >
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="activeTab() === 'account'"
              class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
              [class]="
                activeTab() === 'account'
                  ? 'bg-base-300 text-amber-400 shadow-sm'
                  : 'text-white/50 hover:text-white/80 hover:bg-base-300/50'
              "
              (click)="activeTab.set('account')"
            >
              <lucide-angular
                [img]="UserIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              Account
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="activeTab() === 'sessions'"
              class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
              [class]="
                activeTab() === 'sessions'
                  ? 'bg-base-300 text-amber-400 shadow-sm'
                  : 'text-white/50 hover:text-white/80 hover:bg-base-300/50'
              "
              (click)="activeTab.set('sessions')"
            >
              <lucide-angular
                [img]="GraduationCapIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              Sessions
            </button>
            <button
              type="button"
              role="tab"
              [attr.aria-selected]="activeTab() === 'contact'"
              class="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all duration-200"
              [class]="
                activeTab() === 'contact'
                  ? 'bg-base-300 text-amber-400 shadow-sm'
                  : 'text-white/50 hover:text-white/80 hover:bg-base-300/50'
              "
              (click)="activeTab.set('contact')"
            >
              <lucide-angular
                [img]="MessageSquareIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              Contact
            </button>
          </div>

          <!-- Tab Content -->
          @switch (activeTab()) {
            @case ('account') {
              <!-- Account Details & Upgrade CTA -->
              <ptah-profile-details
                [license]="license()"
                [isSyncing]="isSyncing()"
                [syncError]="syncError()"
                [syncSuccess]="syncSuccess()"
                [licenseKey]="licenseKey()"
                [isRevealingKey]="isRevealingKey()"
                [revealKeyError]="revealKeyError()"
                (syncRequested)="handleSyncWithPaddle()"
                (manageSubscriptionRequested)="handleManageSubscription()"
                (revealKeyRequested)="handleRevealLicenseKey()"
              />

              <!-- Features Section -->
              <div class="mt-6">
                <ptah-profile-features [features]="license()?.features ?? []" />
              </div>

              <!-- Actions -->
              <div
                viewportAnimation
                [viewportConfig]="actionsConfig"
                class="mt-6 mb-12 grid grid-cols-1 sm:grid-cols-2 gap-4"
              >
                <a routerLink="/pricing" class="btn btn-outline btn-secondary">
                  <lucide-angular
                    [img]="SettingsIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                  {{
                    license()?.plan === 'community' ||
                    license()?.plan?.startsWith('trial_')
                      ? 'View Pricing Plans'
                      : 'Manage Subscription'
                  }}
                </a>
                <a
                  href="https://docs.ptah.live"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="btn btn-ghost"
                >
                  <lucide-angular
                    [img]="ShieldIcon"
                    class="w-4 h-4"
                    aria-hidden="true"
                  />
                  Documentation
                </a>
              </div>
            }
            @case ('sessions') {
              <!-- Sessions Tab -->
              <div class="mb-8">
                <ptah-sessions-grid />
              </div>
            }
            @case ('contact') {
              <!-- Contact Tab -->
              <div class="mb-8">
                <ptah-contact-form />
              </div>
            }
          }
        </div>
      }
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
export class ProfilePageComponent implements OnInit, OnDestroy {
  /** Lucide icon references */
  public readonly SettingsIcon = Settings;
  public readonly ShieldIcon = Shield;
  public readonly GraduationCapIcon = GraduationCap;
  public readonly MessageSquareIcon = MessageSquare;
  public readonly UserIcon = User;

  private readonly http = inject(HttpClient);
  private readonly authService = inject(AuthService);
  private readonly sseService = inject(SSEEventsService);
  private readonly router = inject(Router);

  /** Subject for managing subscriptions cleanup */
  private readonly destroy$ = new Subject<void>();

  /** Timeout IDs for cleanup on destroy */
  private syncSuccessTimeoutId?: ReturnType<typeof setTimeout>;
  private syncErrorTimeoutId?: ReturnType<typeof setTimeout>;

  // Tab state
  public readonly activeTab = signal<ProfileTab>('account');

  // State signals
  public readonly license = signal<LicenseData | null>(null);
  public readonly isLoading = signal(true);
  public readonly errorMessage = signal('');

  // Sync state signals
  public readonly isSyncing = signal(false);
  public readonly syncError = signal<string | null>(null);
  public readonly syncSuccess = signal(false);

  // License key reveal state signals
  public readonly licenseKey = signal<string | null>(null);
  public readonly isRevealingKey = signal(false);
  public readonly revealKeyError = signal<string | null>(null);

  // TASK_2025_143: Downgrade state
  public readonly isDowngrading = signal(false);

  // Animation config for actions
  public readonly actionsConfig: ViewportAnimationConfig = {
    animation: 'fadeIn',
    duration: 0.4,
    threshold: 0.1,
    delay: 0.4,
  };

  public ngOnInit(): void {
    this.loadLicense();
    this.setupSSEListeners();
  }

  public ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    // Clear any pending timeouts to prevent memory leaks
    if (this.syncSuccessTimeoutId) {
      clearTimeout(this.syncSuccessTimeoutId);
    }
    if (this.syncErrorTimeoutId) {
      clearTimeout(this.syncErrorTimeoutId);
    }
    // Keep SSE connection alive for other components
    // Disconnect is handled by logout or auth service
  }

  public loadLicense(): void {
    this.isLoading.set(true);
    this.errorMessage.set('');

    this.http.get<LicenseData>('/api/v1/licenses/me').subscribe({
      next: (data) => {
        this.license.set(data);
        this.isLoading.set(false);

        // Connect to SSE for real-time updates
        // The service handles authentication via ticket (obtained from JWT session)
        this.sseService.connect();
      },
      error: (error) => {
        this.isLoading.set(false);
        this.errorMessage.set(
          error.error?.message || 'Failed to load account details',
        );
      },
    });
  }

  /**
   * Setup SSE listeners for real-time license updates
   * Refreshes license data when server emits license.updated or subscription status changes
   */
  private setupSSEListeners(): void {
    // Listen for license updates (plan changes, status updates)
    this.sseService.licenseUpdated$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        console.log('[Profile] License updated event received:', event);
        // Refresh license data from server to get complete updated info
        this.refreshLicenseData();
      });

    // Listen for subscription status changes
    this.sseService.subscriptionStatus$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        console.log('[Profile] Subscription status changed:', event);
        // Refresh license data to update UI
        this.refreshLicenseData();
      });

    // Listen for reconciliation completed events
    this.sseService.reconciliationCompleted$
      .pipe(takeUntil(this.destroy$))
      .subscribe((event) => {
        console.log(
          '[Profile] Reconciliation completed event received:',
          event,
        );
        // Refresh license data to reflect synced state
        this.refreshLicenseData();

        // Show success feedback if sync was successful
        if (event.data.success) {
          this.syncSuccess.set(true);
          // Clear any previous timeout before setting a new one
          if (this.syncSuccessTimeoutId) {
            clearTimeout(this.syncSuccessTimeoutId);
          }
          this.syncSuccessTimeoutId = setTimeout(() => {
            this.syncSuccess.set(false);
          }, 5000);
        }
      });

    // Log connection events for debugging
    this.sseService.connected$.pipe(takeUntil(this.destroy$)).subscribe(() => {
      console.log('[Profile] SSE connection established');
    });
  }

  /**
   * Refresh license data without showing loading state
   * Used for real-time updates where we want seamless UI updates
   */
  private refreshLicenseData(): void {
    this.http.get<LicenseData>('/api/v1/licenses/me').subscribe({
      next: (data) => {
        this.license.set(data);
        // Clear revealed license key if license is no longer active
        if (data.status !== 'active') {
          this.licenseKey.set(null);
        }
        console.log(
          '[Profile] License data refreshed:',
          data.plan,
          data.status,
        );
      },
      error: (error) => {
        console.error('[Profile] Failed to refresh license data:', error);
        // Don't show error to user for background refresh
      },
    });
  }

  /**
   * Handle sync with Paddle request from profile details component
   *
   * Calls POST /api/v1/subscriptions/reconcile to sync local data with Paddle.
   * Updates UI with loading states and success/error feedback.
   */
  public handleSyncWithPaddle(): void {
    this.isSyncing.set(true);
    this.syncError.set(null);
    this.syncSuccess.set(false);

    this.http
      .post<{
        success: boolean;
        changes: {
          subscriptionUpdated: boolean;
          licenseUpdated: boolean;
          statusBefore: string;
          statusAfter: string;
        };
        errors?: string[];
      }>('/api/v1/subscriptions/reconcile', {})
      .subscribe({
        next: (response) => {
          this.isSyncing.set(false);

          if (response.success) {
            this.syncSuccess.set(true);
            console.log('[Profile] Sync completed:', response.changes);

            // Refresh license data to get updated information
            this.refreshLicenseData();

            // Clear success message after 5 seconds
            // Clear any previous timeout before setting a new one
            if (this.syncSuccessTimeoutId) {
              clearTimeout(this.syncSuccessTimeoutId);
            }
            this.syncSuccessTimeoutId = setTimeout(() => {
              this.syncSuccess.set(false);
            }, 5000);
          } else {
            // Reconciliation returned errors
            const errorMsg =
              response.errors?.join(', ') || 'Sync completed with errors';
            this.syncError.set(errorMsg);
            console.error('[Profile] Sync errors:', response.errors);
          }
        },
        error: (error) => {
          this.isSyncing.set(false);
          const errorMsg =
            error.error?.message ||
            'Failed to sync with Paddle. Please try again.';
          this.syncError.set(errorMsg);
          console.error('[Profile] Sync failed:', error);
        },
      });
  }

  /**
   * Handle manage subscription request from profile details component
   *
   * Calls POST /api/v1/subscriptions/portal-session to get a Paddle customer portal URL.
   * Opens the portal in a new tab.
   */
  public handleManageSubscription(): void {
    this.http
      .post<{
        url: string;
        expiresAt: string;
      }>('/api/v1/subscriptions/portal-session', {})
      .subscribe({
        next: (response) => {
          // Open customer portal in new tab
          window.open(response.url, '_blank', 'noopener,noreferrer');
          console.log('[Profile] Opened customer portal');
        },
        error: (error) => {
          // Show error to user
          const errorMsg =
            error.error?.message ||
            'Failed to open subscription management. Please try again.';
          this.syncError.set(errorMsg);
          console.error('[Profile] Failed to get portal session:', error);

          // Clear error after 5 seconds
          // Clear any previous timeout before setting a new one
          if (this.syncErrorTimeoutId) {
            clearTimeout(this.syncErrorTimeoutId);
          }
          this.syncErrorTimeoutId = setTimeout(() => {
            this.syncError.set(null);
          }, 5000);
        },
      });
  }

  /**
   * Handle reveal license key request from profile details component
   *
   * Calls POST /api/v1/licenses/me/reveal-key to securely retrieve the license key.
   * Updates UI with loading states and success/error feedback.
   */
  public handleRevealLicenseKey(): void {
    this.isRevealingKey.set(true);
    this.revealKeyError.set(null);

    this.http
      .post<{
        success: boolean;
        licenseKey?: string;
        message?: string;
        plan?: string;
      }>('/api/v1/licenses/me/reveal-key', {})
      .subscribe({
        next: (response) => {
          this.isRevealingKey.set(false);
          if (response.success && response.licenseKey) {
            this.licenseKey.set(response.licenseKey);
          } else {
            this.revealKeyError.set(
              response.message || 'Failed to retrieve license key',
            );
          }
        },
        error: (error) => {
          this.isRevealingKey.set(false);
          if (error.status === 429) {
            this.revealKeyError.set(
              'Too many requests. Please wait a moment and try again.',
            );
          } else if (error.status === 401) {
            this.revealKeyError.set(
              'Your session has expired. Please log in again.',
            );
          } else {
            this.revealKeyError.set(
              error.error?.message ||
                'Failed to retrieve license key. Please try again.',
            );
          }
        },
      });
  }

  /**
   * Handle trial downgrade to Community plan
   *
   * TASK_2025_143: Called when user clicks "Continue with Community" and trial has expired
   *
   * Process:
   * 1. Call POST /api/v1/licenses/downgrade-to-community
   * 2. Backend updates database + emits SSE event
   * 3. SSE listener auto-refreshes license data
   * 4. Modal auto-dismisses
   *
   * No manual refresh needed - SSE handles it!
   */
  public handleDowngradeToCommunity(): void {
    this.isDowngrading.set(true);

    this.http
      .post<{
        success: boolean;
        plan: string;
        status: string;
        message: string;
      }>('/api/v1/licenses/downgrade-to-community', {})
      .subscribe({
        next: (response) => {
          console.log('[Profile] Downgrade successful:', response);
          this.isDowngrading.set(false);

          // SSE listener will auto-refresh license data when backend emits license.updated event
          // No need to manually call refreshLicenseData() here
        },
        error: (error) => {
          console.error('[Profile] Downgrade failed:', error);
          this.isDowngrading.set(false);

          // Show user-friendly error message
          const errorMsg =
            error.error?.message ||
            'Failed to downgrade. Please try again or contact support.';

          // For validation errors (trial not ended yet), just log
          // The user shouldn't see this error since modal validates daysRemaining
          if (error.status === 400) {
            console.warn('[Profile] Validation error:', errorMsg);
          } else {
            // For other errors, could show toast/alert (future enhancement)
            console.error('[Profile] Unexpected error:', errorMsg);
          }
        },
      });
  }
}
