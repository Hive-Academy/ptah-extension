/**
 * Message Router Types - Handler registration pattern for VS Code message routing
 *
 * Each service declares what message types it handles via the MessageHandler interface.
 * MessageRouterService collects all handlers at bootstrap via MESSAGE_HANDLERS InjectionToken
 * and dispatches via pre-built Map for O(1) lookup.
 *
 * This replaces the fragile lazy setter pattern (any types, constructor ordering)
 * that caused circular DI crashes (NG0200) in VSCodeService.
 */

import { InjectionToken } from '@angular/core';

/**
 * Interface for services that handle VS Code webview messages.
 *
 * Services implement this interface and register via the MESSAGE_HANDLERS
 * multi-provider token. The MessageRouterService collects all handlers
 * and dispatches messages based on type.
 *
 * @example
 * ```typescript
 * @Injectable({ providedIn: 'root' })
 * export class MyService implements MessageHandler {
 *   readonly handledMessageTypes = [MESSAGE_TYPES.MY_TYPE] as const;
 *
 *   handleMessage(message: { type: string; payload?: unknown }): void {
 *     // Handle message
 *   }
 * }
 * ```
 */
export interface MessageHandler {
  /** Message types this handler is responsible for */
  readonly handledMessageTypes: readonly string[];

  /** Process an incoming message */
  handleMessage(message: { type: string; payload?: unknown }): void;
}

/**
 * Multi-provider InjectionToken for message handler registration.
 *
 * Services that implement MessageHandler register themselves via:
 * ```typescript
 * { provide: MESSAGE_HANDLERS, useExisting: MyService, multi: true }
 * ```
 */
export const MESSAGE_HANDLERS = new InjectionToken<MessageHandler[]>(
  'MESSAGE_HANDLERS'
);
