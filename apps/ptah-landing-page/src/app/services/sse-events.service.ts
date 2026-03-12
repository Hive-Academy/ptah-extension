import { inject, Injectable, OnDestroy, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, Subject, filter, firstValueFrom } from 'rxjs';
import { environment } from '../../environments/environment';

/**
 * SSE Event types received from the backend
 *
 * These types mirror the backend events.types.ts definitions.
 * @see apps/ptah-license-server/src/events/events.types.ts
 */
export interface SSEBaseEvent {
  type: string;
  timestamp: string;
}

export interface LicenseUpdatedEvent extends SSEBaseEvent {
  type: 'license.updated';
  data: {
    email: string;
    plan: string;
    status: 'active' | 'expired' | 'revoked' | 'trialing';
    expiresAt: string | null;
    // NOTE: licenseKey is intentionally NOT included for security
    // License keys are sent via email only
  };
}

export interface SubscriptionStatusEvent extends SSEBaseEvent {
  type: 'subscription.status_changed';
  data: {
    email: string;
    status: 'trialing' | 'active' | 'past_due' | 'paused' | 'canceled';
    plan: string;
  };
}

export interface ConnectionEvent extends SSEBaseEvent {
  type: 'connected';
  data: {
    message: string;
  };
}

export interface HeartbeatEvent extends SSEBaseEvent {
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
 * @see apps/ptah-license-server/src/events/events.types.ts
 */
export interface ReconciliationCompletedEvent extends SSEBaseEvent {
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

export type SSEEvent =
  | LicenseUpdatedEvent
  | SubscriptionStatusEvent
  | ConnectionEvent
  | HeartbeatEvent
  | ReconciliationCompletedEvent;

/**
 * SSE connection state
 */
export type ConnectionState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'error';

/**
 * SSEEventsService - Real-time updates from backend via Server-Sent Events
 *
 * Usage:
 * 1. Call connect() after successful authentication
 * 2. Subscribe to specific event streams (licenseUpdated$, subscriptionStatus$)
 * 3. Call disconnect() on logout or component destroy
 *
 * Authentication Flow:
 * 1. Service requests a ticket from POST /auth/stream/ticket (requires JWT cookie)
 * 2. Service opens SSE connection with ticket in query string
 * 3. Server validates ticket, extracts user email, establishes connection
 *
 * Events:
 * - license.updated: License created or modified (plan, status, expiration)
 * - subscription.status_changed: Subscription status change (active, canceled, etc.)
 * - connected: Initial connection established
 * - heartbeat: Keep-alive signal every 30 seconds
 *
 * Auto-reconnection:
 * - Browser's EventSource automatically reconnects on connection loss
 * - Service refreshes ticket before each reconnection attempt
 * - Service emits connection state changes via connectionState signal
 *
 * Security:
 * - Uses ticket-based authentication (30-second expiry, single-use)
 * - Tickets are obtained via authenticated endpoint
 * - No sensitive data (like license keys) is transmitted via SSE
 */
@Injectable({ providedIn: 'root' })
export class SSEEventsService implements OnDestroy {
  private readonly http = inject(HttpClient);

  private eventSource: EventSource | null = null;
  private readonly eventSubject = new Subject<SSEEvent>();
  private readonly sseBaseUrl = '/api/v1/events';
  private readonly authBaseUrl = '/api/auth';

  /** Current connection state as a signal for reactive UI updates */
  public readonly connectionState = signal<ConnectionState>('disconnected');

  /** Error message if connection failed */
  public readonly errorMessage = signal<string | null>(null);

  /**
   * All events stream - use for debugging or custom event handling
   */
  public readonly events$ = this.eventSubject.asObservable();

  /**
   * License updated events - emitted when license status/plan/expiration changes
   */
  public readonly licenseUpdated$: Observable<LicenseUpdatedEvent> =
    this.events$.pipe(
      filter((e): e is LicenseUpdatedEvent => e.type === 'license.updated')
    );

  /**
   * Subscription status events - emitted when subscription status changes
   */
  public readonly subscriptionStatus$: Observable<SubscriptionStatusEvent> =
    this.events$.pipe(
      filter(
        (e): e is SubscriptionStatusEvent =>
          e.type === 'subscription.status_changed'
      )
    );

  /**
   * Connection events - emitted when SSE connection is established
   */
  public readonly connected$: Observable<ConnectionEvent> = this.events$.pipe(
    filter((e): e is ConnectionEvent => e.type === 'connected')
  );

  /**
   * Heartbeat events - emitted every 30 seconds when connected
   */
  public readonly heartbeat$: Observable<HeartbeatEvent> = this.events$.pipe(
    filter((e): e is HeartbeatEvent => e.type === 'heartbeat')
  );

  /**
   * Reconciliation completed events - emitted when user syncs with Paddle
   */
  public readonly reconciliationCompleted$: Observable<ReconciliationCompletedEvent> =
    this.events$.pipe(
      filter(
        (e): e is ReconciliationCompletedEvent =>
          e.type === 'reconciliation.completed'
      )
    );

  public ngOnDestroy(): void {
    this.disconnect();
  }

  /**
   * Connect to SSE endpoint for real-time updates
   *
   * Call this after successful authentication. The service will:
   * 1. Request a ticket from the auth endpoint
   * 2. Open SSE connection with the ticket
   * 3. Auto-reconnect on connection loss
   */
  public async connect(): Promise<void> {
    if (this.eventSource) {
      // Already connected or connecting
      if (this.connectionState() === 'connected') {
        return;
      }
      // If in error state, disconnect and try again
      this.disconnect();
    }

    this.connectionState.set('connecting');
    this.errorMessage.set(null);

    try {
      // Step 1: Get authentication ticket
      const ticket = await this.getTicket();

      // Step 2: Open SSE connection with ticket
      // EventSource bypasses HttpClient interceptors, so we must prepend apiBaseUrl manually
      const url = `${environment.apiBaseUrl}${
        this.sseBaseUrl
      }/subscribe?ticket=${encodeURIComponent(ticket)}`;
      this.eventSource = new EventSource(url, { withCredentials: true });

      this.eventSource.onopen = () => {
        this.connectionState.set('connected');
        this.errorMessage.set(null);
        this.reconnectAttempts = 0;
        console.log('[SSE] Connection established');
      };

      // Listen for all event types
      this.setupEventListeners();

      this.eventSource.onerror = (error) => {
        console.error('[SSE] Connection error:', error);

        if (this.eventSource?.readyState === EventSource.CLOSED) {
          this.connectionState.set('disconnected');
          // EventSource is closed, try to reconnect with new ticket
          this.scheduleReconnect();
        } else {
          // EventSource is reconnecting
          this.connectionState.set('connecting');
        }
      };
    } catch (error) {
      console.error('[SSE] Failed to establish connection:', error);
      this.connectionState.set('error');
      this.errorMessage.set(
        error instanceof Error ? error.message : 'Failed to connect'
      );
    }
  }

  /**
   * Disconnect from SSE endpoint
   *
   * Call this on logout or when the component using SSE is destroyed.
   */
  public disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.connectionState.set('disconnected');
    this.errorMessage.set(null);
    console.log('[SSE] Disconnected');
  }

  /**
   * Check if currently connected
   */
  public isConnected(): boolean {
    return this.connectionState() === 'connected';
  }

  /**
   * Get a short-lived ticket for SSE authentication
   *
   * @throws Error if ticket request fails (user not authenticated)
   */
  private async getTicket(): Promise<string> {
    try {
      const response = await firstValueFrom(
        this.http.post<{ ticket: string }>(
          `${this.authBaseUrl}/stream/ticket`,
          {}
        )
      );
      return response.ticket;
    } catch (error) {
      console.error('[SSE] Failed to get ticket:', error);
      throw new Error('Authentication required. Please log in first.');
    }
  }

  private reconnectAttempts = 0;
  private readonly MAX_RECONNECT_ATTEMPTS = 10;
  private readonly BASE_RECONNECT_DELAY_MS = 3000;
  private readonly MAX_RECONNECT_DELAY_MS = 60000;

  /**
   * Schedule a reconnection attempt with a new ticket.
   * Uses exponential backoff (3s, 6s, 12s, ... up to 60s) with a max retry limit.
   */
  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.warn(
        `[SSE] Max reconnect attempts (${this.MAX_RECONNECT_ATTEMPTS}) reached. Giving up.`
      );
      this.connectionState.set('error');
      this.errorMessage.set(
        'Unable to establish real-time connection. Please refresh the page.'
      );
      return;
    }

    const delay = Math.min(
      this.BASE_RECONNECT_DELAY_MS * Math.pow(2, this.reconnectAttempts),
      this.MAX_RECONNECT_DELAY_MS
    );
    this.reconnectAttempts++;

    setTimeout(() => {
      const state = this.connectionState();
      if (state === 'disconnected' || state === 'error') {
        console.log(
          `[SSE] Reconnect attempt ${this.reconnectAttempts}/${this.MAX_RECONNECT_ATTEMPTS} (delay: ${delay}ms)...`
        );
        this.connect();
      }
    }, delay);
  }

  /**
   * Setup listeners for all event types
   */
  private setupEventListeners(): void {
    if (!this.eventSource) return;

    // Generic message handler for events sent without event type
    this.eventSource.onmessage = (event) => {
      this.handleEventData(event.data);
    };

    // Specific event type handlers
    const eventTypes = [
      'connected',
      'heartbeat',
      'license.updated',
      'subscription.status_changed',
      'reconciliation.completed',
    ];

    eventTypes.forEach((eventType) => {
      this.eventSource?.addEventListener(eventType, (event: Event) => {
        const messageEvent = event as MessageEvent;
        this.handleEventData(messageEvent.data);
      });
    });
  }

  /**
   * Parse and emit event data
   */
  private handleEventData(data: string): void {
    try {
      const parsed = JSON.parse(data) as SSEEvent;

      // Log for debugging (except heartbeats to reduce noise)
      if (parsed.type !== 'heartbeat') {
        console.log('[SSE] Event received:', parsed.type, parsed);
      }

      this.eventSubject.next(parsed);
    } catch (error) {
      console.error('[SSE] Failed to parse event data:', error, data);
    }
  }
}
