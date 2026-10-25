/**
 * `rpc-readiness.types` — guard + constructor specs (TASK_2026_331 B2A.T1).
 *
 * The guard is the seam between an `unknown` RPC result and a caller that reads
 * `retryAfterMs` off it to schedule a timer. A guard that accepts a malformed
 * payload turns a bad message into `setTimeout(fn, undefined)` — an immediate
 * retry loop — so the negative cases below matter more than the positive one.
 */

import type { MessagePayloadMap } from '../messages/payload-map';
import {
  BACKEND_READINESS_VALUES,
  BOOT_PHASE_VALUES,
  BOOT_PROGRESS_STEP_IDS,
  BootProgressPayloadSchema,
  DEFAULT_READINESS_RETRY_AFTER_MS,
  isBackendReadiness,
  isBootPhase,
  isRpcReadinessError,
  rpcReadinessError,
  type BootGetReadinessResult,
  type BootProgressPayload,
  type BootReadinessChangedPayload,
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

describe('isBootPhase', () => {
  it.each(BOOT_PHASE_VALUES)('accepts %s', (value) => {
    expect(isBootPhase(value)).toBe(true);
  });

  it.each([
    ['booting'],
    ['Database'],
    ['db'],
    [''],
    [null],
    [undefined],
    [0],
    [{}],
  ])('rejects the near-miss %p', (value) => {
    expect(isBootPhase(value)).toBe(false);
  });

  it('lists every union member exactly once', () => {
    // `as const satisfies readonly BootPhase[]` proves the tuple holds only
    // legal members; it cannot prove the tuple is COMPLETE, so the membership
    // is asserted here. A phase added to the union but not the tuple would
    // make `isBootPhase` silently reject a phase the backend emits.
    expect(new Set(BOOT_PHASE_VALUES).size).toBe(BOOT_PHASE_VALUES.length);
    expect(BOOT_PHASE_VALUES).toEqual([
      'starting',
      'database',
      'harness',
      'sessions',
      'index',
      'settled',
    ]);
  });
});

describe('BootReadinessChangedPayload', () => {
  it('is the payload-map shape for boot:readinessChanged and the pull result', () => {
    const push: MessagePayloadMap['boot:readinessChanged'] = {
      readiness: 'warming',
      phase: 'database',
      detail: 'Opening a 1.0 GB database',
      startedAt: 1_700_000_000_000,
    };

    // One shape, push and pull — a renderer that missed the push reads exactly
    // what a listener would have received.
    const pull: BootGetReadinessResult = push;

    expect(isBackendReadiness(pull.readiness)).toBe(true);
    expect(isBootPhase(pull.phase)).toBe(true);
  });

  it('leaves detail optional', () => {
    const settled: BootReadinessChangedPayload = {
      readiness: 'ready',
      phase: 'settled',
      startedAt: 1_700_000_000_000,
    };

    expect(settled.detail).toBeUndefined();
  });
});

describe('BootProgressPayloadSchema', () => {
  const active: BootProgressPayload = {
    stepId: 'verify',
    index: 0,
    total: 3,
    state: 'active',
    startedAt: 1_700_000_000_000,
  };

  it('lists the three host boot steps in start order', () => {
    expect(BOOT_PROGRESS_STEP_IDS).toEqual(['verify', 'restore', 'agents']);
  });

  it('is the payload-map shape for boot:progress', () => {
    const push: MessagePayloadMap['boot:progress'] = active;

    expect(BootProgressPayloadSchema.safeParse(push).success).toBe(true);
  });

  it.each<[string, BootProgressPayload]>([
    ['an indeterminate active step', active],
    [
      'a counted active step',
      { ...active, stepId: 'restore', index: 1, done: 3, count: 12 },
    ],
    [
      'a finished step with elapsed time',
      { ...active, state: 'done', elapsedMs: 840 },
    ],
    [
      'a failed step',
      { ...active, stepId: 'agents', index: 2, state: 'failed', elapsedMs: 12 },
    ],
    ['done equal to count', { ...active, done: 5, count: 5 }],
    ['done without count', { ...active, done: 5 }],
  ])('accepts %s', (_label, value) => {
    expect(BootProgressPayloadSchema.safeParse(value).success).toBe(true);
  });

  it.each<[string, unknown]>([
    ['done greater than count', { ...active, done: 6, count: 5 }],
    ['an unknown key', { ...active, detail: 'Opening the database' }],
    ['an unknown step id', { ...active, stepId: 'index' }],
    ['an unknown state', { ...active, state: 'pending' }],
    ['an out-of-range index', { ...active, index: 3 }],
    ['a total other than 3', { ...active, total: 4 }],
    ['a fractional count', { ...active, done: 1, count: 2.5 }],
    ['a negative elapsedMs', { ...active, elapsedMs: -1 }],
    ['a missing startedAt', { ...active, startedAt: undefined }],
    ['a non-object', 'boot:progress'],
  ])('rejects %s', (_label, value) => {
    expect(BootProgressPayloadSchema.safeParse(value).success).toBe(false);
  });
});
