import { Inject, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventsService } from '../../events/events.service';
import {
  SUBSCRIPTION_EVENTS,
  LicenseUpdatedEvent,
  SubscriptionStatusChangedEvent,
  ReconciliationCompletedEvent,
} from './subscription.events';

/**
 * SubscriptionEventListener - Handles subscription events asynchronously
 *
 * Responsibilities:
 * - Listen for subscription events
 * - Forward to SSE service for real-time client updates
 * - Log events for audit trail
 *
 * Benefits:
 * - Decouples subscription logic from notification delivery
 * - SSE failures don't affect main business logic
 * - Easy to add more listeners (email notifications, analytics, etc.)
 */
@Injectable()
export class SubscriptionEventListener {
  private readonly logger = new Logger(SubscriptionEventListener.name);

  constructor(
    @Inject(EventsService) private readonly eventsService: EventsService,
  ) {}

  /**
   * Handle license updated event
   * Forwards to SSE for real-time client notification
   */
  @OnEvent(SUBSCRIPTION_EVENTS.LICENSE_UPDATED)
  handleLicenseUpdated(event: LicenseUpdatedEvent): void {
    this.logger.debug(
      `License updated for ${event.email}: ${event.plan} (${event.status})`,
    );

    try {
      this.eventsService.emitLicenseUpdated({
        email: event.email,
        plan: event.plan,
        status: event.status,
        expiresAt: event.expiresAt,
      });
    } catch (error) {
      // Log but don't throw - SSE failures shouldn't affect business logic
      this.logger.error(
        `Failed to emit SSE for license update: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Handle subscription status changed event
   * Forwards to SSE for real-time client notification
   */
  @OnEvent(SUBSCRIPTION_EVENTS.STATUS_CHANGED)
  handleStatusChanged(event: SubscriptionStatusChangedEvent): void {
    this.logger.debug(
      `Subscription status changed for ${event.email}: ${event.status}`,
    );

    try {
      this.eventsService.emitSubscriptionStatus({
        email: event.email,
        status: event.status,
        plan: event.plan,
      });
    } catch (error) {
      this.logger.error(
        `Failed to emit SSE for status change: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`,
      );
    }
  }

  /**
   * Handle reconciliation completed event
   * Logs for audit trail and emits SSE if changes were made
   */
  @OnEvent(SUBSCRIPTION_EVENTS.RECONCILIATION_COMPLETED)
  handleReconciliationCompleted(event: ReconciliationCompletedEvent): void {
    this.logger.log(
      `Reconciliation completed for user ${event.userId}: ` +
        `subscription=${event.changes.subscriptionUpdated}, ` +
        `license=${event.changes.licenseUpdated}, ` +
        `status: ${event.changes.statusBefore} -> ${event.changes.statusAfter}`,
    );

    // Could add additional notifications here:
    // - Send email notification
    // - Track analytics event
    // - Update external systems
  }
}
