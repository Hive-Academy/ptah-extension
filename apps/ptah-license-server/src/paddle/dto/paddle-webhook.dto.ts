import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
  ValidateNested,
  IsDateString,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Paddle Customer DTO - Customer information from webhook payload
 */
export class PaddleCustomerDto {
  @IsString()
  id!: string;

  @IsString()
  email!: string;

  @IsString()
  @IsOptional()
  name?: string;
}

/**
 * Paddle Price DTO - Price information from subscription items
 */
export class PaddlePriceDto {
  @IsString()
  id!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  name?: string;
}

/**
 * Paddle Subscription Item DTO - Line item in a subscription
 */
export class PaddleSubscriptionItemDto {
  @IsObject()
  @ValidateNested()
  @Type(() => PaddlePriceDto)
  price!: PaddlePriceDto;

  @IsString()
  @IsOptional()
  quantity?: string;
}

/**
 * Paddle Billing Period DTO - Current billing period dates
 */
export class PaddleBillingPeriodDto {
  @IsDateString()
  starts_at!: string;

  @IsDateString()
  ends_at!: string;
}

/**
 * Paddle Subscription Data DTO - Core subscription data from webhook
 *
 * TASK_2025_121: Added trial_end field for trial detection
 *
 * Used by:
 * - subscription.created
 * - subscription.updated
 * - subscription.canceled
 * - subscription.activated
 *
 * Status values:
 * - 'trialing': Subscription is in trial period
 * - 'active': Subscription is active with payment
 * - 'past_due': Payment failed, in dunning period
 * - 'paused': User paused subscription
 * - 'canceled': Subscription canceled
 */
export class PaddleSubscriptionDataDto {
  @IsString()
  id!: string;

  /**
   * Subscription status
   * 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled'
   */
  @IsString()
  status!: string;

  @IsString()
  @IsOptional()
  customer_id?: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PaddleCustomerDto)
  customer!: PaddleCustomerDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaddleSubscriptionItemDto)
  items!: PaddleSubscriptionItemDto[];

  @IsObject()
  @ValidateNested()
  @Type(() => PaddleBillingPeriodDto)
  current_billing_period!: PaddleBillingPeriodDto;

  /**
   * TASK_2025_121: Trial end date (ISO 8601 format)
   * Present when subscription.status === 'trialing'
   * Used to determine when trial period expires
   */
  @IsDateString()
  @IsOptional()
  trial_end?: string;

  @IsDateString()
  @IsOptional()
  canceled_at?: string;

  @IsDateString()
  @IsOptional()
  started_at?: string;

  @IsDateString()
  @IsOptional()
  first_billed_at?: string;

  @IsDateString()
  @IsOptional()
  next_billed_at?: string;
}

/**
 * Paddle Webhook Payload DTO - Main webhook request body
 *
 * Event types handled:
 * - subscription.created: New subscription created after successful payment
 * - subscription.updated: Subscription plan or status changed
 * - subscription.canceled: Subscription canceled (still active until period end)
 *
 * Security:
 * - Always verify paddle-signature header before processing
 * - Use event_id for idempotency to prevent duplicate processing
 */
export class PaddleWebhookPayloadDto {
  @IsString()
  event_id!: string;

  @IsString()
  event_type!: string;

  @IsDateString()
  occurred_at!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PaddleSubscriptionDataDto)
  data!: PaddleSubscriptionDataDto;
}

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
 * Type guard for subscription events
 * @deprecated Use SubscriptionEventType for new code
 */
export type PaddleSubscriptionEventType = SubscriptionEventType;

/**
 * Check if event type is a subscription event
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
 * All handled Paddle webhook events (subscriptions + transactions)
 */
export const HANDLED_EVENTS = [
  ...SUBSCRIPTION_EVENTS,
  ...TRANSACTION_EVENTS,
] as const;

export type HandledEventType = (typeof HANDLED_EVENTS)[number];

/**
 * Check if event type is a transaction event
 */
export function isTransactionEvent(
  eventType: string
): eventType is TransactionEventType {
  return TRANSACTION_EVENTS.includes(eventType as TransactionEventType);
}

/**
 * Check if event type is any handled event (subscription or transaction)
 */
export function isHandledEvent(
  eventType: string
): eventType is HandledEventType {
  return HANDLED_EVENTS.includes(eventType as HandledEventType);
}

/**
 * Paddle Transaction Data DTO - Transaction data from webhook
 *
 * Used by:
 * - transaction.completed: Successful payment (initial or renewal)
 *
 * For subscription renewals:
 * - subscription_id is present (links to subscription)
 * - billing_period contains the new period dates
 *
 * For one-time purchases:
 * - subscription_id is NOT present
 * - billing_period may not be present
 */
export class PaddleTransactionDataDto {
  @IsString()
  id!: string;

  /**
   * Subscription ID - present ONLY for subscription transactions (renewals)
   * Null/undefined for one-time purchases
   */
  @IsString()
  @IsOptional()
  subscription_id?: string;

  /**
   * Transaction status
   * 'completed' for successful payments
   * 'billed' for invoiced but not yet paid
   * 'canceled', 'past_due', etc.
   */
  @IsString()
  status!: string;

  /**
   * Billing period for subscription renewals
   * Contains the NEW period dates after successful renewal
   * Not present for one-time purchases
   */
  @IsObject()
  @ValidateNested()
  @Type(() => PaddleBillingPeriodDto)
  @IsOptional()
  billing_period?: PaddleBillingPeriodDto;

  /**
   * Customer ID for fetching customer details
   */
  @IsString()
  @IsOptional()
  customer_id?: string;
}
