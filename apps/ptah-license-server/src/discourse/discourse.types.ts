/**
 * DiscourseConnect (SSO) + Discourse admin group-sync types.
 *
 * Discourse hosts the paid Builders members' forum. Ptah is the SSO provider
 * (DiscourseConnect): members log into Discourse through the license server,
 * which asserts identity + the `builders` group. Separately, the Paddle
 * provisioning fan-out keeps the `builders` group membership in sync via the
 * Discourse admin API (best-effort, non-fatal, audited).
 */

/**
 * A validated inbound DiscourseConnect payload (the `sso`/`sig` pair Discourse
 * sends to the provider). Only `nonce` is load-bearing for the response.
 */
export interface DiscourseSsoRequest {
  nonce: string;
  returnSsoUrl?: string;
}

/** The signed `sso`/`sig` pair we hand back to Discourse. */
export interface DiscourseSsoResponse {
  sso: string;
  sig: string;
}

/**
 * Identity + entitlement we assert to Discourse for the logged-in user.
 * `isBuilders` decides `add_groups` vs `remove_groups: 'builders'`.
 */
export interface DiscourseSsoPayload {
  nonce: string;
  externalId: string;
  email: string;
  name: string;
  isBuilders: boolean;
}

/**
 * Result of a Discourse admin group-sync operation. `skipped` marks feature-off
 * mode or a user not present in Discourse (a tolerated no-op, not a failure).
 */
export interface DiscourseSyncResult {
  ok: boolean;
  skipped?: boolean;
  status?: number;
  error?: string;
}
