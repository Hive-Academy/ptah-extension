import { Injectable, Logger } from '@nestjs/common';
import { Subject, Observable, filter, map } from 'rxjs';
import {
  SSEEvent,
  LicenseUpdatedEvent,
  SubscriptionStatusEvent,
  ReconciliationCompletedEvent,
} from './events.types';

/**
 * Internal event wrapper that includes target email for filtering
 */
interface InternalEvent {
  targetEmail: string;
  event: SSEEvent;
}

/**
 * EventsService - Manages SSE event broadcasting for real-time updates
 *
 * This service provides:
 * - Event emission when license/subscription changes occur
 * - Per-user event streams filtered by email
 * - Heartbeat mechanism to keep connections alive
 *
 * Usage in other services:
 * ```typescript
 * this.eventsService.emitLicenseUpdated({
 *   email: 'user@example.com',
 *   plan: 'pro',
 *   status: 'active',
 *   expiresAt: '2026-02-26T00:00:00Z',
 * });
 * ```
 */
@Injectable()
export class EventsService {
  private readonly logger = new Logger(EventsService.name);
  private readonly eventSubject = new Subject<InternalEvent>();

  // Track connected clients for logging/monitoring
  private connectedClients = new Map<string, number>();

  constructor() {
    this.logger.log('EventsService initialized');
  }

  /**
   * Get an observable stream of events for a specific user
   *
   * @param email - User's email to filter events for
   * @returns Observable stream of SSE events for this user
   */
  getEventStream(email: string): Observable<MessageEvent<string>> {
    this.trackClientConnection(email);

    return this.eventSubject.pipe(
      // Filter events for this specific user
      filter((internal) => internal.targetEmail === email),
      // Transform to SSE MessageEvent format
      map((internal) => {
        const eventData = JSON.stringify(internal.event);
        return {
          data: eventData,
          type: internal.event.type,
        } as MessageEvent<string>;
      })
    );
  }

  /**
   * Track client connection for monitoring
   */
  private trackClientConnection(email: string): void {
    const count = this.connectedClients.get(email) || 0;
    this.connectedClients.set(email, count + 1);
    this.logger.log(
      `Client connected: ${email} (${count + 1} active connections)`
    );
  }

  /**
   * Track client disconnection
   */
  trackClientDisconnection(email: string): void {
    const count = this.connectedClients.get(email) || 1;
    if (count <= 1) {
      this.connectedClients.delete(email);
    } else {
      this.connectedClients.set(email, count - 1);
    }
    this.logger.log(
      `Client disconnected: ${email} (${Math.max(
        0,
        count - 1
      )} active connections)`
    );
  }

  /**
   * Emit a license updated event
   *
   * Called when:
   * - New license is created (subscription.created)
   * - License plan changes (subscription.updated)
   * - License status changes (activated, canceled, etc.)
   */
  emitLicenseUpdated(data: LicenseUpdatedEvent['data']): void {
    const event: LicenseUpdatedEvent = {
      type: 'license.updated',
      timestamp: new Date().toISOString(),
      data,
    };

    this.emit(data.email, event);
    this.logger.log(
      `Emitted license.updated for ${data.email}: ${data.status} (${data.plan})`
    );
  }

  /**
   * Emit a subscription status changed event
   *
   * Called when subscription status changes (trialing -> active, etc.)
   */
  emitSubscriptionStatus(data: SubscriptionStatusEvent['data']): void {
    const event: SubscriptionStatusEvent = {
      type: 'subscription.status_changed',
      timestamp: new Date().toISOString(),
      data,
    };

    this.emit(data.email, event);
    this.logger.log(
      `Emitted subscription.status_changed for ${data.email}: ${data.status}`
    );
  }

  /**
   * Emit a heartbeat to a specific user (keep connection alive)
   */
  emitHeartbeat(email: string): void {
    this.emit(email, {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      data: {
        serverTime: new Date().toISOString(),
      },
    });
  }

  /**
   * Emit a reconciliation completed event
   *
   * Called when a user-initiated sync with Paddle completes.
   * This allows the frontend to refresh license/subscription data
   * after reconciliation finishes.
   */
  emitReconciliationCompleted(
    data: ReconciliationCompletedEvent['data']
  ): void {
    const event: ReconciliationCompletedEvent = {
      type: 'reconciliation.completed',
      timestamp: new Date().toISOString(),
      data,
    };

    this.emit(data.email, event);
    this.logger.log(
      `Emitted reconciliation.completed for ${data.email}: success=${data.success}, subscriptionUpdated=${data.changes.subscriptionUpdated}, licenseUpdated=${data.changes.licenseUpdated}`
    );
  }

  /**
   * Internal emit method
   */
  private emit(targetEmail: string, event: SSEEvent): void {
    this.eventSubject.next({
      targetEmail: targetEmail.toLowerCase(),
      event,
    });
  }

  /**
   * Get count of connected clients (for monitoring)
   */
  getConnectedClientCount(): number {
    let total = 0;
    this.connectedClients.forEach((count) => (total += count));
    return total;
  }
}
