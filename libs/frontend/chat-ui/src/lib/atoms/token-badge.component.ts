import {
  Component,
  input,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  isValidTokenCount,
  messageTokenTotal,
  type MessageTokenUsage,
} from '@ptah-extension/shared';

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
    if (typeof tokens === 'number') {
      return tokens;
    }
    if (legacyCount !== undefined) {
      return legacyCount;
    }
    if (tokens) {
      return messageTokenTotal(tokens);
    }

    return 0;
  });

  /** Detailed tooltip with breakdown */
  readonly tooltipText = computed(() => {
    const tokens = this.tokens();
    const legacyCount = this.count();
    const total = this.totalCount();
    if (!isValidTokenCount(total)) {
      return 'Token usage unavailable';
    }
    if (typeof tokens === 'number' || legacyCount !== undefined) {
      const count = typeof tokens === 'number' ? tokens : (legacyCount ?? 0);
      return `${count.toLocaleString()} tokens`;
    }
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

      lines.push(`Total: ${total.toLocaleString()}`);
      return lines.join('\n');
    }

    return '0 tokens';
  });

  protected formatTokens(): string {
    const total = this.totalCount();
    return isValidTokenCount(total) ? `${formatTokenCount(total)} tokens` : '—';
  }
}

/**
 * A token count in the badge's compact form, without a unit: `950`, `1.2k`,
 * `1.2M`. The badge appends ` tokens`; plain-text surfaces (the turn activity
 * panel's `18.2k in · 3.1k out`) compose their own unit.
 */
export function formatTokenCount(count: number): string {
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1)}M`;
  }

  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1)}k`;
  }

  return `${count}`;
}
