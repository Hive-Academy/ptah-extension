/**
 * Stats-grid limit view model (TASK_2026_596, Component 15; design §3 with
 * the Gate 1.7 amendments A1-A3).
 *
 * Pure: the clock (`now`), the time zone and the zone-name locale come in the
 * input, so the same snapshot renders the same text on every machine. Every
 * state decision is delegated to the shared plan-limit engine
 * (`classifyWindow` through `classifyLaneState`, `applicableLimits`,
 * `ownerRelation`); this file only arranges the results into tiles and text.
 *
 * Rules carried here:
 * - Unknown is never 0. A missing used value, token count or cost reads
 *   "unknown"; `usageTotals` that is `null` or absent is unknown.
 * - Lane usage never enters the session totals (Req 8.5): this model has no
 *   session token or cost field at all, only the lane tiles and their own
 *   subtotal.
 * - A lane run is judged on the owner recorded at its run (G3). A run with no
 *   valid recorded owner is "Unknown owner · owner not recorded" and never
 *   borrows the session's or any other owner's windows (R7).
 * - "Same account" only when `ownerRelation` says `same` (A1); "see plan
 *   tiles" replaces a window's detail only when a session plan tile renders
 *   that same window (A2).
 * - A snapshot listed from saved evidence alone arrives as
 *   `service-unavailable` (with `no-open-session` for a Claude account). It
 *   is shown as that owner's last-known evidence, by owner comparison, never
 *   as a live read failure. An Anthropic API-key owner arrives as
 *   `unsupported-auth` with no windows and is shown as unsupported.
 */
import { FRESHNESS_MS, NEAR_LIMIT_PERCENT } from '@ptah-extension/shared';
import { groupLaneRuns, laneTile, subtotalTile } from './lane-tiles';
import { sessionPlan } from './plan-limit-tiles';
import type {
  StatsLimitContext,
  StatsLimitViewModel,
  StatsLimitViewModelInput,
} from './stats-limit-view-model.types';

export function buildStatsLimitViewModel(
  input: StatsLimitViewModelInput,
): StatsLimitViewModel {
  const ctx: StatsLimitContext = {
    now: input.now,
    time: input.time,
    lane: {
      now: input.now,
      nearLimitPercent: NEAR_LIMIT_PERCENT,
      freshnessMs: FRESHNESS_MS,
    },
  };
  const session = sessionPlan(input, ctx);
  const laneTiles = groupLaneRuns(input.laneRuns).map((runs) =>
    laneTile(runs, input.owners, session, ctx),
  );
  return {
    ...(session.indicator && { indicator: session.indicator }),
    planTiles: session.tiles,
    laneTiles,
    ...(input.laneRuns.length > 0 && {
      subtotal: subtotalTile(input.laneRuns, laneTiles.length),
    }),
    lanesCount: input.laneRuns.length,
  };
}
