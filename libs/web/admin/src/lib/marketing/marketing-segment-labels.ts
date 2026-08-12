/**
 * marketing-segment-labels — the single map from a `MarketingSegmentKey` to its
 * human display label (design spec §7.2).
 *
 * Extracted so the Hub's Audience panel (§3.5), Campaign Detail's Audience card
 * (§5.2) and Compose's Step 3 summary (§4.4) share one mapping instead of four
 * copies of the same `switch`. `SegmentPicker` imports this too.
 *
 * Type-only import of `MarketingSegmentKey` keeps this module framework-free.
 */
import type { MarketingSegmentKey } from '../services/admin-api.service';

/** Display label for every marketing segment key. */
export const SEGMENT_LABELS: Record<MarketingSegmentKey, string> = {
  all: 'All Users',
  buildersActive: 'Builders Active',
  communityActive: 'Community Active',
  subscriptionPastDue: 'Past Due',
};

/**
 * Resolve a segment key to its display label, falling back to the raw key for
 * any unknown value (preserves `SegmentPicker.getSegmentLabel`'s old default).
 */
export function segmentLabel(key: string): string {
  return SEGMENT_LABELS[key as MarketingSegmentKey] ?? key;
}
