/**
 * Circle Admin API v2 integration types.
 *
 * Circle hosts the paid Builders members' community (Discord stays free and
 * public). Provisioning is best-effort: every result is a plain data object —
 * the provider NEVER throws raw upstream response bodies at callers, and the
 * provisioning service NEVER rethrows into the Paddle webhook path.
 */

/**
 * Result of inviting a member to the Circle community.
 *
 * - `ok`      — the upstream call succeeded (2xx).
 * - `skipped` — the integration is in feature-off mode (no CIRCLE_API_TOKEN /
 *               CIRCLE_COMMUNITY_ID configured); no HTTP call was made.
 * - `memberId`— Circle community member id (stringified) when resolvable.
 * - `status`  — upstream HTTP status when a call was made.
 * - `error`   — short, sanitized reason (never the raw upstream body).
 */
export interface CircleInviteResult {
  ok: boolean;
  skipped?: boolean;
  memberId?: string;
  status?: number;
  error?: string;
}

/**
 * Result of removing/deactivating a member from the Circle community.
 * Semantics mirror {@link CircleInviteResult}.
 */
export interface CircleRemoveResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}
