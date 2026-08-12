/**
 * campaign-row — shared, framework-free view-model for a marketing campaign row.
 *
 * The Marketing hub's Recent Campaigns list (§3.4) and the Campaign History
 * list (§5.1) render the exact same compact row (name + status badge + three
 * colored rate readouts + date + chevron). This module turns a raw campaign
 * record into a display-ready shape once, so neither view duplicates the
 * status-derivation + rate-coloring logic already centralised in
 * `marketing-metrics.ts`.
 */
import type { BadgeVariant } from '@ptah-web/panel-ui';
import { computeCampaignRates, rateColorClass } from '../marketing-metrics';

/** The raw campaign-record fields these views consume (from `list`/`get`). */
export interface CampaignRow {
  id: string;
  name: string;
  subject: string;
  segment: string;
  recipientCount: number;
  sentCount: number;
  bouncedCount: number;
  complainedCount: number;
  createdBy: string | null;
  createdAt: string | null;
  completedAt: string | null;
}

/** One rate readout — its formatted value plus the §3.7 text-color class. */
export interface RateReadout {
  text: string;
  colorClass: string;
}

/** Display-ready projection of a campaign row for the compact list pattern. */
export interface CampaignRowVm {
  id: string;
  name: string;
  statusLabel: string;
  statusVariant: BadgeVariant;
  delivery: RateReadout;
  bounce: RateReadout;
  complaint: RateReadout;
  createdAt: string | null;
}

/** `98.2%`, or an em-dash for a `null` rate (never `NaN%`). */
export function formatRate(rate: number | null): string {
  return rate === null ? '—' : `${rate.toFixed(1)}%`;
}

/** Safely coerce an unknown record into a {@link CampaignRow}. */
export function asCampaignRow(row: Record<string, unknown>): CampaignRow {
  const num = (v: unknown): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;
  const str = (v: unknown): string => (typeof v === 'string' ? v : '');
  const strOrNull = (v: unknown): string | null =>
    typeof v === 'string' ? v : null;
  return {
    id: str(row['id']),
    name: str(row['name']),
    subject: str(row['subject']),
    segment: str(row['segment']),
    recipientCount: num(row['recipientCount']),
    sentCount: num(row['sentCount']),
    bouncedCount: num(row['bouncedCount']),
    complainedCount: num(row['complainedCount']),
    createdBy: strOrNull(row['createdBy']),
    createdAt: strOrNull(row['createdAt']),
    completedAt: strOrNull(row['completedAt']),
  };
}

/** Project a campaign row into its display-ready {@link CampaignRowVm}. */
export function toCampaignRowVm(row: CampaignRow): CampaignRowVm {
  const rates = computeCampaignRates(row);
  return {
    id: row.id,
    name: row.name || 'Untitled campaign',
    statusLabel: rates.status === 'completed' ? 'Completed' : 'Sending',
    statusVariant: rates.status === 'completed' ? 'success' : 'info',
    delivery: {
      text: formatRate(rates.deliveryRate),
      colorClass: rateColorClass(rates.deliveryRate, 'delivery'),
    },
    bounce: {
      text: formatRate(rates.bounceRate),
      colorClass: rateColorClass(rates.bounceRate, 'bounce'),
    },
    complaint: {
      text: formatRate(rates.complaintRate),
      colorClass: rateColorClass(rates.complaintRate, 'complaint'),
    },
    createdAt: row.createdAt,
  };
}
