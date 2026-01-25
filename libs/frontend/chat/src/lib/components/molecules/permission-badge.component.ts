import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
} from '@angular/core';
import { PermissionRequest, PermissionResponse } from '@ptah-extension/shared';
import { PermissionRequestCardComponent } from './permission-request-card.component';
import { LucideAngularModule, AlertTriangle, X } from 'lucide-angular';

/**
 * PermissionBadgeComponent - Collapsed notification badge for unmatched permissions
 *
 * Complexity Level: 2 (Molecule with dropdown behavior)
 * Patterns: Signal-based state, Fixed positioning, DaisyUI styling
 *
 * Features:
 * - Compact badge with permission count (bottom-right, above input)
 * - Click to expand dropdown with permission cards
 * - Auto-collapse when all permissions resolved
 * - Does NOT block chat input area
 * - Pulse animation for visibility
 *
 * SOLID Principles:
 * - Single Responsibility: Display collapsed permission badge with expandable dropdown
 * - Composition: Uses PermissionRequestCardComponent for individual permission display
 * - Interface Segregation: Simple inputs (permissions array) and outputs (response)
 */
@Component({
  selector: 'ptah-permission-badge',
  standalone: true,
  imports: [PermissionRequestCardComponent, LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (permissions().length > 0) {
    <div class="fixed bottom-20 right-4 z-50">
      <!-- Badge button -->
      <button
        (click)="toggleExpanded()"
        class="btn btn-circle btn-warning btn-sm shadow-lg relative animate-pulse"
        [attr.aria-expanded]="isExpanded()"
        aria-label="Permission requests pending"
      >
        <!-- Warning icon -->
        <lucide-angular [img]="AlertTriangleIcon" class="w-4 h-4" />
        <!-- Count badge -->
        <span
          class="badge badge-error badge-xs absolute -top-1 -right-1 min-w-4 h-4 text-[10px]"
        >
          {{ permissions().length }}
        </span>
      </button>

      <!-- Expanded dropdown -->
      @if (isExpanded()) {
      <div
        class="absolute bottom-12 right-0 w-80 max-h-64 overflow-y-auto bg-base-200 rounded-lg shadow-xl border border-base-300 p-2 space-y-2"
        role="dialog"
        aria-label="Permission requests"
      >
        <div
          class="flex items-center justify-between px-2 pb-2 border-b border-base-300"
        >
          <span class="text-xs font-medium text-warning">
            {{ permissions().length }} permission{{
              permissions().length > 1 ? 's' : ''
            }}
            pending
          </span>
          <button
            (click)="toggleExpanded()"
            class="btn btn-ghost btn-xs"
            aria-label="Close"
          >
            <lucide-angular [img]="XIcon" class="w-3 h-3" />
          </button>
        </div>
        @for (request of permissions(); track request.id) {
        <ptah-permission-request-card
          [request]="request"
          (responded)="onPermissionResponse($event)"
        />
        }
      </div>
      }
    </div>
    }
  `,
})
export class PermissionBadgeComponent {
  // Lucide icon references
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly XIcon = X;

  /** Array of unmatched permission requests to display */
  readonly permissions = input.required<PermissionRequest[]>();

  /** Emits when user responds to a permission request */
  readonly responded = output<PermissionResponse>();

  /** Local state for dropdown expansion */
  protected readonly isExpanded = signal(false);

  /**
   * Toggle the dropdown expansion state
   */
  protected toggleExpanded(): void {
    this.isExpanded.update((v) => !v);
  }

  /**
   * Handle permission response from card
   * Emits response and auto-closes if this was the last permission
   */
  protected onPermissionResponse(response: PermissionResponse): void {
    this.responded.emit(response);
    // Auto-close if this was the last permission
    if (this.permissions().length <= 1) {
      this.isExpanded.set(false);
    }
  }
}
