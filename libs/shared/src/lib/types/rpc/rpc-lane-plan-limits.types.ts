/**
 * Lane plan-limit read wire contract (TASK_2026_623, R10.1-R10.4).
 *
 * `agent:getLanePlanLimits` is the read-only, Electron-only RPC behind the
 * `$limits` host source. It returns the per-lane, per-window plan-limit rows
 * that `ptah_agent_list` prints under "Plan limits", as the same text, plus
 * four lane counts and the time the rows were computed.
 *
 * ## Privacy rule this file exists to enforce (R10.4)
 *
 * The response carries display text and counts only. It is NOT, does not
 * contain and does not forward a `PlanLimitsSnapshot`,
 * `PlanLimitOwnerSnapshot` or `QuotaOwnerRef`, because those carry the owner
 * key, provider id, identity kind and account. No field here may hold an
 * owner, account, provider id, CLI session id or email. Every type is a closed
 * object (no index signature), so a handler cannot spread a snapshot into it
 * without a compile error; `rpc-lane-plan-limits.contract.spec.ts` pins the
 * exact key sets.
 *
 * `provider:getPlanLimits` and its result are unrelated and stay unchanged.
 */

// ---------------------------------------------------------------------------
// agent:getLanePlanLimits
// ---------------------------------------------------------------------------

/**
 * The read takes no parameters. In particular it has no `refresh` flag: an
 * agent block is not a user's refresh request, so the read never bypasses the
 * plan-usage reader caches (decisions.md #18).
 */
export type AgentGetLanePlanLimitsParams = Record<string, never>;

/**
 * One plan-limit row: the first five cells of the matching
 * `formatPlanLimitsSection` row, as text. A lane with two windows yields two
 * rows. Missing values carry the list's own words ("unknown", "reset unknown",
 * "-"), never an empty string or a guessed number (R10.3).
 */
export interface AgentLanePlanLimitRow {
  /** Lane label as the list prints it (e.g. a CLI name, or "Unknown"). */
  readonly lane: string;
  /** Window label, or "(none)" for a lane with no windows. */
  readonly window: string;
  /** Used share as the list prints it, or "unknown". */
  readonly used: string;
  /** Limit state as the list prints it (e.g. "AT LIMIT", "near limit"). */
  readonly state: string;
  /** Reset text as the list prints it, or "reset unknown" / "-". */
  readonly reset: string;
}

/**
 * Result of `agent:getLanePlanLimits`.
 *
 * The scalars count LANES, not rows: `lanes` is the number of lanes looked up;
 * `atLimit` and `nearLimit` count lanes whose state is `at-limit` and
 * `near-limit`; `unknown` counts lanes whose state is none of those nor
 * `confirmed-room`.
 */
export interface AgentGetLanePlanLimitsResult {
  readonly rows: readonly AgentLanePlanLimitRow[];
  readonly lanes: number;
  readonly atLimit: number;
  readonly nearLimit: number;
  readonly unknown: number;
  /** Epoch milliseconds the rows were formatted against (the "as of" time). */
  readonly asOf: number;
}
