/**
 * Entitlement model — the license ↔ Paddle-subscription join, derived once and
 * shared by the two surfaces that replaced the old standalone Licenses and
 * Subscriptions tabs: `UsersList` (one row per user) and `UserProfile` (the
 * full billing section).
 *
 * WHY THIS IS DERIVED CLIENT-SIDE: there is no FK between `License` and
 * `Subscription` in `prisma/schema.prisma` — the only join is `userId`, plus
 * `User.paddleCustomerId` ↔ `Subscription.paddleCustomerId`. The backend
 * therefore ships both relations verbatim (`ADMIN_MODELS.users.include`) and
 * the relationship is interpreted here, where it is presentation.
 *
 * The interpretation is deliberately conservative: a license is only tied to a
 * subscription when the user actually holds one. Everything else is reported as
 * a discrepancy rather than guessed at.
 */

import type { BadgeVariant } from '@ptah-web/panel-ui';

/** Window (days) inside which an active license is flagged "expiring soon". */
export const EXPIRING_SOON_DAYS = 14;

/** Subscription states that still entitle the holder to paid features. */
const LIVE_SUB_STATUSES: readonly string[] = ['active', 'trialing'];

/** `License.source` values that assert the license was PAID FOR via Paddle. */
const PAID_SOURCES: readonly string[] = ['paddle'];

export interface LicenseRecord {
  id: string;
  licenseKey: string;
  plan: string;
  status: string;
  source: string;
  expiresAt: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

export interface SubscriptionRecord {
  id: string;
  paddleSubscriptionId: string;
  paddleCustomerId: string;
  status: string;
  priceId: string;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  canceledAt: string | null;
  createdAt: string | null;
}

/** A user row as returned once `users` includes its billing relations. */
export interface UserWithBilling {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  emailVerified: boolean;
  workosId: string | null;
  paddleCustomerId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  licenses?: LicenseRecord[];
  subscriptions?: SubscriptionRecord[];
}

/**
 * A reconciliation finding. `severity` drives color only — every finding here
 * describes a state a human should look at, never a hard failure of this view.
 */
export interface Discrepancy {
  code:
    | 'paid-license-no-subscription'
    | 'subscription-no-active-license'
    | 'customer-id-mismatch'
    | 'multiple-active-licenses';
  severity: 'warning' | 'error';
  message: string;
}

export interface Entitlement {
  /** Best active license, or null when the user holds none. */
  activeLicense: LicenseRecord | null;
  /** Subscription in a state that still grants access, or null. */
  liveSubscription: SubscriptionRecord | null;
  /** All active licenses (>1 is itself a discrepancy). */
  activeLicenses: readonly LicenseRecord[];
  /** True when the active license claims a Paddle origin. */
  isPaid: boolean;
  /** True when an active license expires within {@link EXPIRING_SOON_DAYS}. */
  expiringSoon: boolean;
  /** Findings from cross-checking licenses against subscriptions. */
  discrepancies: readonly Discrepancy[];
}

/**
 * Cross-check a user's licenses against their Paddle subscriptions.
 *
 * Missing relations (an endpoint that does not include them) are treated as
 * empty, never as "no entitlement confirmed" — callers that cannot tell the two
 * apart should not render the reconciliation at all.
 */
export function deriveEntitlement(user: UserWithBilling): Entitlement {
  const licenses = user.licenses ?? [];
  const subscriptions = user.subscriptions ?? [];

  const activeLicenses = licenses.filter((l) => l.status === 'active');
  const activeLicense = pickPrimaryLicense(activeLicenses);
  const liveSubscription =
    subscriptions.find((s) => LIVE_SUB_STATUSES.includes(s.status)) ?? null;

  const isPaid = activeLicense
    ? PAID_SOURCES.includes(activeLicense.source)
    : false;

  const discrepancies: Discrepancy[] = [];

  // The headline case: the license says someone paid Paddle, but no
  // subscription row exists at all — a dropped webhook or a mislabeled source.
  if (isPaid && subscriptions.length === 0) {
    discrepancies.push({
      code: 'paid-license-no-subscription',
      severity: 'error',
      message:
        'Active license is marked as a Paddle purchase but this user has no subscription record. Either the webhook never landed or the license source is mislabeled.',
    });
  }

  // The inverse: money is coming in, nothing is entitled.
  if (liveSubscription && !activeLicense) {
    discrepancies.push({
      code: 'subscription-no-active-license',
      severity: 'error',
      message: `Paddle subscription ${liveSubscription.paddleSubscriptionId} is ${liveSubscription.status} but the user holds no active license.`,
    });
  }

  // The two identity columns that must agree for Paddle lookups to resolve.
  const subCustomerId = (liveSubscription ?? subscriptions[0])
    ?.paddleCustomerId;
  if (
    subCustomerId &&
    user.paddleCustomerId &&
    subCustomerId !== user.paddleCustomerId
  ) {
    discrepancies.push({
      code: 'customer-id-mismatch',
      severity: 'warning',
      message: `User record points at Paddle customer ${user.paddleCustomerId}, but the subscription belongs to ${subCustomerId}.`,
    });
  }

  if (activeLicenses.length > 1) {
    discrepancies.push({
      code: 'multiple-active-licenses',
      severity: 'warning',
      message: `${activeLicenses.length} licenses are active at once — issuance normally revokes the previous one.`,
    });
  }

  return {
    activeLicense,
    liveSubscription,
    activeLicenses,
    isPaid,
    expiringSoon: activeLicense ? isExpiringSoon(activeLicense) : false,
    discrepancies,
  };
}

/**
 * Which active license represents the user. Paid plans outrank the free tier,
 * so a community license left over from signup never masks a Builders one.
 */
function pickPrimaryLicense(
  active: readonly LicenseRecord[],
): LicenseRecord | null {
  if (active.length === 0) return null;
  return active.find((l) => l.plan !== 'community') ?? active[0];
}

/** True when the license lapses within the warning window. Lifetime never does. */
export function isExpiringSoon(license: LicenseRecord): boolean {
  if (license.expiresAt == null) return false;
  const at = new Date(license.expiresAt).getTime();
  if (Number.isNaN(at)) return false;
  const days = (at - Date.now()) / 86_400_000;
  return days >= 0 && days <= EXPIRING_SOON_DAYS;
}

/** Short label for the user's plan, e.g. the list's License column. */
export function planLabel(e: Entitlement): string {
  if (!e.activeLicense) return 'None';
  const plan = e.activeLicense.plan;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** Badge color for the license cell — mirrors the license status semantics. */
export function planVariant(e: Entitlement): BadgeVariant {
  if (!e.activeLicense) return 'ghost';
  if (e.expiringSoon) return 'warning';
  return e.activeLicense.plan === 'community' ? 'info' : 'success';
}

/** Short label for the subscription column. */
export function subscriptionLabel(e: Entitlement): string {
  if (e.liveSubscription) return e.liveSubscription.status;
  return 'None';
}

export function subscriptionVariant(e: Entitlement): BadgeVariant {
  if (!e.liveSubscription) return 'ghost';
  return e.liveSubscription.status === 'trialing' ? 'info' : 'success';
}
