import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * DurationBadgeComponent - Displays execution duration
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Formats durations:
 * - < 1s: "500ms"
 * - < 60s: "12.5s"
 * - >= 60s: "2.3m"
 */
@Component({
  selector: 'ptah-duration-badge',
  standalone: true,
  template: `
    <span class="badge badge-ghost badge-sm">
      {{ formatDuration() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DurationBadgeComponent {
  readonly durationMs = input.required<number>();

  protected formatDuration(): string {
    const ms = this.durationMs();

    if (ms < 1000) {
      return `${ms}ms`;
    }

    if (ms < 60_000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }

    return `${(ms / 60_000).toFixed(1)}m`;
  }
}
