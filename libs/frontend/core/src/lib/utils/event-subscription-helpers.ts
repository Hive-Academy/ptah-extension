/**
 * Event Subscription Helpers
 *
 * **PURPOSE**: Simplify bulk event subscriptions using MESSAGE_REGISTRY.
 * Reduces boilerplate when services need to subscribe to multiple related events.
 *
 * **USAGE**:
 * ```typescript
 * // Instead of 9 individual .onMessageType() calls:
 * subscribeToCategory(
 *   vscodeService,
 *   'CHAT',
 *   (type, payload) => this.handleChatEvent(type, payload),
 *   destroyRef
 * );
 * ```
 *
 * **BENEFITS**:
 * - DRY: One subscription for entire category
 * - Maintainable: Adding new event types doesn't require code changes
 * - Type-safe: Preserves MessagePayloadMap typing
 * - Automatic cleanup: Uses destroyRef for unsubscription
 */

import { DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  MESSAGE_REGISTRY,
  MessageCategory,
  MessagePayloadMap,
  StrictMessageType,
} from '@ptah-extension/shared';
import { VSCodeService } from '../services';

/**
 * Subscribe to all events in a specific category
 *
 * @param vscodeService - The VSCodeService instance
 * @param category - Category from MESSAGE_REGISTRY (e.g., 'CHAT', 'PROVIDER')
 * @param handler - Function to handle events (receives type and payload)
 * @param destroyRef - Angular DestroyRef for automatic cleanup
 *
 * @example
 * ```typescript
 * subscribeToCategory(
 *   this.vscode,
 *   'CHAT',
 *   (type, payload) => {
 *     switch(type) {
 *       case CHAT_MESSAGE_TYPES.MESSAGE_CHUNK:
 *         this.handleChunk(payload);
 *         break;
 *       // ... handle other chat events
 *     }
 *   },
 *   this.destroyRef
 * );
 * ```
 */
export function subscribeToCategory(
  vscodeService: VSCodeService,
  category: MessageCategory,
  handler: (type: StrictMessageType, payload: unknown) => void,
  destroyRef: DestroyRef
): void {
  const eventTypes = MESSAGE_REGISTRY.getCategory(category);

  // Subscribe to each event type in the category
  eventTypes.forEach((type) => {
    const typedKey = type as keyof MessagePayloadMap;
    vscodeService
      .onMessageType(typedKey)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((payload) => {
        handler(type as StrictMessageType, payload);
      });
  });
}

/**
 * Subscribe to multiple categories at once
 *
 * @param vscodeService - The VSCodeService instance
 * @param categories - Array of category names
 * @param handler - Function to handle events (receives type and payload)
 * @param destroyRef - Angular DestroyRef for automatic cleanup
 *
 * @example
 * ```typescript
 * subscribeToCategories(
 *   this.vscode,
 *   ['CHAT', 'PROVIDER', 'SYSTEM'],
 *   (type, payload) => this.handleEvent(type, payload),
 *   this.destroyRef
 * );
 * ```
 */
export function subscribeToCategories(
  vscodeService: VSCodeService,
  categories: MessageCategory[],
  handler: (type: StrictMessageType, payload: unknown) => void,
  destroyRef: DestroyRef
): void {
  categories.forEach((category) => {
    subscribeToCategory(vscodeService, category, handler, destroyRef);
  });
}

/**
 * Subscribe to specific event types with typed handlers
 *
 * Provides type-safe handlers for each event type using a map.
 *
 * @param vscodeService - The VSCodeService instance
 * @param handlers - Map of event types to typed handler functions
 * @param destroyRef - Angular DestroyRef for automatic cleanup
 *
 * @example
 * ```typescript
 * subscribeToEvents(
 *   this.vscode,
 *   {
 *     [CHAT_MESSAGE_TYPES.MESSAGE_CHUNK]: (payload) => {
 *       // TypeScript knows payload is ChatMessageChunkPayload
 *       this.handleChunk(payload);
 *     },
 *     [CHAT_MESSAGE_TYPES.SESSION_CREATED]: (payload) => {
 *       // TypeScript knows payload is ChatSessionCreatedPayload
 *       this.handleSessionCreated(payload);
 *     }
 *   },
 *   this.destroyRef
 * );
 * ```
 */
export function subscribeToEvents<T extends keyof MessagePayloadMap>(
  vscodeService: VSCodeService,
  handlers: {
    [K in T]?: (payload: MessagePayloadMap[K]) => void;
  },
  destroyRef: DestroyRef
): void {
  Object.entries(handlers).forEach(([type, handler]) => {
    if (handler) {
      vscodeService
        .onMessageType(type as T)
        .pipe(takeUntilDestroyed(destroyRef))
        .subscribe((payload) => {
          (handler as (payload: MessagePayloadMap[T]) => void)(payload);
        });
    }
  });
}

/**
 * Create a merged observable of all events in a category
 *
 * Useful when you want to apply RxJS operators to all events in a category.
 *
 * @param vscodeService - The VSCodeService instance
 * @param category - Category from MESSAGE_REGISTRY
 * @returns Observable that emits { type, payload } for all events in category
 *
 * @example
 * ```typescript
 * getCategoryObservable(this.vscode, 'CHAT')
 *   .pipe(
 *     debounceTime(100),
 *     takeUntilDestroyed(this.destroyRef)
 *   )
 *   .subscribe(({ type, payload }) => {
 *     console.log('Chat event:', type, payload);
 *   });
 * ```
export function getCategoryObservable(
  vscodeService: VSCodeService,
  category: MessageCategory
) {
  const eventTypes = MESSAGE_REGISTRY.getCategory(category);

  const observables = eventTypes.map((type) => {
    const typedKey = type as keyof MessagePayloadMap;
    return vscodeService
      .onMessageType(typedKey)
      .pipe(map((payload) => ({ type: type as StrictMessageType, payload })));
  });

  return merge(...observables);
}
}

/**
 * Subscribe to all request types (no responses)
 *
 * @param vscodeService - The VSCodeService instance
 * @param handler - Function to handle request events
 * @param destroyRef - Angular DestroyRef for automatic cleanup
 *
 * @example
 * ```typescript
 * // Log all requests for debugging
 * subscribeToRequests(
 *   this.vscode,
 *   (type, payload) => console.log('Request:', type, payload),
 *   this.destroyRef
 * );
export function subscribeToRequests(
  vscodeService: VSCodeService,
  handler: (type: StrictMessageType, payload: unknown) => void,
  destroyRef: DestroyRef
): void {
  const requestTypes = MESSAGE_REGISTRY.getRequestTypes();

  requestTypes.forEach((type) => {
    const typedKey = type as keyof MessagePayloadMap;
    vscodeService
      .onMessageType(typedKey)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((payload) => {
        handler(type as StrictMessageType, payload);
      });
  });
}
  });
}

/**
 * Subscribe to all response types
 *
 * @param vscodeService - The VSCodeService instance
 * @param handler - Function to handle response events
 * @param destroyRef - Angular DestroyRef for automatic cleanup
 *
 * @example
 * ```typescript
 * // Track all backend responses for analytics
 * subscribeToResponses(
 *   this.vscode,
 *   (type, payload) => this.trackResponse(type, payload),
 *   this.destroyRef
export function subscribeToResponses(
  vscodeService: VSCodeService,
  handler: (type: StrictMessageType, payload: unknown) => void,
  destroyRef: DestroyRef
): void {
  const responseTypes = MESSAGE_REGISTRY.getResponseTypes();

  responseTypes.forEach((type) => {
    const typedKey = type as keyof MessagePayloadMap;
    vscodeService
      .onMessageType(typedKey)
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe((payload) => {
        handler(type as StrictMessageType, payload);
      });
  });
}
      });
  });
}

/**
 * Usage Examples and Migration Patterns:
 *
 * ## Before (Manual Subscriptions):
 * ```typescript
 * this.vscode.onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_CHUNK).subscribe(...);
 * this.vscode.onMessageType(CHAT_MESSAGE_TYPES.SESSION_CREATED).subscribe(...);
 * this.vscode.onMessageType(CHAT_MESSAGE_TYPES.SESSION_SWITCHED).subscribe(...);
 * this.vscode.onMessageType(CHAT_MESSAGE_TYPES.MESSAGE_ADDED).subscribe(...);
 * this.vscode.onMessageType(CHAT_MESSAGE_TYPES.TOKEN_USAGE_UPDATED).subscribe(...);
 * // ... 4 more subscriptions
 * ```
 *
 * ## After (Automatic Subscriptions):
 * ```typescript
 * subscribeToCategory(this.vscode, 'CHAT', (type, payload) => {
 *   // Single handler for all CHAT events
 *   this.handleChatEvent(type, payload);
 * }, this.destroyRef);
 * ```
 *
 * ## Type-Safe Alternative:
 * ```typescript
 * subscribeToEvents(this.vscode, {
 *   [CHAT_MESSAGE_TYPES.MESSAGE_CHUNK]: (p) => this.handleChunk(p),
 *   [CHAT_MESSAGE_TYPES.SESSION_CREATED]: (p) => this.handleSession(p),
 *   // TypeScript enforces correct payload types for each handler
 * }, this.destroyRef);
 * ```
 *
 * ## Advanced: RxJS Operators on Category
 * ```typescript
 * getCategoryObservable(this.vscode, 'CHAT')
 *   .pipe(
 *     debounceTime(100),
 *     distinctUntilChanged((a, b) => a.type === b.type),
 *     takeUntilDestroyed(this.destroyRef)
 *   )
 *   .subscribe(({ type, payload }) => {
 *     this.handleDebouncedChatEvent(type, payload);
 *   });
 * ```
 */
