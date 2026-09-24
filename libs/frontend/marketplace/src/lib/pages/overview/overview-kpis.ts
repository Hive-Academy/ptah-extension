/**
 * The Overview's four KPI figures (plan C7 `OverviewPage`), as pure mappers
 * over what the stores already hold. No RPC shape reaches the page: each
 * function takes store read-outs and returns what a `ptah-stat-card` shows.
 *
 * Every figure comes from a real source. There is no history on the wire, so
 * there are no trends or sparklines (plan "Widgets without a data source").
 */

import type { HarnessHealth, HarnessTargetId } from '@ptah-extension/shared';

import type { ConnectorLink } from '../../data/connector-links.store';
import type { ProviderRow } from '../../data/provider-row';
import {
  harnessTargetLabel,
  harnessTargetNeedsAttention,
  type HarnessChipState,
} from '../../harness/harness-health.model';

/** The three shapes a stat card or panel draws. */
export type OverviewWidgetState = 'loading' | 'ready' | 'error';

/** A store or slice load state (`InventorySliceState`, `ConnectorLinksState`). */
export type OverviewLoadState = 'idle' | 'loading' | 'ready' | 'error';

/** What one stat card shows once its source is ready. */
export interface KpiFigure {
  readonly value: number | string | null;
  readonly unit: string | null;
  readonly subLine: string | null;
}

/** A widget's state for one source. `idle` is about to load. */
export function widgetStateOf(state: OverviewLoadState): OverviewWidgetState {
  if (state === 'ready' || state === 'error') return state;
  return 'loading';
}

/**
 * A widget fed by several sources: `error` when any failed (its Retry
 * re-reads only the failed ones), else `loading` until every one is ready.
 */
export function combinedWidgetState(
  states: readonly OverviewLoadState[],
): OverviewWidgetState {
  if (states.some((state) => state === 'error')) return 'error';
  return states.every((state) => state === 'ready') ? 'ready' : 'loading';
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? one : many;
}

// ── Apps & MCP servers ─────────────────────────────────────────────────────────

/**
 * Installed servers, how many cannot be removed from Ptah, and — only when a
 * session of the active workspace has reported (`live !== null`) — how many
 * that session saw connected (`liveInLastSession()`).
 */
export function serversKpi(
  rows: readonly ProviderRow[],
  live: number | null,
): KpiFigure {
  const blocked = rows.filter((row) => row.removal.kind === 'blocked').length;
  const parts = [`${blocked} blocked`];
  if (live !== null) parts.push(`${live} live in last session`);
  return {
    value: rows.length,
    unit: plural(rows.length, 'server', 'servers'),
    subLine: parts.join(' · '),
  };
}

// ── Connectors ─────────────────────────────────────────────────────────────────

/**
 * Connected catalogue connectors out of the whole catalogue. `links` holds
 * one entry per catalogue connector (`ConnectorLinksStore.links`), so its
 * size is the catalogue total.
 */
export function connectorsKpi(
  links: ReadonlyMap<string, ConnectorLink>,
): KpiFigure {
  let connected = 0;
  for (const link of links.values()) {
    if (link.status === 'connected') connected += 1;
  }
  return {
    value: connected,
    unit: 'connected',
    subLine: `of ${links.size} in the catalogue`,
  };
}

// ── Skills & plugins ───────────────────────────────────────────────────────────

/** Enabled counts per kind, from the three inventory slices. */
export interface SkillCounts {
  /** Enabled Ptah plugins (`plugins` slice). */
  readonly ptah: number;
  /** Installed skills.sh skills (`community` slice). */
  readonly community: number;
  /** Installed external marketplace plugins (`marketplaces` slice). */
  readonly marketplace: number;
}

/** Everything enabled, with the per-kind breakdown. */
export function skillsKpi(counts: SkillCounts): KpiFigure {
  return {
    value: counts.ptah + counts.community + counts.marketplace,
    unit: 'enabled',
    subLine: `${counts.ptah} Ptah · ${counts.community} community · ${counts.marketplace} marketplace`,
  };
}

/** One failed skill slice: which source it is, and why it failed. */
export interface SkillSliceFailure {
  readonly label: string;
  readonly error: string | undefined;
}

/**
 * The Skills card's error text: every failed source, labelled, so a second
 * failure's reason is never hidden behind the first. `null` when none failed.
 */
export function skillsErrorText(
  failures: readonly SkillSliceFailure[],
): string | null {
  if (failures.length === 0) return null;
  return failures
    .map(
      ({ label, error }) => `${label}: ${error?.trim() || 'Could not load.'}`,
    )
    .join(' · ');
}

// ── Harness health ─────────────────────────────────────────────────────────────

/** One detected CLI and its sync state (`harnessChipPresentation` draws it). */
export interface HarnessChip {
  readonly target: HarnessTargetId;
  readonly label: string;
  readonly state: HarnessChipState;
}

/** One chip per DETECTED target, in the order the backend reported them. */
export function harnessChips(health: HarnessHealth | null): HarnessChip[] {
  if (health === null) return [];
  return health.targets
    .filter((target) => target.detected)
    .map((target) => ({
      target: target.target,
      label: harnessTargetLabel(target.target),
      state:
        target.writeFailed.length > 0
          ? 'write-failed'
          : harnessTargetNeedsAttention(target)
            ? 'out-of-sync'
            : 'in-sync',
    }));
}

/**
 * Detected CLIs in sync out of every detected CLI. An undetected target is
 * not installed here, so it is neither healthy nor a gap (the shared
 * reducer's rule, `harness-health.model.ts`).
 */
export function harnessKpi(health: HarnessHealth | null): KpiFigure {
  if (health === null) {
    return { value: null, unit: null, subLine: 'No harness report yet.' };
  }
  const chips = harnessChips(health);
  if (chips.length === 0) {
    return {
      value: null,
      unit: null,
      subLine: 'No CLI detected in this workspace.',
    };
  }
  const healthy = chips.filter((chip) => chip.state === 'in-sync').length;
  return {
    value: `${healthy} of ${chips.length}`,
    unit: 'healthy',
    subLine: null,
  };
}

/**
 * The harness card's state. A report in hand keeps the card `ready` (its
 * figures stay on screen) through a re-read and after a failed one; that
 * failure is shown beside the figures by {@link harnessStaleError}. Without a
 * report, a failure is the error state and a read in flight the skeleton. No
 * report, no read, no error means no pass has run (no workspace open): a ready
 * card that says so.
 */
export function harnessWidgetState(
  health: HarnessHealth | null,
  loading: boolean,
  error: string | null,
): OverviewWidgetState {
  if (health !== null) return 'ready';
  if (error !== null) return 'error';
  return loading ? 'loading' : 'ready';
}

/**
 * The failure of the last harness call while an older report is still shown,
 * or `null`. The card keeps the old figures and shows this line with a Retry,
 * so a failed refresh never passes for a fresh report.
 */
export function harnessStaleError(
  health: HarnessHealth | null,
  error: string | null,
): string | null {
  return health !== null && error !== null ? error : null;
}
