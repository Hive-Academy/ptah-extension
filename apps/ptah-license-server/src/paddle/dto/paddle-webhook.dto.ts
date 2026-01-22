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
 * Used by:
 * - subscription.created
 * - subscription.updated
 * - subscription.canceled
 */
export class PaddleSubscriptionDataDto {
  @IsString()
  id!: string;

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
 * Type guard for subscription events
 */
export type PaddleSubscriptionEventType =
  | 'subscription.created'
  | 'subscription.updated'
  | 'subscription.canceled';

/**
 * Check if event type is a subscription event
 */
export function isSubscriptionEvent(
  eventType: string
): eventType is PaddleSubscriptionEventType {
  return [
    'subscription.created',
    'subscription.updated',
    'subscription.canceled',
  ].includes(eventType);
}
