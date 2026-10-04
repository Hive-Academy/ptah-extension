import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import { formatDurationMs } from '@ptah-extension/shared';

/**
 * DurationBadgeComponent - Displays execution duration
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Formatting lives in the shared `formatDurationMs`
 * (`@ptah-extension/shared`), so this badge and every other surface print the
 * same string for the same duration.
 */
@Component({
  selector: 'ptah-duration-badge',
  standalone: true,
  template: `
    <span class="badge badge-ghost badge-sm">
      {{ formatDurationMs(durationMs()) }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DurationBadgeComponent {
  readonly durationMs = input.required<number>();

  /** Shared formatter; values below 100 are seconds, not milliseconds. */
  protected readonly formatDurationMs = formatDurationMs;
}
