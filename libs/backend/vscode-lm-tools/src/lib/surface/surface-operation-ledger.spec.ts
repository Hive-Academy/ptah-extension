import { SURFACE_STORE_LIMITS } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  SurfaceOperationLedger,
  canonicalSurfaceJson,
  fingerprintSurfaceOperation,
  surfaceOperationIssuedAt,
  type SurfaceLedgerOptions,
  type SurfaceOperationRequest,
} from './surface-operation-ledger';
import { SurfaceStateStore } from './surface-state.store';

const T0 = 1_700_000_000_000;
const RETENTION = SURFACE_STORE_LIMITS.operationRetentionMs;
const SKEW = SURFACE_STORE_LIMITS.maxOperationClockSkewMs;

function opId(issuedAt: number, nonce = 'abcdefgh'): string {
  return `op-${String(issuedAt).padStart(13, '0')}-${nonce}`;
}

function request(
  operationId: string,
  overrides: Partial<SurfaceOperationRequest> = {},
): SurfaceOperationRequest {
  return {
    operationId,
    kind: 'change',
    surfaceId: 'profile',
    incarnation: 3,
    fingerprint: fingerprintSurfaceOperation({ operationId, value: 'Ada' }),
    ...overrides,
  };
}

function setup(options: Omit<SurfaceLedgerOptions, 'clock'> = {}) {
  const time = { now: T0 };
  const ledger = new SurfaceOperationLedger({
    ...options,
    clock: () => time.now,
  });
  return { ledger, time };
}

describe('SurfaceOperationLedger', () => {
  describe('lookup before expiry', () => {
    it('reserves an absent, fresh id as pending and looks it up', () => {
      const { ledger } = setup();
      const id = opId(T0);
      const result = ledger.reserve('tab-1', request(id));
      expect(result.outcome).toBe('reserved');
      expect(ledger.lookup('tab-1', id)).toMatchObject({ status: 'pending' });
    });

    it('answers unknown for an absent id and for another routing id', () => {
      const { ledger } = setup();
      const id = opId(T0);
      ledger.reserve('tab-1', request(id));
      expect(ledger.lookup('tab-1', opId(T0, 'zzzzzzzz'))).toEqual({
        status: 'unknown',
      });
      expect(ledger.lookup('tab-2', id)).toEqual({ status: 'unknown' });
    });

    it('replays the same fingerprint while pending and after settlement', () => {
      const { ledger } = setup();
      const id = opId(T0);
      ledger.reserve('tab-1', request(id));
      expect(ledger.reserve('tab-1', request(id))).toMatchObject({
        outcome: 'replay',
        record: { status: 'pending' },
      });
      ledger.settle('tab-1', id, { status: 'applied', revision: 5 });
      expect(ledger.reserve('tab-1', request(id))).toMatchObject({
        outcome: 'replay',
        record: { status: 'applied', revision: 5 },
      });
    });

    it('answers conflict for a different fingerprint under the same id', () => {
      const { ledger } = setup();
      const id = opId(T0);
      ledger.reserve('tab-1', request(id));
      const result = ledger.reserve(
        'tab-1',
        request(id, { fingerprint: fingerprintSurfaceOperation({ other: 1 }) }),
      );
      expect(result).toMatchObject({
        outcome: 'conflict',
        reason: 'operation-conflict',
      });
    });

    it('replays and conflicts whatever the issue time, even past the expiry window', () => {
      const { ledger, time } = setup();
      const id = opId(T0);
      ledger.reserve('tab-1', request(id));
      // Settled 5 minutes after issue, so it is kept until T0 + 5 min + retention.
      time.now = T0 + 5 * 60_000;
      ledger.settle('tab-1', id, { status: 'applied', revision: 4 });
      time.now = T0 + RETENTION + 2 * 60_000;
      // An absent id with this issue time would be expired now.
      expect(
        ledger.reserve('tab-1', request(opId(T0, 'freshnew1'))),
      ).toMatchObject({ outcome: 'refused', reason: 'operation-expired' });
      expect(ledger.reserve('tab-1', request(id))).toMatchObject({
        outcome: 'replay',
        record: { status: 'applied' },
      });
      expect(
        ledger.reserve(
          'tab-1',
          request(id, { fingerprint: fingerprintSurfaceOperation('x') }),
        ),
      ).toMatchObject({ outcome: 'conflict' });
    });
  });

  describe('expiry of absent ids (fail closed)', () => {
    it('accepts the oldest issue time in the window and refuses one millisecond older', () => {
      const { ledger } = setup();
      expect(
        ledger.reserve('tab-1', request(opId(T0 - RETENTION, 'edgeedge1')))
          .outcome,
      ).toBe('reserved');
      expect(
        ledger.reserve('tab-1', request(opId(T0 - RETENTION - 1, 'edgeedge2'))),
      ).toMatchObject({ outcome: 'refused', reason: 'operation-expired' });
    });

    it('accepts a future-dated id inside the skew and refuses one beyond it', () => {
      const { ledger } = setup();
      expect(
        ledger.reserve('tab-1', request(opId(T0 + SKEW, 'future01'))).outcome,
      ).toBe('reserved');
      expect(
        ledger.reserve('tab-1', request(opId(T0 + SKEW + 1, 'future02'))),
      ).toMatchObject({ outcome: 'refused', reason: 'operation-expired' });
    });

    it('keeps a future-dated terminal id until issuedAt + retention, then it stays expired', () => {
      const { ledger, time } = setup();
      const issuedAt = T0 + 4 * 60_000;
      const id = opId(issuedAt, 'future03');
      ledger.reserve('tab-1', request(id));
      const settled = ledger.settle('tab-1', id, { status: 'applied' });
      expect(settled).toMatchObject({
        ok: true,
        record: { settledAt: T0, forgetAt: issuedAt + RETENTION },
      });
      // Past settledAt + retention, but not past issuedAt + retention: still remembered.
      time.now = T0 + RETENTION + 60_000;
      expect(ledger.reserve('tab-1', request(id)).outcome).toBe('replay');
      time.now = issuedAt + RETENTION;
      expect(ledger.lookup('tab-1', id).status).toBe('applied');
      time.now = issuedAt + RETENTION + 1;
      expect(ledger.lookup('tab-1', id)).toEqual({ status: 'unknown' });
      expect(ledger.reserve('tab-1', request(id))).toMatchObject({
        outcome: 'refused',
        reason: 'operation-expired',
      });
    });

    it('refuses an id without a readable issue time', () => {
      const { ledger } = setup();
      expect(ledger.reserve('tab-1', request('not-an-op-id'))).toMatchObject({
        outcome: 'refused',
        reason: 'operation-expired',
      });
      expect(surfaceOperationIssuedAt('op-123-abcdefgh')).toBeUndefined();
      expect(surfaceOperationIssuedAt(opId(T0))).toBe(T0);
    });

    it('forgets a terminal record strictly after forgetAt, so the id cannot come back', () => {
      const { ledger, time } = setup();
      const id = opId(T0);
      ledger.reserve('tab-1', request(id));
      time.now = T0 + 1_000;
      ledger.settle('tab-1', id, {
        status: 'rejected',
        reason: 'busy',
        detail: 'busy',
      });
      const forgetAt = T0 + 1_000 + RETENTION;
      time.now = forgetAt;
      expect(ledger.lookup('tab-1', id)).toMatchObject({
        status: 'rejected',
        record: { reason: 'busy', forgetAt },
      });
      time.now = forgetAt + 1;
      expect(ledger.lookup('tab-1', id)).toEqual({ status: 'unknown' });
      expect(ledger.reserve('tab-1', request(id)).outcome).toBe('refused');
    });

    it('never forgets a pending record', () => {
      const { ledger, time } = setup();
      const id = opId(T0);
      ledger.reserve('tab-1', request(id));
      time.now = T0 + 30 * 24 * 60 * 60_000;
      expect(ledger.lookup('tab-1', id).status).toBe('pending');
      expect(ledger.reserve('tab-1', request(id)).outcome).toBe('replay');
      expect(ledger.chargedBytes()).toBe(
        SURFACE_STORE_LIMITS.operationRecordBytes,
      );
    });
  });

  describe('monotonic clock', () => {
    it('ignores a clock rollback for expiry and retention', () => {
      const { ledger, time } = setup();
      const id = opId(T0);
      ledger.reserve('tab-1', request(id));
      ledger.settle('tab-1', id, { status: 'applied' });
      time.now = T0 - 60 * 60_000;
      expect(ledger.now()).toBe(T0);
      // Valid against the rolled-back clock, expired against ledger time.
      expect(
        ledger.reserve('tab-1', request(opId(T0 - 45 * 60_000, 'rollback1'))),
      ).toMatchObject({ outcome: 'refused', reason: 'operation-expired' });
      expect(ledger.reserve('tab-1', request(id)).outcome).toBe('replay');
      // Settlement during the rollback still uses ledger time.
      const late = opId(T0, 'rollback2');
      ledger.reserve('tab-1', request(late));
      expect(ledger.settle('tab-1', late, { status: 'applied' })).toMatchObject(
        {
          record: { settledAt: T0, forgetAt: T0 + RETENTION },
        },
      );
    });
  });

  describe('settlement', () => {
    it('settles once and reports unknown or already-settled otherwise', () => {
      const { ledger } = setup();
      const id = opId(T0);
      expect(ledger.settle('tab-1', id, { status: 'applied' })).toEqual({
        ok: false,
        reason: 'unknown',
      });
      ledger.reserve('tab-1', request(id, { kind: 'submit' }));
      expect(
        ledger.settle('tab-1', id, {
          status: 'indeterminate',
          detail: 'dispatch outcome unknown',
          revision: 9,
        }),
      ).toMatchObject({
        ok: true,
        record: {
          status: 'indeterminate',
          revision: 9,
          detail: 'dispatch outcome unknown',
        },
      });
      expect(ledger.settle('tab-1', id, { status: 'applied' })).toMatchObject({
        ok: false,
        reason: 'already-settled',
        record: { status: 'indeterminate' },
      });
    });

    it('counts pending records by kind for the busy rule', () => {
      const { ledger } = setup();
      ledger.reserve(
        'tab-1',
        request(opId(T0, 'submit01'), { kind: 'submit' }),
      );
      ledger.reserve('tab-1', request(opId(T0, 'change01')));
      expect(ledger.pendingCount('tab-1')).toBe(2);
      expect(ledger.pendingCount('tab-1', 'submit')).toBe(1);
      expect(ledger.pendingCount('tab-2', 'submit')).toBe(0);
    });
  });

  describe('capacity', () => {
    it('refuses the pending reservation one over maxPendingOperationsPerRoutingId', () => {
      const { ledger } = setup();
      const max = SURFACE_STORE_LIMITS.maxPendingOperationsPerRoutingId;
      for (let index = 0; index < max; index++)
        expect(
          ledger.reserve('tab-1', request(opId(T0, `pending${index}x`)))
            .outcome,
        ).toBe('reserved');
      expect(
        ledger.reserve('tab-1', request(opId(T0, 'pendingover'))),
      ).toMatchObject({ outcome: 'refused', reason: 'too-many-operations' });
      ledger.settle('tab-1', opId(T0, 'pending0x'), { status: 'applied' });
      expect(
        ledger.reserve('tab-1', request(opId(T0, 'pendingover'))).outcome,
      ).toBe('reserved');
    });

    it('refuses the record one over maxOperationRecordsPerRoutingId until one is forgotten', () => {
      const { ledger, time } = setup({
        limits: { maxOperationRecordsPerRoutingId: 3 },
      });
      for (let index = 0; index < 3; index++) {
        const id = opId(T0, `record${index}xx`);
        ledger.reserve('tab-1', request(id));
        ledger.settle('tab-1', id, { status: 'applied' });
      }
      expect(
        ledger.reserve('tab-1', request(opId(T0, 'recordover'))),
      ).toMatchObject({ outcome: 'refused', reason: 'too-many-operations' });
      time.now = T0 + RETENTION + 1;
      expect(
        ledger.reserve('tab-1', request(opId(time.now, 'recordover'))).outcome,
      ).toBe('reserved');
    });

    it('drops a routing ledger only when every record in it is forgotten', () => {
      const { ledger, time } = setup({ limits: { maxLedgerRoutingIds: 2 } });
      const oldA = opId(T0, 'aaaaaaaa');
      ledger.reserve('tab-a', request(oldA));
      ledger.settle('tab-a', oldA, { status: 'applied' });
      const b = opId(T0, 'bbbbbbbb');
      ledger.reserve('tab-b', request(b));
      ledger.settle('tab-b', b, { status: 'applied' });
      expect(
        ledger.reserve('tab-c', request(opId(T0, 'cccccccc'))),
      ).toMatchObject({ outcome: 'refused', reason: 'too-many-operations' });

      // tab-a gets one young record: its old one expires, the young one does not.
      time.now = T0 + RETENTION - 1_000;
      const youngA = opId(time.now, 'aayoung1');
      ledger.reserve('tab-a', request(youngA));
      ledger.settle('tab-a', youngA, { status: 'applied' });
      time.now = T0 + RETENTION + 1;
      expect(
        ledger.reserve('tab-c', request(opId(time.now, 'cccccccc'))).outcome,
      ).toBe('reserved');
      // tab-b was the fully forgotten ledger; tab-a kept its young record.
      expect(ledger.lookup('tab-a', youngA).status).toBe('applied');
      expect(ledger.routingIdCount()).toBe(2);
    });

    it('never drops a ledger holding a pending record', () => {
      const { ledger, time } = setup({ limits: { maxLedgerRoutingIds: 1 } });
      ledger.reserve('tab-a', request(opId(T0)));
      time.now = T0 + 10 * RETENTION;
      expect(
        ledger.reserve('tab-b', request(opId(time.now, 'bbbbbbbb'))),
      ).toMatchObject({ outcome: 'refused', reason: 'too-many-operations' });
    });

    it('asks the admission callback only for a new record and honours a refusal', () => {
      const { ledger } = setup();
      const admit = jest.fn(() => false);
      const id = opId(T0);
      expect(ledger.reserve('tab-1', request(id), admit)).toMatchObject({
        outcome: 'refused',
        reason: 'too-many-operations',
      });
      expect(admit).toHaveBeenCalledWith(
        SURFACE_STORE_LIMITS.operationRecordBytes,
      );
      expect(ledger.lookup('tab-1', id)).toEqual({ status: 'unknown' });

      const accept = jest.fn(() => true);
      ledger.reserve('tab-1', request(id), accept);
      ledger.reserve('tab-1', request(id), accept);
      expect(accept).toHaveBeenCalledTimes(1);
    });

    it('charges operationRecordBytes per unforgotten record', () => {
      const { ledger, time } = setup();
      const a = opId(T0, 'charge01');
      ledger.reserve('tab-1', request(a));
      ledger.reserve('tab-2', request(opId(T0, 'charge02')));
      expect(ledger.chargedBytes()).toBe(
        2 * SURFACE_STORE_LIMITS.operationRecordBytes,
      );
      ledger.settle('tab-1', a, { status: 'applied' });
      time.now = T0 + RETENTION + 1;
      expect(ledger.chargedBytes()).toBe(
        SURFACE_STORE_LIMITS.operationRecordBytes,
      );
      expect(ledger.routingIdCount()).toBe(1);
    });
  });

  describe('fingerprint', () => {
    it('is sha-256 hex over canonical JSON, independent of key order', () => {
      const a = fingerprintSurfaceOperation({
        b: 1,
        a: { d: [1, 'x'], c: null },
      });
      const b = fingerprintSurfaceOperation({
        a: { c: null, d: [1, 'x'] },
        b: 1,
      });
      expect(a).toMatch(/^[0-9a-f]{64}$/);
      expect(a).toBe(b);
      expect(fingerprintSurfaceOperation({ a: 1 })).not.toBe(
        fingerprintSurfaceOperation({ a: '1' }),
      );
    });

    it('drops undefined members like JSON and keeps a __proto__ key as data', () => {
      expect(
        canonicalSurfaceJson({ z: undefined, y: [undefined, 2], x: 'q' }),
      ).toBe('{"x":"q","y":[null,2]}');
      const hostile = JSON.parse(
        '{"__proto__":{"polluted":true},"a":1}',
      ) as unknown;
      expect(canonicalSurfaceJson(hostile)).toBe(
        '{"__proto__":{"polluted":true},"a":1}',
      );
      expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    });

    it('writes an array hole as null, like JSON', () => {
      const holey: unknown[] = [1];
      holey[2] = 3;
      expect(canonicalSurfaceJson(holey)).toBe('[1,null,3]');
      expect(canonicalSurfaceJson(new Array(1))).toBe('[null]');
    });
  });

  // Review finding 1 (Batch 9, round 1): admission through the real store
  // re-enters ledger housekeeping, which drops a ledger emptied by expiry.
  describe('admission that re-enters ledger housekeeping', () => {
    function integrated() {
      const time = { now: T0 };
      const ledger = new SurfaceOperationLedger({ clock: () => time.now });
      const store = new SurfaceStateStore({ charges: ledger });
      return { time, ledger, store };
    }

    function expectPublished(
      ledger: SurfaceOperationLedger,
      fresh: SurfaceOperationRequest,
      admit: (bytes: number) => boolean,
      records: number,
    ): void {
      expect(ledger.reserve('tab-1', fresh, admit).outcome).toBe('reserved');
      expect(ledger.lookup('tab-1', fresh.operationId).status).toBe('pending');
      expect(ledger.pendingCount('tab-1')).toBe(1);
      expect(ledger.chargedBytes()).toBe(
        records * SURFACE_STORE_LIMITS.operationRecordBytes,
      );
      expect(ledger.reserve('tab-1', fresh, admit).outcome).toBe('replay');
      expect(
        ledger.settle('tab-1', fresh.operationId, { status: 'applied' }),
      ).toMatchObject({ ok: true, record: { status: 'applied' } });
      expect(ledger.reserve('tab-1', fresh, admit)).toMatchObject({
        outcome: 'replay',
        record: { status: 'applied' },
      });
    }

    it.each([
      ['at retention + 1, when the old record is forgotten', RETENTION + 1, 1],
      ['at the exact forgetAt boundary, when it is still kept', RETENTION, 2],
    ])(
      'publishes a fresh reservation %s (store.makeRoom admission)',
      (_label, elapsed, records) => {
        const { time, ledger, store } = integrated();
        const admit = (bytes: number): boolean => store.makeRoom(bytes).ok;
        const old = request(opId(T0, 'oldold01'), { kind: 'submit' });
        expect(ledger.reserve('tab-1', old, admit).outcome).toBe('reserved');
        ledger.settle('tab-1', old.operationId, { status: 'applied' });
        time.now = T0 + elapsed;
        expectPublished(
          ledger,
          request(opId(time.now, 'newnew01'), { kind: 'submit' }),
          admit,
          records,
        );
        expect(ledger.lookup('tab-1', old.operationId).status).toBe(
          records === 2 ? 'applied' : 'unknown',
        );
      },
    );

    it('publishes a fresh reservation when admission calls routingIdCount()', () => {
      const { time, ledger } = integrated();
      const admit = (): boolean => {
        ledger.routingIdCount();
        return true;
      };
      const old = request(opId(T0, 'oldold02'));
      ledger.reserve('tab-1', old, admit);
      ledger.settle('tab-1', old.operationId, { status: 'applied' });
      time.now = T0 + RETENTION + 1;
      expectPublished(ledger, request(opId(time.now, 'newnew02')), admit, 1);
      expect(ledger.routingIdCount()).toBe(1);
    });

    it('re-checks the routing-id cap when admission registered another routing id', () => {
      const { ledger } = setup({ limits: { maxLedgerRoutingIds: 1 } });
      const other = request(opId(T0, 'other001'));
      const mine = request(opId(T0, 'mine0001'));
      const admit = (): boolean => {
        ledger.reserve('tab-2', other);
        return true;
      };
      expect(ledger.reserve('tab-1', mine, admit)).toMatchObject({
        outcome: 'refused',
        reason: 'too-many-operations',
      });
      expect(ledger.lookup('tab-1', mine.operationId).status).toBe('unknown');
      expect(ledger.routingIdCount()).toBe(1);
    });

    // Review finding 5 (Batch 9, round 2): an admission callback that fills
    // the SAME routing ledger must not let the outer record exceed its caps.
    const PENDING_CAP = SURFACE_STORE_LIMITS.maxPendingOperationsPerRoutingId;
    const RECORD_CAP = SURFACE_STORE_LIMITS.maxOperationRecordsPerRoutingId;
    const inner = (index: number): SurfaceOperationRequest =>
      request(opId(T0, `inner${index}`.padEnd(8, 'x')));

    it('refuses the outer record when admission filled the pending cap', () => {
      const { ledger } = setup();
      const outer = request(opId(T0, 'outer001'));
      const result = ledger.reserve('tab-1', outer, () => {
        for (let index = 0; index < PENDING_CAP; index++)
          expect(ledger.reserve('tab-1', inner(index)).outcome).toBe(
            'reserved',
          );
        return true;
      });
      expect(result).toMatchObject({
        outcome: 'refused',
        reason: 'too-many-operations',
      });
      expect(ledger.pendingCount('tab-1')).toBe(PENDING_CAP);
      expect(ledger.lookup('tab-1', outer.operationId).status).toBe('unknown');
    });

    it('refuses the outer record when admission filled the record cap', () => {
      const { ledger } = setup();
      const outer = request(opId(T0, 'outer002'));
      const result = ledger.reserve('tab-1', outer, () => {
        for (let index = 0; index < RECORD_CAP; index++) {
          const nested = inner(index);
          expect(ledger.reserve('tab-1', nested).outcome).toBe('reserved');
          ledger.settle('tab-1', nested.operationId, { status: 'applied' });
        }
        return true;
      });
      expect(result).toMatchObject({
        outcome: 'refused',
        reason: 'too-many-operations',
      });
      expect(ledger.chargedBytes()).toBe(
        RECORD_CAP * SURFACE_STORE_LIMITS.operationRecordBytes,
      );
      expect(ledger.lookup('tab-1', outer.operationId).status).toBe('unknown');
    });

    it('still reserves when admission left room below both caps', () => {
      const { ledger } = setup();
      const outer = request(opId(T0, 'outer003'));
      const result = ledger.reserve('tab-1', outer, () => {
        for (let index = 0; index < PENDING_CAP - 1; index++)
          ledger.reserve('tab-1', inner(index));
        return true;
      });
      expect(result.outcome).toBe('reserved');
      expect(ledger.pendingCount('tab-1')).toBe(PENDING_CAP);
      expect(ledger.lookup('tab-1', outer.operationId).status).toBe('pending');
    });
  });
});
