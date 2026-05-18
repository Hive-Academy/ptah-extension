/**
 * Custom Jest matchers barrel + one-shot `registerMatchers()` setup.
 *
 * Per-project `jest.setup.ts` files should call `registerMatchers()` exactly
 * once (typically via `setupFilesAfterEach` in `jest.config.ts`) to extend
 * `expect` with the Ptah-specific assertions.
 */

import { toBeSessionId } from './to-be-session-id';
import { toMatchRpcSuccess } from './to-match-rpc-success';
import { toMatchRpcError } from './to-match-rpc-error';

export { toBeSessionId } from './to-be-session-id';
export {
  toMatchRpcSuccess,
  type RpcResponseEnvelope,
} from './to-match-rpc-success';
export { toMatchRpcError } from './to-match-rpc-error';

/**
 * Augment the global `jest.Matchers` interface so specs get TypeScript
 * completion for the custom matchers without each consumer re-declaring the
 * types.
 */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toBeSessionId(): R;
      toMatchRpcSuccess(expectedData?: unknown): R;
      toMatchRpcError(expectedError?: string | RegExp): R;
    }
  }
}

let registered = false;

/**
 * Register all Ptah custom matchers on the global `expect`. Idempotent — safe
 * to call multiple times (Jest's `expect.extend` is itself additive).
 */
export function registerMatchers(): void {
  if (registered) {
    return;
  }
  expect.extend({
    toBeSessionId,
    toMatchRpcSuccess,
    toMatchRpcError,
  });
  registered = true;
}
