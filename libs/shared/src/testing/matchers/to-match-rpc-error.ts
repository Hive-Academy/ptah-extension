/**
 * Custom matcher: `expect(response).toMatchRpcError(expectedError?)`.
 *
 * Symmetric to `toMatchRpcSuccess`. Asserts:
 *   - envelope shape
 *   - `success === false`
 *   - `error` is a non-empty string
 *   - (optionally) the error message matches `expectedError` (string equality
 *     or regex test)
 */

import type { RpcResponseEnvelope } from './to-match-rpc-success';

type MatcherResult = { pass: boolean; message: () => string };

function isEnvelope(value: unknown): value is RpcResponseEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    typeof (value as { success: unknown }).success === 'boolean' &&
    'correlationId' in value &&
    typeof (value as { correlationId: unknown }).correlationId === 'string'
  );
}

export function toMatchRpcError(
  received: unknown,
  expectedError?: string | RegExp,
): MatcherResult {
  if (!isEnvelope(received)) {
    return {
      pass: false,
      message: () =>
        `Expected an RpcResponse envelope { success, data?, error?, correlationId }, got: ${JSON.stringify(received)}`,
    };
  }
  if (received.success !== false) {
    return {
      pass: false,
      message: () =>
        `Expected RpcResponse.success === false, got success=${received.success}`,
    };
  }
  if (typeof received.error !== 'string' || received.error.length === 0) {
    return {
      pass: false,
      message: () =>
        `Expected error envelope to carry a non-empty 'error' string, got error=${JSON.stringify(received.error)}`,
    };
  }
  if (expectedError !== undefined) {
    const matches =
      typeof expectedError === 'string'
        ? received.error === expectedError
        : expectedError.test(received.error);
    if (!matches) {
      return {
        pass: false,
        message: () =>
          `Expected RpcResponse.error to match ${String(expectedError)}, got "${received.error}"`,
      };
    }
  }
  return {
    pass: true,
    message: () =>
      'Expected envelope NOT to be an RpcResponse error, but it was.',
  };
}
