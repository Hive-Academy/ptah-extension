/**
 * Search, filters and sort over {@link ProviderRow}s (implementation plan C5
 * `provider-filtering`). Pure: a page holds the filter and sort in signals and
 * derives the visible list with {@link applyProviderView}.
 *
 * Every function returns a new array and never reorders rows it does not have
 * to: sorting is stable, so rows that compare equal keep the order the store
 * delivered them in.
 */

import type { McpInstallTarget, McpServerOrigin } from '@ptah-extension/shared';
import {
  compareTargets,
  type ProviderRow,
  type ProviderStatus,
} from './provider-row';

/** The filters a page applies. `null` or absent means "any". */
export interface ProviderFilter {
  /** Whitespace-separated terms; every term must match (case-insensitive). */
  readonly search?: string;
  readonly origin?: McpServerOrigin | null;
  readonly target?: McpInstallTarget | null;
  readonly status?: ProviderStatus | null;
}

export type ProviderSortKey = 'name' | 'origin' | 'status';
export type ProviderSortDirection = 'asc' | 'desc';

export interface ProviderSort {
  readonly key: ProviderSortKey;
  readonly direction: ProviderSortDirection;
}

/** One selectable value of a filter, with how many rows carry it. */
export interface ProviderFilterOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly count: number;
}

/** The values the filter controls can offer for a row set. */
export interface ProviderFilterOptions {
  readonly origins: readonly ProviderFilterOption<McpServerOrigin>[];
  readonly targets: readonly ProviderFilterOption<McpInstallTarget>[];
  readonly statuses: readonly ProviderFilterOption<ProviderStatus>[];
}

/** Origins in list order: config files first, account connectors last. */
const ORIGIN_RANK: Readonly<Record<McpServerOrigin, number>> = {
  'harness-config': 0,
  'claude-user': 1,
  smithery: 2,
  oauth: 3,
  'claude-connector': 4,
};

/**
 * Statuses by urgency, so an ascending status sort puts what needs the user
 * first and the quiet states last.
 */
const STATUS_RANK: Readonly<Record<ProviderStatus, number>> = {
  failed: 0,
  'needs-auth': 1,
  'needs-input': 2,
  expired: 3,
  disconnected: 4,
  unknown: 5,
  pending: 6,
  disabled: 7,
  connected: 8,
  configured: 9,
};

/** Human labels for the status filter. */
const STATUS_LABELS: Readonly<Record<ProviderStatus, string>> = {
  failed: 'Failed',
  'needs-auth': 'Needs sign-in',
  'needs-input': 'Needs setup',
  expired: 'Expired',
  disconnected: 'Disconnected',
  unknown: 'Unknown',
  pending: 'Starting',
  disabled: 'Disabled',
  connected: 'Connected',
  configured: 'Configured',
};

/** Display label for a status. */
export function providerStatusLabel(status: ProviderStatus): string {
  return STATUS_LABELS[status];
}

const nameCollator = new Intl.Collator(undefined, {
  sensitivity: 'base',
  numeric: true,
});

/** Rows that pass every active filter, in their original order. */
export function filterProviderRows(
  rows: readonly ProviderRow[],
  filter: ProviderFilter,
): ProviderRow[] {
  const terms = (filter.search ?? '')
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);
  return rows.filter(
    (row) =>
      (!filter.origin || row.origin === filter.origin) &&
      (!filter.target ||
        row.targets.some((target) => target.target === filter.target)) &&
      (!filter.status || row.status === filter.status) &&
      matchesTerms(row, terms),
  );
}

function matchesTerms(row: ProviderRow, terms: readonly string[]): boolean {
  if (terms.length === 0) return true;
  const haystack = [
    row.title,
    row.originLabel,
    providerStatusLabel(row.status),
    row.statusText ?? '',
    row.description ?? '',
    ...row.targets.map((target) => target.label),
  ]
    .join('\n')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * A stable sort. `desc` reverses only the chosen key: rows that tie on it
 * still fall back to ascending name, then to their original order.
 */
export function sortProviderRows(
  rows: readonly ProviderRow[],
  sort: ProviderSort,
): ProviderRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (a, b) =>
        sign * compareBy(sort.key, a.row, b.row) ||
        nameCollator.compare(a.row.title, b.row.title) ||
        a.index - b.index,
    )
    .map(({ row }) => row);
}

function compareBy(
  key: ProviderSortKey,
  a: ProviderRow,
  b: ProviderRow,
): number {
  switch (key) {
    case 'name':
      return nameCollator.compare(a.title, b.title);
    case 'origin':
      return ORIGIN_RANK[a.origin] - ORIGIN_RANK[b.origin];
    case 'status':
      return STATUS_RANK[a.status] - STATUS_RANK[b.status];
  }
}

/** Filter, then sort. */
export function applyProviderView(
  rows: readonly ProviderRow[],
  filter: ProviderFilter,
  sort: ProviderSort,
): ProviderRow[] {
  return sortProviderRows(filterProviderRows(rows, filter), sort);
}

/**
 * The origins, targets and statuses present in `rows`, each with its count, in
 * list order. A filter control offers only values that can match something.
 */
export function providerFilterOptions(
  rows: readonly ProviderRow[],
): ProviderFilterOptions {
  const origins = new Map<McpServerOrigin, { label: string; count: number }>();
  const targets = new Map<McpInstallTarget, { label: string; count: number }>();
  const statuses = new Map<ProviderStatus, number>();

  for (const row of rows) {
    const origin = origins.get(row.origin);
    origins.set(row.origin, {
      label: origin?.label ?? row.originLabel,
      count: (origin?.count ?? 0) + 1,
    });
    for (const { target, label } of row.targets) {
      targets.set(target, {
        label,
        count: (targets.get(target)?.count ?? 0) + 1,
      });
    }
    statuses.set(row.status, (statuses.get(row.status) ?? 0) + 1);
  }

  return {
    origins: [...origins]
      .sort(([a], [b]) => ORIGIN_RANK[a] - ORIGIN_RANK[b])
      .map(([value, { label, count }]) => ({ value, label, count })),
    targets: [...targets]
      .sort(([a], [b]) => compareTargets(a, b))
      .map(([value, { label, count }]) => ({ value, label, count })),
    statuses: [...statuses]
      .sort(([a], [b]) => STATUS_RANK[a] - STATUS_RANK[b])
      .map(([value, count]) => ({
        value,
        label: providerStatusLabel(value),
        count,
      })),
  };
}
