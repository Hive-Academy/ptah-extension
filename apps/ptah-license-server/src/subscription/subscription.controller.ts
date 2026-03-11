import {
  Controller,
  Get,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../app/auth/guards/jwt-auth.guard';
import { SubscriptionService } from './subscription.service';
import {
  ValidateCheckoutDto,
  SubscriptionStatusResponseDto,
  ValidateCheckoutResponseDto,
  ReconcileResponseDto,
  PortalSessionResponseDto,
  PortalSessionErrorDto,
} from './dto';

/**
 * SubscriptionController - HTTP endpoints for subscription management
 *
 * TASK_2025_123: Reliable Paddle Subscription Management System
 *
 * All endpoints are protected with JwtAuthGuard and require
 * the ptah_auth cookie to be present.
 *
 * Routes: /api/v1/subscriptions/* (global prefix 'api' is added automatically)
 *
 * Endpoints:
 * - GET  /status           - Get current subscription status
 * - POST /validate-checkout - Validate if user can checkout
 * - POST /reconcile        - Sync local data with Paddle
 * - POST /portal-session   - Get Paddle customer portal URL
 */
@Controller('v1/subscriptions')
export class SubscriptionController {
  constructor(private readonly subscriptionService: SubscriptionService) {}

  /**
   * Get current user's subscription status
   *
   * GET /api/v1/subscriptions/status
   *
   * Queries Paddle API for live subscription data.
   * Falls back to local database if Paddle API is unavailable.
   *
   * @param req - Express request with authenticated user
   * @returns Subscription status with source indicator
   *
   * Response:
   * {
   *   hasSubscription: boolean,
   *   subscription?: {
   *     id: string,
   *     status: 'active' | 'trialing' | 'canceled' | 'past_due' | 'paused',
   *     plan: 'pro' | 'community',
   *     billingCycle: 'monthly' | 'yearly',
   *     currentPeriodEnd: string,
   *     canceledAt?: string,
   *     trialEnd?: string
   *   },
   *   source: 'paddle' | 'local',
   *   requiresSync?: boolean,
   *   customerPortalUrl?: string
   * }
   */
  @Get('status')
  @UseGuards(JwtAuthGuard)
  async getStatus(@Req() req: Request): Promise<SubscriptionStatusResponseDto> {
    const user = req.user as { id: string; email: string };
    return this.subscriptionService.getStatus(user.id);
  }

  /**
   * Validate if user can checkout (prevent duplicate subscriptions)
   *
   * POST /api/v1/subscriptions/validate-checkout
   *
   * Must be called before opening Paddle overlay.
   * Returns canCheckout=false if user has an existing active subscription.
   *
   * @param req - Express request with authenticated user
   * @param dto - ValidateCheckoutDto containing priceId
   * @returns Validation result with reason if blocked
   *
   * Response:
   * {
   *   canCheckout: boolean,
   *   reason?: 'existing_subscription' | 'subscription_ending_soon' | 'none',
   *   existingPlan?: string,
   *   currentPeriodEnd?: string,
   *   customerPortalUrl?: string,
   *   message?: string
   * }
   */
  @Post('validate-checkout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async validateCheckout(
    @Req() req: Request,
    @Body() dto: ValidateCheckoutDto
  ): Promise<ValidateCheckoutResponseDto> {
    const user = req.user as { id: string; email: string };
    return this.subscriptionService.validateCheckout(user.id, dto.priceId);
  }

  /**
   * User-initiated sync with Paddle
   *
   * POST /api/v1/subscriptions/reconcile
   *
   * Updates local database records to match Paddle state.
   * Use when user sees stale data or after subscription changes.
   *
   * @param req - Express request with authenticated user
   * @returns Summary of changes made during reconciliation
   *
   * Response:
   * {
   *   success: boolean,
   *   changes: {
   *     subscriptionUpdated: boolean,
   *     licenseUpdated: boolean,
   *     statusBefore: string,
   *     statusAfter: string,
   *     planBefore?: string,
   *     planAfter?: string
   *   },
   *   errors?: string[],
   *   paddleSubscription?: {
   *     id: string,
   *     status: string,
   *     plan: string,
   *     currentPeriodEnd: string
   *   }
   * }
   */
  @Post('reconcile')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async reconcile(@Req() req: Request): Promise<ReconcileResponseDto> {
    const user = req.user as { id: string; email: string };
    return this.subscriptionService.reconcile(user.id, user.email);
  }

  /**
   * Generate Paddle customer portal URL
   *
   * POST /api/v1/subscriptions/portal-session
   *
   * Creates a Paddle customer portal session.
   * URL is valid for 60 minutes.
   *
   * @param req - Express request with authenticated user
   * @returns Portal URL or error
   *
   * Response (success):
   * {
   *   url: string,
   *   expiresAt: string
   * }
   *
   * Response (error):
   * {
   *   error: 'no_customer_record' | 'paddle_api_error',
   *   message: string
   * }
   */
  @Post('portal-session')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async createPortalSession(
    @Req() req: Request
  ): Promise<PortalSessionResponseDto | PortalSessionErrorDto> {
    const user = req.user as { id: string; email: string };
    return this.subscriptionService.createPortalSession(user.id);
  }

  /**
   * Get checkout info including Paddle customer ID if exists
   *
   * GET /api/v1/subscriptions/checkout-info
   *
   * Returns the user's Paddle customer ID if they have one, so the checkout
   * can reuse the same customer. This prevents creating duplicate customers
   * when a user re-subscribes after cancellation.
   *
   * @param req - Express request with authenticated user
   * @returns Checkout info with optional customerId
   *
   * Response:
   * {
   *   email: string,
   *   paddleCustomerId?: string
   * }
   */
  @Get('checkout-info')
  @UseGuards(JwtAuthGuard)
  async getCheckoutInfo(
    @Req() req: Request
  ): Promise<{ email: string; paddleCustomerId?: string }> {
    const user = req.user as { id: string; email: string };
    return this.subscriptionService.getCheckoutInfo(user.id);
  }
}
