/**
 * Outcome-signals wire contract (TASK_2026_646, Req 9.1).
 *
 * `agent:outcomeSignals` is the read behind the Agents tab's per-slug outcome
 * signals. The response carries ids, counts and ratios only: no request text,
 * prompt text, file contents or paths (Req 5.8). Every type is a closed
 * object (no index signature beyond the slug → signals map the contract
 * itself defines), so a handler cannot spread an outcome record into it.
 */

import type { AgentOutcomeSignals } from '../lane-outcome.types';

// ---------------------------------------------------------------------------
// agent:outcomeSignals
// ---------------------------------------------------------------------------

/**
 * Slugs to report on. The handler's `.strict()` schema accepts at most 500
 * slugs, each at most 200 characters (SC-8).
 */
export interface AgentOutcomeSignalsParams {
  readonly slugs: string[];
}

/**
 * Result of `agent:outcomeSignals`.
 *
 * A slug with no records in the window is absent from `signals` — the same
 * "missing = no data yet" rule as `skill-clones-state.service.ts`. The
 * handler computes over part B's W = 30-day window and echoes it in
 * `windowDays`; `persistent` is false while the durable store the signals
 * came from is not readable, so the UI can say so.
 */
export interface AgentOutcomeSignalsResult {
  readonly signals: Record<string, AgentOutcomeSignals>;
  readonly windowDays: number;
  readonly persistent: boolean;
}