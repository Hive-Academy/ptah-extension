/**
 * DiscourseConnect (SSO) + Discourse admin group-sync types.
 *
 * Discourse hosts the paid Builders members' forum. Ptah is the SSO provider
 * (DiscourseConnect): members log into Discourse through the license server,
 * which asserts identity + the `builders` group. Separately, the Paddle
 * provisioning fan-out keeps the `builders` group membership in sync via the
 * Discourse admin API (best-effort, non-fatal, audited).
 */

import { z } from 'zod';

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
 * `isAdmin` drives the DiscourseConnect `admin`/`moderator` booleans (asserted
 * on every login from the `ADMIN_EMAILS` allowlist — the single source of
 * truth, so a manually-promoted account is auto-demoted next login).
 */
export interface DiscourseSsoPayload {
  nonce: string;
  externalId: string;
  email: string;
  name: string;
  isBuilders: boolean;
  isAdmin: boolean;
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

/**
 * Outbound contract for the read-only in-app community surface
 * (`GET /api/v1/community/summary`). The Discourse REST responses are an
 * external boundary, so the server-side mapping is Zod-validated before it
 * reaches the browser — a shape drift on Discourse's side degrades to `[]`
 * rather than leaking an untyped payload.
 */
export const communityTopicSchema = z.object({
  id: z.number(),
  title: z.string(),
  slug: z.string(),
  postsCount: z.number(),
  lastPostedAt: z.string().nullable(),
  categoryName: z.string().nullable(),
});

export type CommunityTopic = z.infer<typeof communityTopicSchema>;

export const communityTopicsSchema = z.array(communityTopicSchema);

/** Response body for `GET /api/v1/community/summary`. */
export interface CommunitySummary {
  communityUrl: string | null;
  topics: CommunityTopic[];
}

/**
 * One pending item in Discourse's moderation review queue, as surfaced on the
 * READ-ONLY admin community triage surface (TASK_2026_169).
 *
 * Deliberately minimal: enough for an admin to judge WHETHER to open Discourse,
 * never enough to act from here. All moderation lives in Discourse's own admin
 * panel, which has the full context (post body, author history, prior flags,
 * trust level) that a correct moderation decision needs — and an undo.
 *
 * Validated at the boundary like `communityTopicSchema`: a Discourse shape
 * drift degrades to `[]` rather than leaking an untyped payload.
 */
export const reviewQueueItemSchema = z.object({
  id: z.number(),
  type: z.string(),
  topicTitle: z.string().nullable(),
  createdAt: z.string(),
});

export type ReviewQueueItem = z.infer<typeof reviewQueueItemSchema>;

export const reviewQueueItemsSchema = z.array(reviewQueueItemSchema);

/** Response body for `GET /api/v1/admin/community/topics`. */
export interface AdminCommunityTopics {
  communityUrl: string | null;
  topics: CommunityTopic[];
  enabled: boolean;
}

/**
 * Response body for `GET /api/v1/admin/community/review-queue`.
 * `reviewUrl` deep-links into Discourse's own review panel — from this surface,
 * that link is the ONLY path to an action.
 */
export interface AdminReviewQueue {
  items: ReviewQueueItem[];
  count: number;
  reviewUrl: string | null;
}
