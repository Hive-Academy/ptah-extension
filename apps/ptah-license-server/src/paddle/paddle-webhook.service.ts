import {
  Injectable,
  Inject,
  Logger,
  UnauthorizedException,
  InternalServerErrorException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventName,
  type EventEntity,
  type SubscriptionCreatedEvent,
  type SubscriptionActivatedEvent,
  type SubscriptionUpdatedEvent,
  type SubscriptionCanceledEvent,
  type SubscriptionPastDueEvent,
  type SubscriptionPausedEvent,
  type SubscriptionResumedEvent,
  type TransactionCompletedEvent,
  type SubscriptionNotification,
  type SubscriptionCreatedNotification,
  type TransactionNotification,
} from '@paddle/paddle-node-sdk';
import { PrismaService } from '../prisma/prisma.service';
import { PaddleService } from './paddle.service';
import { PADDLE_CLIENT, PaddleClient } from './providers/paddle.provider';
import { mapEventToStoredPayload } from './dto/paddle-webhook.dto';

/**
 * Webhook processing response type
 */
export interface WebhookResponse {
  received: boolean;
  success?: boolean;
  duplicate?: boolean;
  skipped?: boolean;
  error?: string;
  licenseId?: string;
}

/**
 * PaddleWebhookService - Webhook processing with Paddle SDK type safety
 *
 * This service:
 * - Uses Webhooks.unmarshal() for signature verification AND parsing (returns typed EventEntity)
 * - Routes events by event.eventType using EventName enum
 * - Resolves customer email for subscription events
 * - Stores failed webhooks for recovery
 * - Delegates business logic to PaddleService handlers with properly typed events
 *
 * Benefits over manual verification:
 * - Single SDK call handles signature + timestamp verification + JSON parsing
 * - Returns fully typed EventEntity - no Record<string, unknown>
 * - SDK maintains Paddle API compatibility automatically
 * - Less error-prone than manual HMAC implementation
 */
@Injectable()
export class PaddleWebhookService {
  private readonly logger = new Logger(PaddleWebhookService.name);

  /**
   * In-memory set of processed webhook event IDs for idempotency.
   * Prevents duplicate processing when Paddle retries delivery.
   * Acceptable for single-instance deployment; for multi-instance,
   * migrate to a database-backed check.
   */
  private readonly processedEventIds = new Set<string>();
  private readonly MAX_PROCESSED_EVENTS = 10000;

  constructor(
    private readonly paddleService: PaddleService,
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    @Inject(PADDLE_CLIENT)
    private readonly paddle: PaddleClient
  ) {
    this.logger.log('PaddleWebhookService initialized');
  }

  /**
   * Process incoming Paddle webhook with SDK-based verification
   *
   * The SDK's webhooks.unmarshal() method:
   * 1. Verifies the HMAC signature using the secret key
   * 2. Validates the timestamp is within acceptable window (replay protection)
   * 3. Parses the JSON payload into a typed EventEntity
   *
   * @param rawBody - Raw request body as Buffer (required for signature verification)
   * @param signature - The paddle-signature header value
   * @returns Webhook processing result
   * @throws UnauthorizedException if signature verification fails
   */
  async processWebhook(
    rawBody: Buffer,
    signature: string
  ): Promise<WebhookResponse> {
    const secretKey = this.configService.get<string>('PADDLE_WEBHOOK_SECRET');

    if (!secretKey) {
      this.logger.error('PADDLE_WEBHOOK_SECRET not configured');
      throw new UnauthorizedException(
        'Webhook secret not configured - cannot verify signature'
      );
    }

    // SDK handles signature verification + timestamp validation + parsing
    // Returns typed EventEntity or throws if verification fails
    let event: EventEntity;
    try {
      event = await this.paddle.webhooks.unmarshal(
        rawBody.toString(),
        secretKey,
        signature
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Unknown error';
      this.logger.warn(`Webhook verification failed: ${errorMessage}`);
      throw new UnauthorizedException(
        `Invalid webhook signature: ${errorMessage}`
      );
    }

    this.logger.log(`Received webhook: ${event.eventType} (${event.eventId})`);

    // Idempotency check: skip events that have already been processed
    if (this.isEventAlreadyProcessed(event.eventId)) {
      this.logger.log(
        `Duplicate webhook detected: ${event.eventId} (${event.eventType}) - skipping`
      );
      return { received: true, duplicate: true };
    }

    // Wrap processing in try/catch for failed webhook storage
    // Return 500 on failure so Paddle retries the webhook delivery
    try {
      const result = await this.routeEvent(event);

      // Mark as processed ONLY after successful processing.
      // If processing fails, Paddle will retry and the event won't be rejected as duplicate.
      this.markEventAsProcessed(event.eventId);

      return result;
    } catch (error) {
      await this.storeFailedWebhook(event, error);

      this.logger.error(
        `Webhook processing failed for ${event.eventType} (${event.eventId}) - stored for recovery`
      );

      // Throw 500 so Paddle knows delivery failed and will retry
      throw new InternalServerErrorException(
        'Webhook processing failed - stored for recovery'
      );
    }
  }

  /**
   * Route event to appropriate handler based on eventType
   *
   * Uses EventName enum for type-safe event routing.
   * TypeScript narrows the event type in each case branch.
   *
   * @param event - Typed EventEntity from SDK unmarshal
   * @returns Processing result
   */
  private async routeEvent(event: EventEntity): Promise<WebhookResponse> {
    switch (event.eventType) {
      // Subscription lifecycle events
      case EventName.SubscriptionCreated:
        return this.handleSubscriptionCreated(
          event as SubscriptionCreatedEvent
        );

      case EventName.SubscriptionActivated:
        return this.handleSubscriptionActivated(
          event as SubscriptionActivatedEvent
        );

      case EventName.SubscriptionUpdated:
        return this.handleSubscriptionUpdated(
          event as SubscriptionUpdatedEvent
        );

      case EventName.SubscriptionCanceled:
        return this.handleSubscriptionCanceled(
          event as SubscriptionCanceledEvent
        );

      case EventName.SubscriptionPastDue:
        return this.handleSubscriptionPastDue(
          event as SubscriptionPastDueEvent
        );

      case EventName.SubscriptionPaused:
        return this.handleSubscriptionPaused(event as SubscriptionPausedEvent);

      case EventName.SubscriptionResumed:
        return this.handleSubscriptionResumed(
          event as SubscriptionResumedEvent
        );

      // Transaction events
      case EventName.TransactionCompleted:
        return this.handleTransactionCompleted(
          event as TransactionCompletedEvent
        );

      default:
        // Acknowledge unknown events without processing
        this.logger.log(`Ignoring unhandled event type: ${event.eventType}`);
        return { received: true };
    }
  }

  /**
   * Handle subscription.created event
   *
   * Resolves customer email from Paddle API and delegates to PaddleService.
   */
  private async handleSubscriptionCreated(
    event: SubscriptionCreatedEvent
  ): Promise<WebhookResponse> {
    const data = event.data;
    const email = await this.resolveCustomerEmail(data);

    if (!email) {
      throw new Error(
        `Could not resolve customer email for subscription ${data.id}`
      );
    }

    const result = await this.paddleService.handleSubscriptionCreatedEvent(
      data,
      email,
      event.eventId
    );
    return { received: true, ...result };
  }

  /**
   * Handle subscription.activated event
   *
   * Fires when subscription becomes fully active (payment confirmed).
   * For trials, this fires when trial ends and first payment succeeds.
   */
  private async handleSubscriptionActivated(
    event: SubscriptionActivatedEvent
  ): Promise<WebhookResponse> {
    const data = event.data;
    const email = await this.resolveCustomerEmail(data);

    if (!email) {
      throw new Error(
        `Could not resolve customer email for subscription ${data.id}`
      );
    }

    const result = await this.paddleService.handleSubscriptionActivatedEvent(
      data,
      email,
      event.eventId
    );
    return { received: true, ...result };
  }

  /**
   * Handle subscription.updated event
   *
   * Updates license plan and expiration based on subscription changes.
   */
  private async handleSubscriptionUpdated(
    event: SubscriptionUpdatedEvent
  ): Promise<WebhookResponse> {
    const data = event.data;
    const email = await this.resolveCustomerEmail(data);

    if (!email) {
      throw new Error(
        `Could not resolve customer email for subscription ${data.id}`
      );
    }

    const result = await this.paddleService.handleSubscriptionUpdatedEvent(
      data,
      email,
      event.eventId
    );
    return { received: true, ...result };
  }

  /**
   * Handle subscription.canceled event
   *
   * Sets license expiration to end of current billing period.
   */
  private async handleSubscriptionCanceled(
    event: SubscriptionCanceledEvent
  ): Promise<WebhookResponse> {
    const data = event.data;
    const email = await this.resolveCustomerEmail(data);

    if (!email) {
      throw new Error(
        `Could not resolve customer email for subscription ${data.id}`
      );
    }

    const result = await this.paddleService.handleSubscriptionCanceledEvent(
      data,
      email,
      event.eventId
    );
    return { received: true, ...result };
  }

  /**
   * Handle subscription.past_due event
   *
   * Payment failed but subscription not yet canceled (dunning period).
   */
  private async handleSubscriptionPastDue(
    event: SubscriptionPastDueEvent
  ): Promise<WebhookResponse> {
    const data = event.data;
    const email = await this.resolveCustomerEmail(data);

    if (!email) {
      throw new Error(
        `Could not resolve customer email for subscription ${data.id}`
      );
    }

    const result = await this.paddleService.handleSubscriptionPastDueEvent(
      data,
      email,
      event.eventId
    );
    return { received: true, ...result };
  }

  /**
   * Handle subscription.paused event
   *
   * User has paused their subscription - lose access to premium features.
   */
  private async handleSubscriptionPaused(
    event: SubscriptionPausedEvent
  ): Promise<WebhookResponse> {
    const data = event.data;
    const email = await this.resolveCustomerEmail(data);

    if (!email) {
      throw new Error(
        `Could not resolve customer email for subscription ${data.id}`
      );
    }

    const result = await this.paddleService.handleSubscriptionPausedEvent(
      data,
      email,
      event.eventId
    );
    return { received: true, ...result };
  }

  /**
   * Handle subscription.resumed event
   *
   * User has resumed their paused subscription - regain access.
   */
  private async handleSubscriptionResumed(
    event: SubscriptionResumedEvent
  ): Promise<WebhookResponse> {
    const data = event.data;
    const email = await this.resolveCustomerEmail(data);

    if (!email) {
      throw new Error(
        `Could not resolve customer email for subscription ${data.id}`
      );
    }

    const result = await this.paddleService.handleSubscriptionResumedEvent(
      data,
      email,
      event.eventId
    );
    return { received: true, ...result };
  }

  /**
   * Handle transaction.completed event
   *
   * Fires on successful payment - extends license for subscription renewals.
   */
  private async handleTransactionCompleted(
    event: TransactionCompletedEvent
  ): Promise<WebhookResponse> {
    const data = event.data;

    const result = await this.paddleService.handleTransactionCompletedEvent(
      data,
      event.eventId
    );
    return { received: true, ...result };
  }

  /**
   * Resolve customer email from subscription notification data
   *
   * Paddle webhooks include customerId but not email directly.
   * This method fetches the customer email from Paddle API.
   *
   * @param data - Subscription notification data from SDK
   * @returns Customer email address or null if not found
   */
  private async resolveCustomerEmail(
    data: SubscriptionNotification | SubscriptionCreatedNotification
  ): Promise<string | null> {
    const customerId = data.customerId;

    if (!customerId) {
      this.logger.warn('No customerId in subscription data');
      return null;
    }

    return this.paddleService.getCustomerEmail(customerId);
  }

  /**
   * Check if a webhook event has already been processed (idempotency guard).
   *
   * This method ONLY checks membership -- it does NOT add the event ID.
   * Use markEventAsProcessed() after successful processing.
   *
   * @param eventId - The Paddle event ID to check
   * @returns true if event was already processed, false if it is new
   */
  private isEventAlreadyProcessed(eventId: string): boolean {
    return this.processedEventIds.has(eventId);
  }

  /**
   * Mark a webhook event as successfully processed.
   *
   * Called ONLY after routeEvent() succeeds, so that failed events
   * are NOT marked and can be retried by Paddle.
   *
   * Uses an in-memory Set with a size cap. When the cap is reached,
   * the oldest half of entries are evicted (Set maintains insertion order).
   *
   * @param eventId - The Paddle event ID to mark as processed
   */
  private markEventAsProcessed(eventId: string): void {
    if (this.processedEventIds.size >= this.MAX_PROCESSED_EVENTS) {
      const iterator = this.processedEventIds.values();
      const entriesToRemove = Math.floor(this.MAX_PROCESSED_EVENTS / 2);
      for (let i = 0; i < entriesToRemove; i++) {
        const next = iterator.next();
        if (next.done) break;
        this.processedEventIds.delete(next.value);
      }
    }
    this.processedEventIds.add(eventId);
  }

  /**
   * Store failed webhook for later recovery and investigation
   *
   * Stores failed webhooks to FailedWebhook table for:
   * - Manual investigation
   * - Retry via scheduled job
   * - Debugging and monitoring
   *
   * This method never throws - errors are logged but swallowed
   * to prevent cascading failures.
   *
   * @param event - The EventEntity that failed to process
   * @param error - The error that caused the failure
   */
  private async storeFailedWebhook(
    event: EventEntity,
    error: unknown
  ): Promise<void> {
    try {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const stackTrace = error instanceof Error ? error.stack : undefined;

      await this.prisma.failedWebhook.create({
        data: {
          eventId: event.eventId,
          eventType: event.eventType,
          rawPayload: mapEventToStoredPayload(event),
          errorMessage,
          stackTrace,
        },
      });

      this.logger.log(
        `Stored failed webhook: ${event.eventId} (${event.eventType}) - ${errorMessage}`
      );
    } catch (storeError) {
      // Log but don't throw - we don't want storage failure to affect response
      this.logger.error(
        `Failed to store failed webhook ${event.eventId}:`,
        storeError instanceof Error ? storeError.message : 'Unknown error'
      );
    }
  }
}
