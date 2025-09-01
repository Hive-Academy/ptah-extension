/**
 * Type-Safe RxJS Event Bus Implementation
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN lines 214-293
 * Integrates with existing MessagePayloadMap from @ptah-extension/shared
 * Provides Angular-compatible reactive patterns using RxJS observables
 */

import { EventEmitter } from 'eventemitter3';
import { injectable } from 'tsyringe';
import { Observable, fromEvent, filter, timeout, take } from 'rxjs';
import { MessagePayloadMap, CorrelationId } from '@ptah-extension/shared';

/**
 * Typed event structure that extends the existing message system
 * Provides correlation tracking and source identification for debugging
 */
export interface TypedEvent<T extends keyof MessagePayloadMap = keyof MessagePayloadMap> {
  readonly type: T;
  readonly payload: MessagePayloadMap[T];
  readonly correlationId: CorrelationId;
  readonly source: 'extension' | 'webview' | 'provider';
  readonly timestamp: number;
}

/**
 * Request-response event structure for async communication patterns
 */
export interface RequestEvent<T extends keyof MessagePayloadMap = keyof MessagePayloadMap>
  extends TypedEvent<T> {
  readonly responseTimeout?: number;
}

/**
 * Response event structure for completing request-response cycles
 */
export interface ResponseEvent<T = unknown> {
  readonly correlationId: CorrelationId;
  readonly success: boolean;
  readonly data?: T;
  readonly error?: {
    readonly code: string;
    readonly message: string;
    readonly context?: Record<string, unknown>;
  };
  readonly timestamp: number;
}

/**
 * RxJS-based Event Bus with full type safety
 * Injectable service that provides pub/sub messaging with Angular compatibility
 */
@injectable()
export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly activeRequests = new Map<CorrelationId, {
    readonly timeout: NodeJS.Timeout;
    readonly timestamp: number;
  }>();

  /**
   * Publish a type-safe event using existing MessagePayloadMap types
   * Automatically generates correlation ID and timestamp
   *
   * @param type - Message type from StrictMessageType union
   * @param payload - Type-safe payload matching the message type
   * @param source - Event source identifier for debugging
   */
  publish<T extends keyof MessagePayloadMap>(
    type: T,
    payload: MessagePayloadMap[T],
    source: TypedEvent['source'] = 'extension'
  ): void {
    const correlationId = this.generateCorrelationId();

    const event: TypedEvent<T> = {
      type,
      payload,
      source,
      timestamp: Date.now(),
      correlationId
    };

    this.emitter.emit(type as string, event);

    // Emit generic event for wildcard subscriptions
    this.emitter.emit('*', event);
  }

  /**
   * Subscribe to events of a specific type with RxJS observables
   * Returns an Observable that emits type-safe events
   *
   * @param messageType - The message type to subscribe to
   * @returns Observable stream of typed events
   */
  subscribe<T extends keyof MessagePayloadMap>(
    messageType: T
  ): Observable<TypedEvent<T>> {
    return fromEvent<TypedEvent<T>>(this.emitter, messageType as string);
  }

  /**
   * Subscribe to all events (wildcard subscription)
   * Useful for logging and debugging scenarios
   *
   * @returns Observable stream of all events
   */
  subscribeToAll(): Observable<TypedEvent> {
    return fromEvent<TypedEvent>(this.emitter, '*');
  }

  /**
   * Request-response pattern with automatic timeout handling
   * Sends a request and waits for a correlated response
   *
   * @param type - Request message type
   * @param payload - Request payload
   * @param timeoutMs - Timeout in milliseconds (default: 5000)
   * @returns Promise that resolves with the response data
   */
  async request<T extends keyof MessagePayloadMap, R = unknown>(
    type: T,
    payload: MessagePayloadMap[T],
    timeoutMs = 5000
  ): Promise<R> {
    const correlationId = this.generateCorrelationId();
    const responseType = `${type}:response` as const;

    return new Promise<R>((resolve, reject) => {
      // Set up timeout handling
      const timeoutHandle = setTimeout(() => {
        this.activeRequests.delete(correlationId);
        reject(new Error(`Request timeout after ${timeoutMs}ms: ${type}`));
      }, timeoutMs);

      // Track active request
      this.activeRequests.set(correlationId, {
        timeout: timeoutHandle,
        timestamp: Date.now()
      });

      // Set up response listener
      fromEvent<ResponseEvent<R>>(this.emitter, responseType)
        .pipe(
          filter(response => response.correlationId === correlationId),
          take(1),
          timeout(timeoutMs)
        )
        .subscribe({
          next: (response) => {
            this.cleanupRequest(correlationId);

            if (response.success) {
              resolve(response.data as R);
            } else {
              reject(new Error(response.error?.message || 'Request failed'));
            }
          },
          error: (error) => {
            this.cleanupRequest(correlationId);
            reject(error);
          }
        });

      // Send the request
      const requestEvent: RequestEvent<T> = {
        type,
        payload,
        correlationId,
        source: 'extension',
        timestamp: Date.now(),
        responseTimeout: timeoutMs
      };

      this.emitter.emit(type as string, requestEvent);
    });
  }

  /**
   * Send a response for a request-response cycle
   * Matches responses to requests using correlation IDs
   *
   * @param originalRequest - The original request event
   * @param data - Response data
   * @param error - Optional error information
   */
  respond<T extends keyof MessagePayloadMap, R = unknown>(
    originalRequest: RequestEvent<T>,
    data?: R,
    error?: ResponseEvent<R>['error']
  ): void {
    const responseType = `${originalRequest.type}:response` as const;

    const response: ResponseEvent<R> = {
      correlationId: originalRequest.correlationId,
      success: !error,
      data,
      error,
      timestamp: Date.now()
    };

    this.emitter.emit(responseType, response);
  }

  /**
   * Get metrics about active requests and event subscriptions
   * Useful for monitoring and debugging
   */
  getMetrics() {
    const eventNames = this.emitter.eventNames();
    const totalListeners = eventNames.reduce((total, name) => {
      return total + this.emitter.listenerCount(name);
    }, 0);

    return {
      activeRequests: this.activeRequests.size,
      eventListeners: totalListeners,
      eventNames: eventNames,
      oldestRequest: this.getOldestRequestAge()
    };
  }

  /**
   * Clean up resources and clear all subscriptions
   * Should be called when the extension is deactivated
   */
  dispose(): void {
    // Clear all active request timeouts
    this.activeRequests.forEach(({ timeout }) => {
      clearTimeout(timeout);
    });
    this.activeRequests.clear();

    // Remove all event listeners
    this.emitter.removeAllListeners();
  }

  /**
   * Generate a correlation ID for request tracking
   * Uses crypto.randomUUID() for uniqueness
   */
  private generateCorrelationId(): CorrelationId {
    // Use CorrelationId constructor from shared library
    return CorrelationId.create();
  }

  /**
   * Clean up a completed request
   * Removes timeout and tracking information
   */
  private cleanupRequest(correlationId: CorrelationId): void {
    const request = this.activeRequests.get(correlationId);
    if (request) {
      clearTimeout(request.timeout);
      this.activeRequests.delete(correlationId);
    }
  }

  /**
   * Get the age of the oldest active request in milliseconds
   * Useful for monitoring request queue health
   */
  private getOldestRequestAge(): number {
    if (this.activeRequests.size === 0) return 0;

    const now = Date.now();
    let oldest = now;

    this.activeRequests.forEach(({ timestamp }) => {
      oldest = Math.min(oldest, timestamp);
    });

    return now - oldest;
  }
}
