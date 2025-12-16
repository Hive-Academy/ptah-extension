import {
  Component,
  OnInit,
  signal,
  inject,
  ChangeDetectionStrategy,
} from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';

import { SetupStatusGetResponse } from '@ptah-extension/shared';

/**
 * SetupStatus type - Agent configuration status information
 * Uses the RPC response type directly for type safety
 */
export type SetupStatus = SetupStatusGetResponse;

/**
 * SetupStatusWidgetComponent - Agent configuration status widget
 *
 * Complexity Level: 2 (Medium - RPC communication + state management)
 * Patterns: Signal-based state, ClaudeRpcService, DaisyUI styling
 *
 * Features:
 * - Fetches agent setup status on component init via RPC
 * - Displays agent count and last modified timestamp
 * - Shows "Configure" or "Update" button based on configuration status
 * - Launches setup wizard via RPC method
 * - Handles loading, error, and success states
 *
 * SOLID Principles:
 * - Single Responsibility: Display agent setup status and launch wizard
 * - Open/Closed: Extensible via signals, closed for modification
 * - Dependency Inversion: Depends on ClaudeRpcService abstraction
 */
@Component({
  selector: 'ptah-setup-status-widget',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="border border-base-300 rounded-md bg-base-200/50 p-2.5">
      @if (isLoading()) {
      <!-- Compact loading skeleton -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2 flex-1">
          <div class="skeleton w-6 h-6 rounded-full shrink-0"></div>
          <div class="flex-1">
            <div class="skeleton h-3 w-20 mb-1"></div>
            <div class="skeleton h-2 w-28"></div>
          </div>
        </div>
        <div class="skeleton h-6 w-16"></div>
      </div>
      } @else if (error()) {
      <!-- Compact error state -->
      <div class="flex items-center gap-2 text-error">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="shrink-0 w-4 h-4"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span class="text-xs flex-1 truncate">{{ error() }}</span>
        <button
          class="btn btn-xs btn-ghost"
          (click)="fetchStatus()"
          type="button"
          aria-label="Retry"
        >
          Retry
        </button>
      </div>
      } @else if (status()) {
      <!-- Compact agent status -->
      <div class="flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <div
            class="w-6 h-6 rounded-full bg-primary flex items-center justify-center shrink-0"
          >
            <span class="text-xs">🤖</span>
          </div>
          <div>
            <h4 class="text-xs font-medium leading-tight">Claude Agents</h4>
            @if (status()!.isConfigured) {
            <p class="text-[10px] text-base-content/60 leading-tight">
              {{ status()!.agentCount }} agent{{
                status()!.agentCount !== 1 ? 's' : ''
              }}
              @if (status()!.lastUpdated) { •
              {{ formatRelativeTime(status()!.lastUpdated!) }}
              }
            </p>
            } @else {
            <p class="text-[10px] text-base-content/60 leading-tight">
              Not configured
            </p>
            }
          </div>
        </div>
        <button
          class="btn btn-primary btn-xs"
          [disabled]="launching()"
          (click)="launchWizard()"
          type="button"
        >
          @if (launching()) {
          <span class="loading loading-spinner loading-xs"></span>
          } @else {
          <span>{{ status()!.isConfigured ? 'Update' : 'Configure' }}</span>
          }
        </button>
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
export class SetupStatusWidgetComponent implements OnInit {
  private readonly rpcService = inject(ClaudeRpcService);

  // Signals for reactive state
  readonly status = signal<SetupStatus | null>(null);
  readonly isLoading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly launching = signal<boolean>(false);

  ngOnInit(): void {
    this.fetchStatus();
  }

  /**
   * Fetch agent setup status from backend via RPC
   * Public to allow template retry button access
   */
  async fetchStatus(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const result = await this.rpcService.call(
        'setup-status:get-status',
        {},
        { timeout: 10000 }
      );

      if (result.isSuccess() && result.data) {
        this.status.set(result.data);
        this.error.set(null);
      } else {
        this.error.set(result.error || 'Failed to fetch status');
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to fetch status';
      this.error.set(errorMessage);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Launch setup wizard via RPC
   */
  async launchWizard(): Promise<void> {
    this.launching.set(true);
    this.error.set(null); // Clear any previous errors

    try {
      const result = await this.rpcService.call(
        'setup-wizard:launch',
        {},
        { timeout: 5000 }
      );

      if (!result.isSuccess()) {
        this.error.set(
          result.error || 'Failed to launch wizard. Please try again.'
        );
      }
      // If success, wizard is already open - no action needed
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : 'Failed to launch wizard';
      this.error.set(errorMessage);
    } finally {
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
