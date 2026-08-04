/**
 * `@ptah-contracts/community` — the member/admin wire contracts for the native
 * community platform.
 *
 * ⚠️ PURE LEAF. This lib imports NO other workspace lib, and it must never
 * import NestJS, Prisma, Angular or anything Node-specific. It is consumed by
 * BOTH `scope:api` (the license server) and `scope:web` (the member panel), so
 * anything that only one side can compile breaks the other. `eslint.config.mjs`
 * pins this structurally: `scope:api-contracts` may
 * `onlyDependOnLibsWithTags: ['scope:api-contracts']`, and this is the only
 * project carrying that tag.
 *
 * ⚠️ THE RULE THIS LIB EXISTS TO ENFORCE (RK-8, NFR-S4/S5, AD-6):
 * `member/` and `admin/` never reference each other. No `extends`, no
 * `implements`, no intersection, no import at all, in either direction.
 * Admin types RE-DECLARE their fields. `lib/contract-boundary.spec.ts` fails
 * the build on any violation — see `README.md` for why re-declaration beats the
 * `AdminSession extends BuildersSession` precedent it inverts.
 */

/* --- shared vocabularies — the ONE thing both sides may import ------------ */
export {
  VISIBILITIES,
  isVisibility,
  type Visibility,
  type MemberCohortBadge,
} from './lib/shared/visibility';
export {
  REACTION_TYPES,
  isReactionType,
  type ReactionType,
  type ReactionCounts,
} from './lib/shared/reaction-type';
export {
  NOTIFICATION_KINDS,
  NOTIFICATION_TARGET_TYPES,
  isNotificationKind,
  type NotificationKind,
  type NotificationTargetType,
} from './lib/shared/notification-kind';
export {
  SESSION_REQUEST_STATUSES,
  isSessionRequestStatus,
  type SessionRequestStatus,
} from './lib/shared/session-request-status';
export {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  FIRST_PAGE,
  pagedSchema,
  type Paged,
} from './lib/shared/paged';

/* --- member contracts ----------------------------------------------------- */
export {
  HUB_SECTION_STATUSES,
  hubSectionSchema,
  memberHubResponseSchema,
  memberEntitlementResponseSchema,
  type HubSectionStatus,
  type HubSection,
  type MemberHubResponse,
  type MemberEntitlementResponse,
} from './lib/member/member-hub.contract';
export {
  hubTopicSummarySchema,
  type HubTopicSummary,
} from './lib/member/member-topic.contract';
export {
  continueLearningSchema,
  type ContinueLearning,
} from './lib/member/member-course.contract';
export {
  HUB_SESSION_KINDS,
  hubSessionSummarySchema,
  type HubSessionKind,
  type HubSessionSummary,
} from './lib/member/member-live.contract';
export {
  memberPackSchema,
  type MemberPack,
} from './lib/member/member-pack.contract';
export {
  hubNotificationSummarySchema,
  memberNotificationSchema,
  type HubNotificationSummary,
  type MemberNotification,
} from './lib/member/member-notification.contract';
export {
  memberSessionRequestSchema,
  type MemberSessionRequest,
} from './lib/member/member-session-request.contract';

/* --- admin contracts ------------------------------------------------------ */
export type { AdminPack } from './lib/admin/admin-pack.contract';
export type { AdminSessionRequest } from './lib/admin/admin-session-request.contract';
