/**
 * Subscription Events for EventEmitter pattern
 *
 * These events decouple the subscription service from SSE notifications.
 * The SubscriptionService emits events, and listeners handle side effects
 * without blocking the main flow.
 */

/**
 * Event names as constants for type safety
 */
export const SUBSCRIPTION_EVENTS = {
  LICENSE_UPDATED: 'subscription.license.updated',
  STATUS_CHANGED: 'subscription.status.changed',
  RECONCILIATION_COMPLETED: 'subscription.reconciliation.completed',
} as const;

/**
 * Payload for license updated event
 * Emitted when a license is created or updated
 */
export class LicenseUpdatedEvent {
  constructor(
    public readonly email: string,
    public readonly plan: string,
    public readonly status: 'active' | 'expired' | 'revoked' | 'trialing',
    public readonly expiresAt: string
  ) {}
}

/**
 * Payload for subscription status changed event
 * Emitted when subscription status changes (active, canceled, etc.)
 */
export class SubscriptionStatusChangedEvent {
  constructor(
    public readonly email: string,
    public readonly status:
      | 'trialing'
      | 'active'
      | 'past_due'
      | 'paused'
      | 'canceled',
    public readonly plan: string
  ) {}
}

/**
 * Payload for reconciliation completed event
 * Emitted after successful reconciliation with Paddle
 */
export class ReconciliationCompletedEvent {
  constructor(
    public readonly email: string,
    public readonly userId: string,
    public readonly subscriptionId: string,
    public readonly changes: {
      subscriptionUpdated: boolean;
      licenseUpdated: boolean;
      statusBefore: string;
      statusAfter: string;
    }
  ) {}
}
