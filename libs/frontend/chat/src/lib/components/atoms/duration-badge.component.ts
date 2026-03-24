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
    let ms = this.durationMs();

    // Normalize: SDK message_complete.duration is in seconds while
    // tree-builder timestamp diffs are in ms. Any value < 100 is almost
    // certainly seconds (a real agent/tool never completes in < 100ms).
    if (ms > 0 && ms < 100) {
      ms = ms * 1000;
    }

    if (ms < 1000) {
      return `${Math.round(ms)}ms`;
    }

    if (ms < 60_000) {
      return `${(ms / 1000).toFixed(1)}s`;
    }

    const minutes = Math.floor(ms / 60_000);
    const seconds = Math.round((ms % 60_000) / 1000);
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }
}
