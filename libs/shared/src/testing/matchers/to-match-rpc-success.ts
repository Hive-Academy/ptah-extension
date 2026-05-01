/**
 * Custom matcher: `expect(response).toMatchRpcSuccess(expectedData?)`.
 *
 * RPC response envelope is defined at
 * `libs/backend/vscode-core/src/messaging/rpc-types.ts:26-52` — not in `shared`.
 * Rather than creating a cross-library dep in the foundation layer, the matcher
 * type-checks against a local subset that mirrors the production shape:
 *
 *   { success: boolean; data?: T; error?: string; correlationId: string }
 *
 * Successful envelopes MUST have `success === true`, MAY have `data`, and MUST
 * NOT carry an `error` field.
 */

export interface RpcResponseEnvelope<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  correlationId: string;
}

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

export function toMatchRpcSuccess(
  this: jest.MatcherContext | undefined,
  received: unknown,
  expectedData?: unknown,
): MatcherResult {
  if (!isEnvelope(received)) {
    return {
      pass: false,
      message: () =>
        `Expected an RpcResponse envelope { success, data?, error?, correlationId }, got: ${JSON.stringify(received)}`,
    };
  }
  if (received.success !== true) {
    return {
      pass: false,
      message: () =>
        `Expected RpcResponse.success === true, got success=${received.success}, error=${received.error ?? '<none>'}`,
    };
  }
  if (received.error !== undefined) {
    return {
      pass: false,
      message: () =>
        `Expected success envelope to omit 'error', but got error=${received.error}`,
    };
  }
  if (expectedData !== undefined) {
    const equals =
      this?.equals ??
      ((a: unknown, b: unknown): boolean =>
        JSON.stringify(a) === JSON.stringify(b));
    if (!equals(received.data, expectedData)) {
      return {
        pass: false,
        message: () =>
          `Expected RpcResponse.data to equal ${JSON.stringify(expectedData)}, got ${JSON.stringify(received.data)}`,
      };
    }
  }
  return {
    pass: true,
    message: () =>
      'Expected envelope NOT to be a successful RpcResponse, but it was.',
  };
}
