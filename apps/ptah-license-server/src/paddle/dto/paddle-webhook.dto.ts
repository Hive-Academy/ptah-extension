/**
 * Paddle Webhook DTO Module
 *
 * This module provides type guards and event type constants for Paddle webhooks.
 *
 * NOTE: Most DTOs have been removed as they duplicate types from @paddle/paddle-node-sdk.
 * The SDK provides fully typed event entities via Webhooks.unmarshal().
 *
 * SDK types to use instead:
 * - SubscriptionCreatedNotification (replaces PaddleSubscriptionDataDto)
 * - SubscriptionNotification (for updated/canceled/paused/resumed events)
 * - TransactionNotification (replaces PaddleTransactionDataDto)
 * - EventEntity (union of all event types)
 * - EventName (enum of all event type strings)
 *
 * Import from '@paddle/paddle-node-sdk':
 * ```typescript
 * import {
 *   EventName,
 *   EventEntity,
 *   SubscriptionCreatedEvent,
 *   SubscriptionNotification,
 *   TransactionNotification,
 * } from '@paddle/paddle-node-sdk';
 * ```
 */

/**
 * Subscription event types supported by Paddle Billing v2
 *
 * Paddle Billing v2 best practices:
 * - subscription.activated: Primary event for provisioning (recommended over subscription.created)
 * - subscription.past_due: Payment failed, entering dunning period
 * - subscription.paused: User paused subscription
 * - subscription.resumed: User resumed paused subscription
 */
const SUBSCRIPTION_EVENTS = [
  'subscription.created',
  'subscription.activated',
  'subscription.updated',
  'subscription.canceled',
  'subscription.past_due',
  'subscription.paused',
  'subscription.resumed',
] as const;

export type SubscriptionEventType = (typeof SUBSCRIPTION_EVENTS)[number];

/**
 * Check if event type is a subscription event
 *
 * @param eventType - Event type string to check
 * @returns True if event is a subscription event
 */
export function isSubscriptionEvent(
  eventType: string
): eventType is SubscriptionEventType {
  return SUBSCRIPTION_EVENTS.includes(eventType as SubscriptionEventType);
}

/**
 * Transaction events supported by Paddle Billing v2
 *
 * transaction.completed: Fires when a payment succeeds. For subscriptions,
 * this occurs on renewals after the initial payment (which uses subscription.created).
 */
const TRANSACTION_EVENTS = ['transaction.completed'] as const;

export type TransactionEventType = (typeof TRANSACTION_EVENTS)[number];

/**
 * Check if event type is a transaction event
 *
 * @param eventType - Event type string to check
 * @returns True if event is a transaction event
 */
export function isTransactionEvent(
  eventType: string
): eventType is TransactionEventType {
  return TRANSACTION_EVENTS.includes(eventType as TransactionEventType);
}

/**
 * All handled Paddle webhook events (subscriptions + transactions)
 */
export const HANDLED_EVENTS = [
  ...SUBSCRIPTION_EVENTS,
  ...TRANSACTION_EVENTS,
] as const;

export type HandledEventType = (typeof HANDLED_EVENTS)[number];

/**
 * Check if event type is any handled event (subscription or transaction)
 *
 * @param eventType - Event type string to check
 * @returns True if event is a handled event type
 */
export function isHandledEvent(
  eventType: string
): eventType is HandledEventType {
  return HANDLED_EVENTS.includes(eventType as HandledEventType);
}

/**
 * Maps a Paddle SDK EventEntity to a Prisma-compatible JSON payload
 *
 * The SDK's EventEntity contains class instances and Date objects that
 * need to be serialized for JSON storage in the FailedWebhook table.
 *
 * @param event - The SDK EventEntity from webhooks.unmarshal()
 * @returns A plain object safe for Prisma JSON storage
 *
 * @example
 * ```typescript
 * import { mapEventToStoredPayload } from './dto/paddle-webhook.dto';
 *
 * await prisma.failedWebhook.create({
 *   data: {
 *     eventId: event.eventId,
 *     eventType: event.eventType,
 *     rawPayload: mapEventToStoredPayload(event),
 *     errorMessage: error.message,
 *   },
 * });
 * ```
 */
export function mapEventToStoredPayload(event: {
  eventId: string;
  eventType: string;
  occurredAt: Date | string;
  notificationId?: string | null;
  data: unknown;
}) {
  return {
    eventId: event.eventId,
    eventType: event.eventType,
    occurredAt:
      event.occurredAt instanceof Date
        ? event.occurredAt.toISOString()
        : String(event.occurredAt),
    ...(event.notificationId && { notificationId: event.notificationId }),
    data: JSON.parse(JSON.stringify(event.data)),
  };
}
