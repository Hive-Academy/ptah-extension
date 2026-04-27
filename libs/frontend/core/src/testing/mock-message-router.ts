/**
 * `createMockMessageRouter` — typed mock for `MessageRouterService`.
 *
 * `MessageRouterService` has a constructor side effect (it attaches a
 * `window.addEventListener('message', …)` handler at bootstrap). In specs we
 * never want that listener to fire. This factory returns a
 * `jest.Mocked<MessageRouterService>` without running the real constructor,
 * so tests can inject it wherever the router is required.
 *
 * The mock also exposes a `dispatch(message)` helper that lets tests simulate
 * incoming VS Code messages. `dispatch` walks the internal handler list and
 * calls each handler whose `handledMessageTypes` include the message type —
 * the same logic the real router performs, but in-process and synchronous.
 *
 * @see libs/frontend/core/src/lib/services/message-router.service.ts
 * @see libs/frontend/core/src/lib/services/message-router.types.ts
 */

import type { MessageRouterService } from '../lib/services/message-router.service';
import type { MessageHandler } from '../lib/services/message-router.types';

export interface MockMessageRouterState {
  readonly handlers: MessageHandler[];
  register(handler: MessageHandler): void;
  clear(): void;
}

export type MockMessageRouter = jest.Mocked<MessageRouterService> & {
  readonly __state: MockMessageRouterState;
  /**
   * Simulate an incoming message. Dispatches synchronously to every registered
   * handler whose `handledMessageTypes` includes `message.type`.
   */
  dispatch(message: { type: string; payload?: unknown }): void;
};

export interface MockMessageRouterOverrides {
  /** Pre-registered handlers — same shape as `MESSAGE_HANDLERS` multi-provider. */
  handlers?: MessageHandler[];
}

export function createMockMessageRouter(
  overrides?: MockMessageRouterOverrides,
): MockMessageRouter {
  const handlers: MessageHandler[] = [...(overrides?.handlers ?? [])];

  const state: MockMessageRouterState = {
    handlers,
    register(handler: MessageHandler): void {
      handlers.push(handler);
    },
    clear(): void {
      handlers.length = 0;
    },
  };

  const dispatch = jest.fn(
    (message: { type: string; payload?: unknown }): void => {
      if (!message || !message.type) return;
      for (const handler of handlers) {
        if (handler.handledMessageTypes.includes(message.type)) {
          handler.handleMessage(message);
        }
      }
    },
  );

  const mock = {
    __state: state,
    dispatch,
  } as unknown as MockMessageRouter;

  return mock;
}
