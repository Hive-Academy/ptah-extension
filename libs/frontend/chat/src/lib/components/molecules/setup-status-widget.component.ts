import {
  Component,
  OnInit,
  OnDestroy,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';

/**
 * SetupStatus interface - Agent configuration status information
 */
export interface SetupStatus {
  isConfigured: boolean;
  agentCount: number;
  lastModified: string | null;
  projectAgents: string[];
  userAgents: string[];
}

/**
 * SetupStatusWidgetComponent - Agent configuration status widget
 *
 * Complexity Level: 2 (Medium - RPC communication + state management)
 * Patterns: Signal-based state, RPC messaging, DaisyUI styling
 *
 * Features:
 * - Fetches agent setup status on component init
 * - Displays agent count and last modified timestamp
 * - Shows "Configure" or "Update" button based on configuration status
 * - Launches setup wizard via RPC message
 * - Handles loading, error, and success states
 *
 * SOLID Principles:
 * - Single Responsibility: Display agent setup status and launch wizard
 * - Open/Closed: Extensible via signals, closed for modification
 * - Dependency Inversion: Depends on VSCodeService abstraction
 */
@Component({
  selector: 'ptah-setup-status-widget',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card bg-base-200 border border-base-300 mb-4">
      <div class="card-body p-4">
        @if (isLoading()) {
        <!-- Loading skeleton -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3 flex-1">
            <div class="skeleton w-10 h-10 rounded-full shrink-0"></div>
            <div class="flex-1">
              <div class="skeleton h-4 w-32 mb-2"></div>
              <div class="skeleton h-3 w-48"></div>
            </div>
          </div>
          <div class="skeleton h-8 w-24"></div>
        </div>
        } @else if (error()) {
        <!-- Error state with retry button -->
        <div class="alert alert-error">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="stroke-current shrink-0 h-6 w-6"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div class="flex-1">
            <span>{{ error() }}</span>
          </div>
          <button
            class="btn btn-sm"
            (click)="fetchStatus()"
            type="button"
            aria-label="Retry fetching setup status"
          >
            Retry
          </button>
        </div>
        } @else if (status()) {
        <!-- Agent Status Display -->
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <div class="avatar placeholder">
              <div class="bg-primary text-primary-content rounded-full w-10">
                <span class="text-lg">🤖</span>
              </div>
            </div>
            <div>
              <h4 class="font-semibold text-sm">Claude Agents</h4>
              @if (status()!.isConfigured) {
              <p class="text-xs text-base-content/70">
                {{ status()!.agentCount }} agent{{
                  status()!.agentCount !== 1 ? 's' : ''
                }}
                configured @if (status()!.lastModified) {
                <span>
                  • Updated
                  {{ formatRelativeTime(status()!.lastModified!) }}</span
                >
                }
              </p>
              } @else {
              <p class="text-xs text-base-content/70">
                No agents configured yet
              </p>
              }
            </div>
          </div>
          <button
            class="btn btn-primary btn-sm"
            [disabled]="launching()"
            (click)="launchWizard()"
            type="button"
          >
            @if (launching()) {
            <span class="loading loading-spinner loading-xs"></span>
            <span>Launching...</span>
            } @else {
            <span>{{
              status()!.isConfigured
                ? 'Update Configuration'
                : 'Configure Agents'
            }}</span>
            }
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
export class SetupStatusWidgetComponent implements OnInit, OnDestroy {
  private readonly vscodeService = inject(VSCodeService);

  // Signals for reactive state
  readonly status = signal<SetupStatus | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly launching = signal<boolean>(false);

  // Message listener cleanup
  private messageListener: ((event: MessageEvent) => void) | null = null;

  // Timeout management
  private statusTimeoutId: number | null = null;
  private launchTimeoutId: number | null = null;

  ngOnInit(): void {
    this.setupMessageListener();
    this.fetchStatus();
  }

  ngOnDestroy(): void {
    // Clean up message listener
    if (this.messageListener) {
      window.removeEventListener('message', this.messageListener);
      this.messageListener = null;
    }

    // Clear any pending timeouts
    if (this.statusTimeoutId) {
      clearTimeout(this.statusTimeoutId);
      this.statusTimeoutId = null;
    }
    if (this.launchTimeoutId) {
      clearTimeout(this.launchTimeoutId);
      this.launchTimeoutId = null;
    }
  }

  /**
   * Fetch agent setup status from backend
   * Public to allow template retry button access
   */
  fetchStatus(): void {
    this.isLoading.set(true);
    this.error.set(null);

    // Set 10-second timeout for status request
    this.statusTimeoutId = window.setTimeout(() => {
      if (this.isLoading()) {
        this.error.set(
          'Request timed out. Please try again or check your connection.'
        );
        this.isLoading.set(false);
      }
      this.statusTimeoutId = null;
    }, 10000);

    try {
      this.vscodeService.postMessage({
        type: 'setup-status:get-status',
      });
    } catch (err) {
      // Clear timeout on error
      if (this.statusTimeoutId) {
        clearTimeout(this.statusTimeoutId);
        this.statusTimeoutId = null;
      }

      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch status';
      this.error.set(errorMessage);
      this.isLoading.set(false);
    }
  }

  /**
   * Setup message listener for RPC responses
   */
  private setupMessageListener(): void {
    this.messageListener = (event: MessageEvent) => {
      const message = event.data;

      // Handle setup-status:response messages
      if (message.type === 'setup-status:response') {
        // Clear timeout since we received a response
        if (this.statusTimeoutId) {
          clearTimeout(this.statusTimeoutId);
          this.statusTimeoutId = null;
        }

        this.isLoading.set(false);

        if (message.error) {
          this.error.set(message.error);
        } else if (message.payload) {
          // Convert lastModified from ISO string to Date if needed
          const statusData = message.payload as SetupStatus;
          this.status.set(statusData);
          this.error.set(null);
        } else {
          this.error.set('Invalid response from backend');
        }
      }

      // Handle setup-wizard:launch-response messages
      if (message.type === 'setup-wizard:launch-response') {
        // Clear timeout since we received a response
        if (this.launchTimeoutId) {
          clearTimeout(this.launchTimeoutId);
          this.launchTimeoutId = null;
        }

        this.launching.set(false);

        if (message.error || !message.success) {
          // Show error notification
          this.error.set(
            message.error || 'Failed to launch wizard. Please try again.'
          );
        }
        // If success, wizard is already open - no action needed
      }
    };

    window.addEventListener('message', this.messageListener);
  }

  /**
   * Launch setup wizard
   */
  launchWizard(): void {
    this.launching.set(true);
    this.error.set(null); // Clear any previous errors

    // Set 2-second timeout as fallback (wizard should respond faster)
    this.launchTimeoutId = window.setTimeout(() => {
      if (this.launching()) {
        // Assume success if no error response within 2 seconds
        // Wizard webview panel might have opened but didn't send response
        this.launching.set(false);
      }
      this.launchTimeoutId = null;
    }, 2000);

    try {
      this.vscodeService.postMessage({
        type: 'setup-wizard:launch',
      });
    } catch (err) {
      // Clear timeout on error
      if (this.launchTimeoutId) {
        clearTimeout(this.launchTimeoutId);
        this.launchTimeoutId = null;
      }

      const errorMessage =
        err instanceof Error ? err.message : 'Failed to launch wizard';
      this.error.set(errorMessage);
      this.launching.set(false);
    }
  }

  /**
   * Format ISO timestamp as relative time
   * Examples: "just now", "5 minutes ago", "2 hours ago", "3 days ago"
   */
  formatRelativeTime(isoString: string): string {
    const date = new Date(isoString);

    // Validate date before calculations to prevent NaN in template
    if (isNaN(date.getTime())) {
      return 'unknown'; // Graceful fallback for invalid dates
    }

    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffSeconds < 60) {
      return 'just now';
    } else if (diffMinutes < 60) {
      return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    } else if (diffHours < 24) {
      return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    } else if (diffDays < 30) {
      return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    } else {
      // For dates older than 30 days, show formatted date
      return date.toLocaleDateString();
    }
  }
}
