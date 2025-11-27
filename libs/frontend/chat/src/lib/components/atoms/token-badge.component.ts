import { Component, input, ChangeDetectionStrategy } from '@angular/core';

/**
 * TokenBadgeComponent - Displays token count with formatting
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Formats token counts:
 * - < 1,000: Show as-is
 * - >= 1,000: Show as "1.2k"
 * - >= 1,000,000: Show as "1.2M"
 */
@Component({
  selector: 'ptah-token-badge',
  standalone: true,
  template: `
    <span
      class="badge badge-outline badge-sm"
      [title]="count().toString() + ' tokens'"
    >
      {{ formatTokens() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenBadgeComponent {
  readonly count = input.required<number>();

  protected formatTokens(): string {
    const count = this.count();

    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(1)}M tokens`;
    }

    if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}k tokens`;
    }

    return `${count} tokens`;
  }
}
