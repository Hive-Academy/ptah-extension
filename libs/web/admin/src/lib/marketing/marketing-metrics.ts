/**
 * marketing-metrics — pure, framework-free campaign rate math (design spec §3.7).
 *
 * The single source of truth for turning a campaign row's raw counts into the
 * delivery / bounce / complaint rates the Marketing hub, Campaign History and
 * Campaign Detail all display. Kept Angular-free so it is trivially unit-testable
 * and never duplicated across the three consuming views.
 *
 * Rates are expressed as PERCENTAGES (0–100) so the §3.7 threshold bands
 * (delivery ≥95, bounce <2, complaint <0.1, …) apply to the returned numbers
 * directly. Denominators of 0 yield `null` (never NaN / Infinity) — the
 * "never fabricate a number" rule applied to arithmetic; callers render `null`
 * as an em-dash.
 */

/** Continuous-metric kinds that carry their own threshold bands (§3.7). */
export type CampaignRateKind = 'delivery' | 'bounce' | 'complaint';

/** Semantic tone a rate maps to under its §3.7 threshold band. */
export type RateTone = 'success' | 'warning' | 'error' | 'neutral';

/** Derived, display-ready rates for one campaign (§3.7). */
export interface CampaignRates {
  /** `sentCount / recipientCount` as a %, `null` when `recipientCount === 0`. */
  deliveryRate: number | null;
  /** `bouncedCount / sentCount` as a %, `null` when `sentCount === 0`. */
  bounceRate: number | null;
  /** `complainedCount / sentCount` as a %, `null` when `sentCount === 0`. */
  complaintRate: number | null;
  /** Client-derived from `completedAt` presence (§3.7). */
  status: 'in_progress' | 'completed';
}

/** The raw campaign-row fields the rate math consumes. */
export interface CampaignCounts {
  recipientCount: number;
  sentCount: number;
  bouncedCount: number;
  complainedCount: number;
  completedAt: string | null;
}

/** `x / y * 100`, or `null` when `y` is 0 (guards NaN/Infinity). */
function percentage(numerator: number, denominator: number): number | null {
  if (!denominator) return null;
  return (numerator / denominator) * 100;
}

/**
 * Compute the delivery/bounce/complaint rates + derived status for a campaign
 * row. Every rate is `null` when its denominator is 0 (§3.7).
 */
export function computeCampaignRates(c: CampaignCounts): CampaignRates {
  return {
    deliveryRate: percentage(c.sentCount, c.recipientCount),
    bounceRate: percentage(c.bouncedCount, c.sentCount),
    complaintRate: percentage(c.complainedCount, c.sentCount),
    status: c.completedAt ? 'completed' : 'in_progress',
  };
}

/**
 * Map a rate (%) + kind to its semantic tone under the §3.7 bands.
 * `null` rates (no denominator) are `neutral` — there is nothing to grade.
 *
 * - Delivery: `success` ≥95, `warning` 80–95, `error` <80
 * - Bounce:   `success` <2,  `warning` 2–5,   `error` >5
 * - Complaint:`success` <0.1,`warning` 0.1–0.5,`error` >0.5
 */
export function rateTone(
  rate: number | null,
  kind: CampaignRateKind,
): RateTone {
  if (rate === null || Number.isNaN(rate)) return 'neutral';
  switch (kind) {
    case 'delivery':
      if (rate >= 95) return 'success';
      if (rate >= 80) return 'warning';
      return 'error';
    case 'bounce':
      if (rate < 2) return 'success';
      if (rate <= 5) return 'warning';
      return 'error';
    case 'complaint':
      if (rate < 0.1) return 'success';
      if (rate <= 0.5) return 'warning';
      return 'error';
  }
}

/** Tailwind `text-*` colour class for each tone (operator semantic palette). */
const TONE_TEXT_CLASS: Record<RateTone, string> = {
  success: 'text-success',
  warning: 'text-warning',
  error: 'text-error',
  neutral: 'text-base-content/40',
};

/**
 * Tailwind text-colour class for a rate (%) under its §3.7 band. Applied to the
 * inline rate readout, not a full badge — these are continuous metrics, not
 * enum states. `null` rates resolve to the muted `text-base-content/40`.
 */
export function rateColorClass(
  rate: number | null,
  kind: CampaignRateKind,
): string {
  return TONE_TEXT_CLASS[rateTone(rate, kind)];
}
