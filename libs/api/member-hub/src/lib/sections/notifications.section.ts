import { Inject, Injectable } from '@nestjs/common';
import type {
  HubNotificationSummary,
  HubSection,
} from '@ptah-contracts/community';
import type { MemberContext } from '@ptah-api/membership';
import { NotificationsService } from '@ptah-api/notifications';
import type { HubSectionResolver } from './hub-section';

/**
 * The hub's `notifications` section — the unread badge count (R6.1, R10.4).
 *
 * ── WHAT SHIPS (TASK_2026_177 Phase 5) ────────────────────────────────────
 * Migration 5 created `member_notifications`, and this section reads the count
 * through `NotificationsService.unreadCount` — the SAME method
 * `GET /v1/members/notifications/unread-count` serves, returning the SAME
 * `HubNotificationSummary` envelope. One construction site, so the badge on the
 * hub and the badge on the poll cannot disagree about their own field name or
 * about which rows count (RISK-AI: it is a `count` with
 * `{ userId, readAt: null }`, served by `@@index([userId, readAt, createdAt])`,
 * never a `findMany().length`).
 *
 * ⚠️ THE COUNT IS ON THE HUB *AND* HAS ITS OWN POLL ENDPOINT, and that is not a
 * duplication. The hub delivers the badge on the initial render as part of the
 * single request R6.2 asserts; the endpoint (AD-14) is the ≥60 s refresh for an
 * already-open tab. Fetching the whole hub on a 60-second timer would be the
 * alternative, and it would make the cheapest thing in the product the most
 * expensive.
 *
 * ── 🔴 THE STATUS IS DERIVED FROM THE COUNT. IT IS NOT PINNED (F-D) ───────
 * `count > 0 → 'ok'`, otherwise `'empty'`. A member with a clean inbox is
 * genuinely `'empty'`: nothing failed and nothing is switched off, and that is
 * exactly the distinction `'unavailable'` is reserved for (R6.3/R6.4). Zero
 * unread is also the STEADY STATE for a healthy member, so this section reports
 * `'empty'` far more often than `'ok'` — which is another reason pinning it to
 * `'ok'` would have been wrong rather than merely imprecise.
 *
 * ── THIS RESOLVER DOES NOT CATCH (R6.4) ──────────────────────────────────
 * No condition here can be NAMED as unavailable — `NotificationsModule` is
 * `@Global()` and unconditionally registered, and the read is one indexed count
 * on a local table. A database failure propagates to the composer's
 * `Promise.allSettled`, which is the single fault boundary. Swallowing it would
 * report an outage as "you have no notifications".
 *
 * ⚠️ `data` IS AN OBJECT, NOT A BARE NUMBER, so a later per-kind breakdown can
 * be added without touching the envelope (R6.6). That is the same forethought
 * that let Phase 5 fill this section in without a client request changing.
 */
@Injectable()
export class NotificationsSection implements HubSectionResolver<HubNotificationSummary> {
  constructor(
    @Inject(NotificationsService)
    private readonly notifications: NotificationsService,
  ) {}

  async resolve(
    ctx: MemberContext,
  ): Promise<HubSection<HubNotificationSummary>> {
    // ⚠️ THE SERVICE ALREADY RETURNS THE ENVELOPE, so this does not rebuild
    // `{ unreadCount }` — rebuilding it field by field would be a second place
    // the name could drift away from what the client reads.
    const summary = await this.notifications.unreadCount(ctx);

    return {
      status: summary.unreadCount > 0 ? 'ok' : 'empty',
      // 🔴 A SPREAD, NOT A PASSTHROUGH, AND THE SPEC IS WHY THIS LINE EXISTS.
      // Phase 1 handed out `{ ...EMPTY_NOTIFICATIONS }` so two concurrent
      // requests could never share one mutable payload. `unreadCount` happens to
      // allocate a fresh literal today, so a passthrough would have the same
      // behaviour — until it did not, and the failure would be a caller mutating
      // one response and corrupting every later one in the process. The
      // guarantee belongs to THIS resolver rather than to a collaborator's
      // allocation habits, and `notifications.section.spec.ts` asserts it here.
      data: { ...summary },
    };
  }
}
