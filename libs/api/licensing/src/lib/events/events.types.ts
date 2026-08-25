/**
 * SSE Event Types for Real-time Updates
 *
 * These events are broadcast to connected clients when subscription
 * or license status changes occur.
 */

/**
 * Base event interface
 */
export interface BaseEvent {
  type: string;
  timestamp: string;
}

/**
 * License updated event - sent when a license is created or modified
 *
 * SECURITY: Does NOT include licenseKey - that is sent via email only.
 * This event signals the frontend to refresh license data from the API.
 */
export interface LicenseUpdatedEvent extends BaseEvent {
  type: 'license.updated';
  data: {
    email: string;
    plan: string;
    status: 'active' | 'expired' | 'revoked' | 'trialing';
    expiresAt: string | null;
  };
}

/**
 * Subscription status changed event
 */
export interface SubscriptionStatusEvent extends BaseEvent {
  type: 'subscription.status_changed';
  data: {
    email: string;
    status: 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
    plan: string;
  };
}

/**
 * Connection established event - sent immediately on connection
 */
export interface ConnectionEvent extends BaseEvent {
  type: 'connected';
  data: {
    message: string;
  };
}

/**
 * Heartbeat event - sent periodically to keep connection alive
 */
export interface HeartbeatEvent extends BaseEvent {
  type: 'heartbeat';
  data: {
    serverTime: string;
  };
}

/**
 * Reconciliation completed event - sent when user syncs with Paddle
 *
 * This event is emitted after a successful reconciliation operation
 * that syncs local database state with Paddle's subscription data.
 */
export interface ReconciliationCompletedEvent extends BaseEvent {
  type: 'reconciliation.completed';
  data: {
    email: string;
    success: boolean;
    changes: {
      subscriptionUpdated: boolean;
      licenseUpdated: boolean;
    };
  };
}

/**
 * Union type of all SSE events
 */
export type SSEEvent =
  | LicenseUpdatedEvent
  | SubscriptionStatusEvent
  | ConnectionEvent
  | HeartbeatEvent
  | ReconciliationCompletedEvent;

/**
 * Event names for type-safe event emission
 */
export type SSEEventType = SSEEvent['type'];
