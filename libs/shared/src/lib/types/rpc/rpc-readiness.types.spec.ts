/**
 * `rpc-readiness.types` — guard + constructor specs (TASK_2026_331 B2A.T1).
 *
 * The guard is the seam between an `unknown` RPC result and a caller that reads
 * `retryAfterMs` off it to schedule a timer. A guard that accepts a malformed
 * payload turns a bad message into `setTimeout(fn, undefined)` — an immediate
 * retry loop — so the negative cases below matter more than the positive one.
 */

import {
  BACKEND_READINESS_VALUES,
  DEFAULT_READINESS_RETRY_AFTER_MS,
  isBackendReadiness,
  isRpcReadinessError,
  rpcReadinessError,
  type RpcReadinessError,
} from './rpc-readiness.types';

describe('isBackendReadiness', () => {
  it.each(BACKEND_READINESS_VALUES)('accepts %s', (value) => {
    expect(isBackendReadiness(value)).toBe(true);
  });

  it.each([['booting'], [''], [null], [undefined], [1], [{}]])(
    'rejects %p',
    (value) => {
      expect(isBackendReadiness(value)).toBe(false);
    },
  );
});

describe('isRpcReadinessError', () => {
  const valid: RpcReadinessError = {
    ready: false,
    readiness: 'warming',
    retryAfterMs: 2000,
    reason: 'SQLite is not open yet',
  };

  it('accepts a well-formed readiness error', () => {
    expect(isRpcReadinessError(valid)).toBe(true);
  });

  it('rejects a normal RPC result', () => {
    // The shape every guarded handler returns on the happy path.
    expect(
      isRpcReadinessError({ sessions: [], total: 0, hasMore: false }),
    ).toBe(false);
  });

  it('rejects the ready:true variant of a widened response', () => {
    expect(isRpcReadinessError({ ready: true, sessions: [] })).toBe(false);
  });

  it.each([
    ['a missing readiness', { ...valid, readiness: undefined }],
    ['an unknown readiness value', { ...valid, readiness: 'booting' }],
    ['a string retryAfterMs', { ...valid, retryAfterMs: '2000' }],
    ['a NaN retryAfterMs', { ...valid, retryAfterMs: Number.NaN }],
    ['an Infinity retryAfterMs', { ...valid, retryAfterMs: Infinity }],
    ['a missing reason', { ...valid, reason: undefined }],
  ])('rejects %s', (_label, value) => {
    expect(isRpcReadinessError(value)).toBe(false);
  });

  it.each([[null], [undefined], ['warming'], [42], [[]]])(
    'rejects the non-object %p',
    (value) => {
      // An array passes `typeof === 'object'`, so it needs its own case.
      expect(isRpcReadinessError(value)).toBe(false);
    },
  );
});

describe('rpcReadinessError', () => {
  it('defaults to warming and the shared retry delay', () => {
    const error = rpcReadinessError('SQLite is not open yet');

    expect(error).toEqual({
      ready: false,
      readiness: 'warming',
      retryAfterMs: DEFAULT_READINESS_RETRY_AFTER_MS,
      reason: 'SQLite is not open yet',
    });
    expect(isRpcReadinessError(error)).toBe(true);
  });

  it('carries an explicit readiness and delay', () => {
    const error = rpcReadinessError('boot failed', 'failed', 0);

    expect(error.readiness).toBe('failed');
    expect(error.retryAfterMs).toBe(0);
  });

  it('narrows a union by the ready discriminant with no guard call', () => {
    type Response = ({ ready: true } & { total: number }) | RpcReadinessError;

    // The point of a boolean-literal discriminant: both branches narrow with
    // no type guard at the call site.
    const read = (response: Response): number =>
      response.ready ? response.total : -response.retryAfterMs;

    expect(read({ ready: true, total: 7 })).toBe(7);
    expect(read(rpcReadinessError('warming'))).toBe(
      -DEFAULT_READINESS_RETRY_AFTER_MS,
    );
  });
});
