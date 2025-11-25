import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { ExecutionStatus } from '@ptah-extension/shared';

/**
 * StatusBadgeComponent - Shows execution status with colored badge
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Maps ExecutionStatus to DaisyUI badge classes:
 * - pending → badge-ghost
 * - streaming → badge-info + loading spinner
 * - complete → badge-success
 * - error → badge-error
 */
@Component({
  selector: 'ptah-status-badge',
  standalone: true,
  template: `
    <span
      class="badge badge-sm"
      [class.badge-ghost]="status() === 'pending'"
      [class.badge-info]="status() === 'streaming'"
      [class.badge-success]="status() === 'complete'"
      [class.badge-error]="status() === 'error'"
    >
      @if (status() === 'streaming') {
      <span class="loading loading-spinner loading-xs mr-1"></span>
      }
      {{ getLabel() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusBadgeComponent {
  readonly status = input.required<ExecutionStatus>();

  protected getLabel(): string {
    switch (this.status()) {
      case 'pending':
        return 'Pending';
      case 'streaming':
        return 'Streaming';
      case 'complete':
        return 'Done';
      case 'error':
        return 'Error';
    }
  }
}
