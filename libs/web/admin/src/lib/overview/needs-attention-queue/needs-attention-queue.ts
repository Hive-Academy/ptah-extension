import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CreditCard,
  LucideAngularModule,
  type LucideIconData,
  UserPlus,
} from 'lucide-angular';

/**
 * Backend aggregate counts for the action queue (design spec §3.1). Mirrors
 * `AdminStatsAttention` from `admin-api.service.ts` but kept local so this
 * presentational component carries no service dependency.
 */
export interface AttentionCounts {
  waitlistUninvited: number;
  failedWebhooksUnresolved: number;
  subscriptionsPastDue: number;
  sessionRequestsPending: number;
}

/** A single action-queue row descriptor. */
interface QueueRow {
  key: string;
  label: string;
  context: string;
  icon: LucideIconData;
  link: string;
  queryParams: Record<string, string> | null;
  /** Resolved count, or `null` when the backend aggregate is not yet wired. */
  count: number | null;
  /** Icon-well classes for the urgent state (color-by-urgency, §3.3). */
  wellClass: string;
  /** Count-badge text color for the urgent state. */
  countClass: string;
}

/**
 * NeedsAttentionQueue — the Overview's top-priority action queue (§3.3).
 *
 * Reads like a to-do list, not a metric wall: each row is a whole-row deep
 * link with an urgency-tinted icon well, a count badge, and a chevron. Rows
 * degrade gracefully in three states:
 *   - count > 0  → urgent action row (error/warning tinted)
 *   - count = 0  → collapsed muted "all caught up" line (no crying wolf)
 *   - count null → "not wired" state ("—" + tooltip) when the backend
 *                  `attention` block hasn't shipped yet (never a fake 0)
 * When every wired row is 0, the whole panel collapses to a success strip.
 */
@Component({
  selector: 'ptah-admin-needs-attention-queue',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, LucideAngularModule],
  templateUrl: './needs-attention-queue.html',
})
export class NeedsAttentionQueue {
  /**
   * Waitlist-not-yet-invited count. Always client-computable
   * (`waitlist.total - waitlist.notified`), so row 1 never falls into the
   * "not wired" state.
   */
  public readonly waitlistUninvited = input<number>(0);

  /**
   * The backend `attention` block, or `null` when the server predates it —
   * in which case rows 2–4 render in the muted "not wired" state.
   */
  public readonly attention = input<AttentionCounts | null>(null);

  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly CheckCircleIcon = CheckCircle2;

  protected readonly rows = computed<QueueRow[]>(() => {
    const att = this.attention();
    const warnWell = 'bg-warning/10 text-warning';
    const errWell = 'bg-error/10 text-error';

    const rows: QueueRow[] = [
      {
        key: 'waitlist',
        label: 'Waitlist not yet invited',
        context: 'Eligible for the next founding-invite batch',
        icon: UserPlus,
        link: '/admin/waitlist',
        queryParams: { tab: 'new' },
        count: this.waitlistUninvited(),
        wellClass: warnWell,
        countClass: 'text-warning',
      },
      {
        key: 'webhooks',
        label: 'Unresolved failed webhooks',
        context: 'Payment or webhook errors need a human',
        icon: AlertTriangle,
        link: '/admin/failed-webhooks',
        queryParams: null,
        count: att ? att.failedWebhooksUnresolved : null,
        wellClass: errWell,
        countClass: 'text-error',
      },
      {
        key: 'subscriptions',
        label: 'Subscriptions past due',
        context: 'Billing needs attention in Paddle',
        icon: CreditCard,
        // Licenses + subscriptions merged into the user surface; `pastDue` is
        // the server-side preset for "holds a past_due Paddle subscription".
        link: '/admin/users',
        queryParams: { filter: 'entitlement:pastDue' },
        count: att ? att.subscriptionsPastDue : null,
        wellClass: warnWell,
        countClass: 'text-warning',
      },
      {
        key: 'sessions',
        label: 'Pending session requests',
        context: 'Awaiting scheduling or payment',
        icon: CalendarClock,
        link: '/admin/session-requests',
        queryParams: null,
        count: att ? att.sessionRequestsPending : null,
        wellClass: warnWell,
        countClass: 'text-warning',
      },
    ];
    return rows;
  });

  /**
   * True only when every row has a real (non-null) count and all are 0 — a
   * "not wired" (null) row prevents a false all-clear.
   */
  protected readonly allCaughtUp = computed<boolean>(() =>
    this.rows().every((r) => r.count === 0),
  );
}
