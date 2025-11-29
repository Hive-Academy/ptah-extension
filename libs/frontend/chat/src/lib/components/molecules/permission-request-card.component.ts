import {
  Component,
  input,
  output,
  signal,
  computed,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import { LucideAngularModule, ShieldAlert } from 'lucide-angular';
import { PermissionRequest, PermissionResponse } from '@ptah-extension/shared';

/**
 * PermissionRequestCardComponent - DaisyUI alert card for permission requests
 *
 * Complexity Level: 2 (Signal-based with computed countdown timer)
 * Patterns: Signal-based inputs/outputs, Computed timer, DaisyUI alert styling
 *
 * Features:
 * - Real-time countdown timer showing remaining time until timeout
 * - Three action buttons: Allow, Always Allow, Deny
 * - Warning alert styling with ShieldAlert icon
 * - Accessible button semantics
 *
 * SOLID Principles:
 * - Single Responsibility: Display permission request and handle user response
 * - Composition: Uses lucide-angular for icons
 */
@Component({
  selector: 'ptah-permission-request-card',
  standalone: true,
  imports: [LucideAngularModule],
  template: `
    <div class="alert alert-warning alert-soft shadow-lg" role="alert">
      <div class="flex items-start gap-3">
        <lucide-angular [img]="ShieldAlertIcon" class="h-6 w-6 shrink-0" />
        <div class="flex-1 min-w-0">
          <h4 class="font-semibold">Permission Required</h4>
          <p class="text-sm opacity-90">{{ request().description }}</p>
          <div class="text-xs opacity-70 mt-1">
            Tool: {{ request().toolName }} | Expires in {{ remainingTime() }}
          </div>
        </div>
      </div>
      <div class="flex gap-2 mt-3 justify-end">
        <button
          class="btn btn-success btn-outline btn-sm"
          (click)="respond('allow')"
          type="button"
          aria-label="Allow this request"
        >
          Allow
        </button>
        <button
          class="btn btn-info  btn-outline btn-sm"
          (click)="respond('always_allow')"
          type="button"
          aria-label="Always allow this type of request"
        >
          Always Allow
        </button>
        <button
          class="btn btn-outline btn-sm"
          (click)="respond('deny')"
          type="button"
          aria-label="Deny this request"
        >
          Deny
        </button>
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionRequestCardComponent {
  // Inputs
  readonly request = input.required<PermissionRequest>();

  // Outputs
  readonly responded = output<PermissionResponse>();

  // Icons
  readonly ShieldAlertIcon = ShieldAlert;

  // Timer state
  private readonly _currentTime = signal(Date.now());

  /**
   * Computed signal for countdown timer
   * Calculates remaining time from request timeout
   */
  readonly remainingTime = computed(() => {
    const current = this._currentTime();
    const timeout = this.request().timeoutAt;
    const remaining = timeout - current;

    if (remaining <= 0) {
      return 'expired';
    }

    // Convert to human-readable format
    const seconds = Math.floor(remaining / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  });

  private timerInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Start countdown timer on component initialization
    effect((onCleanup) => {
      // Update current time every second
      this.timerInterval = setInterval(() => {
        this._currentTime.set(Date.now());

        // Auto-deny if expired
        const timeout = this.request().timeoutAt;
        if (Date.now() >= timeout) {
          this.respond('deny', 'Request timeout');
        }
      }, 1000);

      // Cleanup interval on component destruction
      onCleanup(() => {
        if (this.timerInterval) {
          clearInterval(this.timerInterval);
          this.timerInterval = null;
        }
      });
    });
  }

  /**
   * Handle user response to permission request
   */
  protected respond(
    decision: 'allow' | 'deny' | 'always_allow',
    reason?: string
  ): void {
    // Clear timer before responding
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }

    // Emit response
    this.responded.emit({
      id: this.request().id,
      decision,
      reason,
    });
  }
}
