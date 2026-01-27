import { IsString } from 'class-validator';

/**
 * Subscription DTOs for TASK_2025_123
 *
 * Request/response types for subscription management endpoints
 */

// ============================================================================
// Request DTOs (with validation)
// ============================================================================

/**
 * DTO for validating a checkout request
 *
 * Used before opening Paddle checkout overlay to prevent
 * duplicate subscriptions.
 */
export class ValidateCheckoutDto {
  @IsString()
  priceId!: string;
}

// ============================================================================
// Response DTOs (plain classes, no validation needed)
// ============================================================================

/**
 * Subscription details in status response
 */
export interface SubscriptionDetails {
  id: string;
  status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'paused';
  plan: 'basic' | 'pro' | string;
  billingCycle: 'monthly' | 'yearly';
  currentPeriodEnd: string;
  canceledAt?: string;
  trialEnd?: string;
}

/**
 * Response DTO for GET /subscriptions/status
 *
 * Returns current subscription status from Paddle API (source of truth)
 * with local fallback if Paddle API is unavailable.
 *
 * Strategy:
 * - Always query Paddle first (source of truth)
 * - Fall back to local DB only if Paddle is unavailable
 * - If Paddle and local differ, set requiresSync=true
 */
export class SubscriptionStatusResponseDto {
  /** Whether user has an active subscription */
  hasSubscription!: boolean;

  /** Subscription details if hasSubscription is true */
  subscription?: SubscriptionDetails;

  /** Data source: 'paddle' for live API, 'local' for database fallback */
  source!: 'paddle' | 'local';

  /** True if local data differs from Paddle - user should click sync */
  requiresSync?: boolean;

  /** Customer portal URL for managing subscription */
  customerPortalUrl?: string;
}

/**
 * Response DTO for POST /subscriptions/validate-checkout
 *
 * Returns whether user can proceed with checkout.
 * If false, includes reason and portal link.
 */
export class ValidateCheckoutResponseDto {
  /** Whether user can proceed with checkout */
  canCheckout!: boolean;

  /** Reason if checkout is blocked */
  reason?: 'existing_subscription' | 'subscription_ending_soon' | 'none';

  /** Existing plan if blocking checkout */
  existingPlan?: string;

  /** When current subscription period ends */
  currentPeriodEnd?: string;

  /** Portal URL to manage existing subscription */
  customerPortalUrl?: string;

  /** Human-readable message explaining the status */
  message?: string;
}

/**
 * Changes made during reconciliation
 */
export interface ReconcileChanges {
  subscriptionUpdated: boolean;
  licenseUpdated: boolean;
  statusBefore: string;
  statusAfter: string;
  planBefore?: string;
  planAfter?: string;
}

/**
 * Paddle subscription info in reconcile response
 */
export interface PaddleSubscriptionInfo {
  id: string;
  status: string;
  plan: string;
  currentPeriodEnd: string;
}

/**
 * Response DTO for POST /subscriptions/reconcile
 *
 * Returns summary of changes made during sync with Paddle.
 */
export class ReconcileResponseDto {
  /** Whether reconciliation completed successfully */
  success!: boolean;

  /** Summary of changes made */
  changes!: ReconcileChanges;

  /** Any errors encountered during reconciliation */
  errors?: string[];

  /** Paddle subscription data after reconciliation */
  paddleSubscription?: PaddleSubscriptionInfo;
}

/**
 * Response DTO for POST /subscriptions/portal-session
 *
 * Returns Paddle customer portal URL.
 */
export class PortalSessionResponseDto {
  /** Portal URL - valid for 60 minutes */
  url!: string;

  /** When the portal URL expires */
  expiresAt!: string;
}

/**
 * Error response for portal session creation failures
 */
export class PortalSessionErrorDto {
  /** Error type */
  error!: 'no_customer_record' | 'paddle_api_error';

  /** Human-readable error message */
  message!: string;
}
