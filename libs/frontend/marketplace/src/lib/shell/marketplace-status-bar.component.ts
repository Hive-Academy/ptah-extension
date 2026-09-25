import { ChangeDetectionStrategy, Component, computed } from '@angular/core';
import {
  injectMarketplaceNavCounts,
  type MarketplaceNavCounts,
} from './marketplace-nav-counts';

/** One keyboard hint: the keys to press and what they do. */
interface KeyboardHint {
  readonly keys: readonly string[];
  readonly label: string;
}

/**
 * The shortcuts the Marketplace answers: `/` is the shell's own; the arrows,
 * Enter and Esc belong to the list pages and their detail frame (plan C7).
 */
const KEYBOARD_HINTS: readonly KeyboardHint[] = [
  { keys: ['↑', '↓'], label: 'select' },
  { keys: ['Enter'], label: 'open' },
  { keys: ['/'], label: 'search' },
  { keys: ['Esc'], label: 'close' },
];

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * The status-bar summary: one phrase per count that is known, in a fixed
 * order. Unknown (`null`) counts are left out rather than shown as 0, so the
 * bar never claims "0 servers" before the servers were read.
 */
export function marketplaceStatusSummary(
  counts: MarketplaceNavCounts,
): readonly string[] {
  const parts: string[] = [];
  if (counts.servers !== null) {
    parts.push(plural(counts.servers, 'MCP server', 'MCP servers'));
  }
  if (counts.connectors !== null) {
    parts.push(
      plural(counts.connectors, 'connector connected', 'connectors connected'),
    );
  }
  // "N Ptah plugins", not the prototype's "6/9": the catalogue total would
  // need a catalogue read, and the zero-RPC rule forbids one from here.
  if (counts.plugins !== null) {
    parts.push(plural(counts.plugins, 'Ptah plugin', 'Ptah plugins'));
  }
  if (counts.community !== null) {
    parts.push(plural(counts.community, 'community skill', 'community skills'));
  }
  if (counts.marketplaces !== null) {
    parts.push(
      plural(counts.marketplaces, 'marketplace plugin', 'marketplace plugins'),
    );
  }
  return parts;
}

/**
 * MarketplaceStatusBarComponent — the footer row at regular and wide tiers
 * (plan C6, v3 footer): keyboard hints on the left, counts on the right.
 *
 * Counts come from {@link injectMarketplaceNavCounts}, which reads only
 * `ready` slices and never calls `ensure()`, so the bar shows exactly what the
 * pages visited so far have loaded and never causes a read of its own.
 */
@Component({
  selector: 'ptah-marketplace-status-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'block shrink-0',
  },
  template: `
    <footer
      data-testid="marketplace-status-bar"
      class="flex h-8 min-w-0 items-center gap-4 border-t border-base-300 bg-base-100 px-3 text-xs text-base-content-muted"
    >
      <ul
        class="flex min-w-0 items-center gap-3"
        aria-label="Keyboard shortcuts"
      >
        @for (hint of hints; track hint.label) {
          <li class="flex shrink-0 items-center gap-1">
            @for (key of hint.keys; track key) {
              <kbd class="kbd kbd-xs">{{ key }}</kbd>
            }
            <span>{{ hint.label }}</span>
          </li>
        }
      </ul>
      @if (summary().length > 0) {
        <p
          class="ml-auto min-w-0 truncate tabular-nums"
          data-testid="marketplace-status-counts"
        >
          {{ summary().join(' · ') }}
        </p>
      }
    </footer>
  `,
})
export class MarketplaceStatusBarComponent {
  protected readonly hints = KEYBOARD_HINTS;

  private readonly counts = injectMarketplaceNavCounts();

  protected readonly summary = computed(() =>
    marketplaceStatusSummary(this.counts()),
  );
}
