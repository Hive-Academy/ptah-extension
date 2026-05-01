import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import type { MessageTokenUsage } from '@ptah-extension/shared';

/**
 * TokenBadgeComponent - Displays token count with formatting and detailed tooltip
 *
 * Complexity Level: 1 (Simple atom)
 * Patterns: Standalone component, OnPush change detection
 *
 * Formats token counts:
 * - < 1,000: Show as-is
 * - >= 1,000: Show as "1.2k"
 * - >= 1,000,000: Show as "1.2M"
 *
 * Tooltip shows detailed breakdown:
 * - Input tokens
 * - Output tokens
 * - Cache read tokens (if any)
 * - Cache creation tokens (if any)
 */
@Component({
  selector: 'ptah-token-badge',
  standalone: true,
  template: `
    <span
      class="badge badge-outline badge-sm cursor-help"
      [title]="tooltipText()"
    >
      {{ formatTokens() }}
    </span>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TokenBadgeComponent {
  /**
   * Token usage - can be either a simple count or full MessageTokenUsage
   * For backward compatibility, accepts either type
   */
  readonly tokens = input<MessageTokenUsage | number | undefined>();

  /** Legacy input for simple count (deprecated, use tokens instead) */
  readonly count = input<number>();

  /** Computed total token count */
  readonly totalCount = computed(() => {
    const tokens = this.tokens();
    const legacyCount = this.count();

    // If simple count provided (legacy or new)
    if (typeof tokens === 'number') {
      return tokens;
    }

    // If legacy count input used
    if (legacyCount !== undefined) {
      return legacyCount;
    }

    // If full MessageTokenUsage object
    if (tokens) {
      return tokens.input + tokens.output;
    }

    return 0;
  });

  /** Detailed tooltip with breakdown */
  readonly tooltipText = computed(() => {
    const tokens = this.tokens();
    const legacyCount = this.count();

    // Simple number - just show total
    if (typeof tokens === 'number' || legacyCount !== undefined) {
      const count = typeof tokens === 'number' ? tokens : (legacyCount ?? 0);
      return `${count.toLocaleString()} tokens`;
    }

    // Full MessageTokenUsage - show breakdown
    if (tokens) {
      const lines = [
        `Input: ${tokens.input.toLocaleString()}`,
        `Output: ${tokens.output.toLocaleString()}`,
      ];

      if (tokens.cacheRead && tokens.cacheRead > 0) {
        lines.push(`Cache Read: ${tokens.cacheRead.toLocaleString()}`);
      }

      if (tokens.cacheCreation && tokens.cacheCreation > 0) {
        lines.push(`Cache Creation: ${tokens.cacheCreation.toLocaleString()}`);
      }

      lines.push(`Total: ${this.totalCount().toLocaleString()}`);
      return lines.join('\n');
    }

    return '0 tokens';
  });

  protected formatTokens(): string {
    const count = this.totalCount();

    if (count >= 1_000_000) {
      return `${(count / 1_000_000).toFixed(1)}M tokens`;
    }

    if (count >= 1_000) {
      return `${(count / 1_000).toFixed(1)}k tokens`;
    }

    return `${count} tokens`;
  }
}
