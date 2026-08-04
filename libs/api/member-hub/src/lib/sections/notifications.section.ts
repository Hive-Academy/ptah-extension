import { Injectable } from '@nestjs/common';
import type {
  HubNotificationSummary,
  HubSection,
} from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';
import { EMPTY_NOTIFICATIONS, type HubSectionResolver } from './hub-section';

/**
 * The hub's `notifications` section — the unread badge count (R6.1, R10.4).
 *
 * ── PHASE 1: `{ status: 'empty', data: { unreadCount: 0 } }` ───────────────
 * The `Notification` table arrives with Batch 14 (P5). Until then the count is
 * genuinely zero, so `'empty'` is the truthful status.
 *
 * ⚠️ THE COUNT IS ON THE HUB *AND* GETS ITS OWN POLL ENDPOINT LATER, and that
 * is not a duplication. The hub delivers the badge on the initial render as
 * part of the single request R6.2 asserts; `GET /v1/members/notifications/unread-count`
 * (AD-14, Batch 14) is the ≥60 s refresh for an already-open tab. Fetching the
 * whole hub on a 60-second timer would be the alternative, and it would make
 * the cheapest thing in the product the most expensive.
 *
 * ⚠️ `data` is an OBJECT, not a bare number, so Phase 5 can add a per-kind
 * breakdown without touching the envelope (R6.6).
 */
@Injectable()
export class NotificationsSection implements HubSectionResolver<HubNotificationSummary> {
  async resolve(
    _ctx: MemberContext,
  ): Promise<HubSection<HubNotificationSummary>> {
    return { status: 'empty', data: { ...EMPTY_NOTIFICATIONS } };
  }
}
