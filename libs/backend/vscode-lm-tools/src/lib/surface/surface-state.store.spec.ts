import { jsonUtf8Bytes } from '@ptah-extension/platform-core';
import type {
  SurfaceContent,
  SurfaceSubmitRecord,
} from '@ptah-extension/shared';
import {
  SURFACE_STORE_LIMITS,
  appendWrite,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { SurfaceOperationLedger } from './surface-operation-ledger';
import {
  SurfaceStateStore,
  createSurfaceRecord,
  type SurfaceRecord,
  type SurfaceStateStoreOptions,
} from './surface-state.store';

function content(surfaceId: string, pad = 8): SurfaceContent {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: `Surface ${surfaceId}` },
      components: [
        { kind: 'text', id: 'name', label: 'Name', path: 'form.name' },
      ],
    },
    dataModel: { form: { name: 'x'.repeat(pad) } },
  };
}

/** Same-width ids, so records of equal padding have equal byte counts. */
function sid(index: number): string {
  return `s${String(index).padStart(2, '0')}`;
}

function record(surfaceId: string, revision: number, pad = 8): SurfaceRecord {
  return createSurfaceRecord(surfaceId, content(surfaceId, pad), revision);
}

function bytesOf(value: SurfaceRecord): number {
  return (
    jsonUtf8Bytes(value.content) +
    jsonUtf8Bytes(value.selection) +
    jsonUtf8Bytes(value.lastSubmit) +
    jsonUtf8Bytes(value.writeLog)
  );
}

function newStore(options: SurfaceStateStoreOptions = {}) {
  return new SurfaceStateStore(options);
}

describe('SurfaceStateStore', () => {
  describe('reads and records', () => {
    it('returns undefined for an absent surface or another routing id', () => {
      const store = newStore();
      store.commit('tab-1', record('profile', 1));
      expect(store.get('tab-1', 'missing')).toBeUndefined();
      expect(store.get('tab-2', 'profile')).toBeUndefined();
      expect(store.list('tab-2')).toEqual([]);
    });

    it('creates a record whose incarnation and write-log floor are its creation revision', () => {
      const created = record('profile', 7);
      expect(created).toMatchObject({
        incarnation: 7,
        revision: 7,
        selection: null,
        lastSubmit: null,
        writeLog: { floor: 7, entries: [] },
      });
    });

    it('lists the surfaces of one routing id sorted by id', () => {
      const store = newStore();
      store.commit('tab-1', record('b', 1));
      store.commit('tab-1', record('a', 2));
      store.commit('tab-2', record('c', 3));
      expect(store.list('tab-1').map((entry) => entry.surfaceId)).toEqual([
        'a',
        'b',
      ]);
    });

    it('keeps the high-water revision through replace, delete and eviction', () => {
      const store = newStore({ limits: { maxSurfacesPerRoutingId: 1 } });
      store.commit('tab-1', record('a', 5));
      store.commit('tab-1', { ...record('a', 5), revision: 9 });
      expect(store.highWaterRevision).toBe(9);
      expect(store.delete('tab-1', 'a')?.revision).toBe(9);
      expect(store.highWaterRevision).toBe(9);
      store.commit('tab-1', record('b', 10));
      store.commit('tab-1', record('c', 11));
      expect(store.get('tab-1', 'b')).toBeUndefined();
      expect(store.highWaterRevision).toBe(11);
    });

    it('drops an emptied routing id and returns undefined for a missing delete', () => {
      const store = newStore();
      store.commit('tab-1', record('a', 1));
      expect(store.delete('tab-1', 'a')?.surfaceId).toBe('a');
      expect(store.delete('tab-1', 'a')).toBeUndefined();
      expect(store.usage()).toMatchObject({
        routingIds: 0,
        surfaces: 0,
        surfaceBytes: 0,
      });
    });
  });

  describe('byte accounting', () => {
    it('counts content with its data model, selection, last submit and write log', () => {
      const store = newStore();
      const lastSubmit: SurfaceSubmitRecord = {
        operationId: 'op-1700000000000-abcdefgh',
        actionId: 'send',
        scopeComponentId: 'form',
        baseRevision: 1,
        status: 'applied',
        submittedAt: 1_700_000_000_000,
        values: [{ componentId: 'name', path: 'form.name', value: 'Ada' }],
      };
      const full: SurfaceRecord = {
        ...record('a', 1),
        revision: 3,
        selection: { componentId: 'name', target: { kind: 'stat' } },
        lastSubmit,
        writeLog: appendWrite(record('a', 1).writeLog, {
          revision: 2,
          footprint: { kind: 'data', paths: ['form.name'] },
        }),
      };
      const result = store.commit('tab-1', full);
      expect(result).toMatchObject({ ok: true, bytes: bytesOf(full) });
      expect(store.usage().surfaceBytes).toBe(bytesOf(full));
    });

    it('replaces a record without double counting it', () => {
      const store = newStore();
      store.commit('tab-1', record('a', 1, 10));
      store.commit('tab-1', { ...record('a', 1, 500), revision: 2 });
      expect(store.usage().surfaceBytes).toBe(bytesOf(record('a', 1, 500)));
    });

    it('adds ledger charges and pending tickets to the total', () => {
      const charges = { chargedBytes: () => 3 * 1024 };
      const store = newStore({ charges });
      store.commit('tab-1', record('a', 1));
      expect(store.reserveTicket('tab-1', 'op-1', 2_000)).toEqual({
        ok: true,
        evicted: [],
      });
      expect(store.usage()).toMatchObject({
        ticketBytes: 2_000,
        chargedBytes: 3 * 1024,
        totalBytes: bytesOf(record('a', 1)) + 2_000 + 3 * 1024,
      });
      expect(store.releaseTicket('tab-1', 'op-1')).toBe(true);
      expect(store.releaseTicket('tab-1', 'op-1')).toBe(false);
      expect(store.usage().ticketBytes).toBe(0);
    });
  });

  describe('per-routing bound', () => {
    const max = SURFACE_STORE_LIMITS.maxSurfacesPerRoutingId;

    it('holds maxSurfacesPerRoutingId surfaces without evicting', () => {
      const store = newStore();
      for (let index = 0; index < max; index++) {
        const result = store.commit('tab-1', record(sid(index), index + 1));
        expect(result).toMatchObject({ ok: true, evicted: [] });
      }
      expect(store.list('tab-1')).toHaveLength(max);
    });

    it('evicts the least-recently-used surface of that routing id one over the bound', () => {
      const store = newStore();
      for (let index = 0; index < max; index++)
        store.commit('tab-1', record(sid(index), index + 1));
      store.commit('tab-2', record('other', 100));
      store.get('tab-1', sid(0)); // touch: s01 is now the LRU of tab-1
      const result = store.commit('tab-1', record('extra', 200));
      expect(result).toMatchObject({
        ok: true,
        evicted: [{ routingId: 'tab-1', surfaceId: sid(1) }],
      });
      expect(store.get('tab-1', sid(1))).toBeUndefined();
      expect(store.get('tab-1', sid(0))).toBeDefined();
      expect(store.get('tab-2', 'other')).toBeDefined();
    });
  });

  describe('routing bound', () => {
    const max = SURFACE_STORE_LIMITS.maxRoutingIds;

    it('holds maxRoutingIds routing ids without evicting', () => {
      const store = newStore();
      for (let index = 0; index < max; index++)
        expect(
          store.commit(`tab-${index}`, record('a', index + 1)),
        ).toMatchObject({
          ok: true,
          evicted: [],
        });
      expect(store.usage().routingIds).toBe(max);
    });

    it('evicts every surface of the least-recently-used routing id one over the bound', () => {
      const store = newStore();
      for (let index = 0; index < max; index++)
        store.commit(`tab-${index}`, record('a', index + 1));
      store.commit('tab-0', record('b', 50));
      store.list('tab-0'); // tab-1 is now the least recently used
      const result = store.commit('tab-new', record('a', 99));
      expect(result).toMatchObject({
        ok: true,
        evicted: [{ routingId: 'tab-1', surfaceId: 'a' }],
      });
      expect(store.get('tab-1', 'a')).toBeUndefined();
      expect(store.list('tab-1')).toEqual([]);
      expect(store.list('tab-0')).toHaveLength(2);
      expect(store.usage().routingIds).toBe(max);
    });
  });

  describe('byte bound', () => {
    const unit = bytesOf(record(sid(0), 1));

    it('holds records up to maxStoreBytes exactly', () => {
      const store = newStore({ limits: { maxStoreBytes: 3 * unit } });
      for (let index = 0; index < 3; index++)
        expect(
          store.commit('tab-1', record(sid(index), index + 1)),
        ).toMatchObject({
          ok: true,
          evicted: [],
        });
      expect(store.usage().totalBytes).toBe(3 * unit);
    });

    it('evicts the global least-recently-used surface one over, across routing ids', () => {
      const store = newStore({ limits: { maxStoreBytes: 3 * unit } });
      store.commit('tab-1', record(sid(0), 1));
      store.commit('tab-2', record(sid(1), 2));
      store.commit('tab-1', record(sid(2), 3));
      const result = store.commit('tab-3', record(sid(3), 4));
      expect(result).toMatchObject({
        ok: true,
        evicted: [{ routingId: 'tab-1', surfaceId: sid(0) }],
      });
      expect(store.get('tab-1', sid(0))).toBeUndefined();
      expect(store.usage().totalBytes).toBe(3 * unit);
    });

    it('never evicts the record being committed, even when it is the oldest', () => {
      const store = newStore({ limits: { maxStoreBytes: 2 * unit + 50 } });
      store.commit('tab-1', record(sid(0), 1));
      store.commit('tab-1', record(sid(1), 2));
      // Re-commit s00 larger: it is the one that no longer fits, but others go.
      const result = store.commit('tab-1', {
        ...record(sid(0), 1, 100),
        revision: 3,
      });
      expect(result).toMatchObject({
        ok: true,
        evicted: [{ routingId: 'tab-1', surfaceId: sid(1) }],
      });
      expect(store.get('tab-1', sid(0))?.revision).toBe(3);
    });

    it('refuses a commit that cannot fit even alone, changing nothing', () => {
      const charged = { bytes: 0 };
      const store = newStore({
        limits: { maxStoreBytes: 2 * unit },
        charges: { chargedBytes: () => charged.bytes },
      });
      store.commit('tab-1', record(sid(0), 1));
      charged.bytes = unit + 1;
      const before = store.usage();
      expect(store.commit('tab-2', record(sid(1), 2))).toMatchObject({
        ok: false,
        reason: 'budget',
      });
      expect(store.usage()).toEqual(before);
      expect(store.highWaterRevision).toBe(1);
    });
  });

  describe('reservations', () => {
    const unit = bytesOf(record(sid(0), 1));

    it('counts a pending ticket and evicts surfaces to make room for it', () => {
      const store = newStore({ limits: { maxStoreBytes: 3 * unit } });
      store.commit('tab-1', record(sid(0), 1));
      store.commit('tab-1', record(sid(1), 2));
      store.commit('tab-1', record(sid(2), 3));
      const result = store.reserveTicket('tab-1', 'op-a', unit, {
        routingId: 'tab-1',
        surfaceId: sid(0),
      });
      expect(result).toEqual({
        ok: true,
        evicted: [{ routingId: 'tab-1', surfaceId: sid(1) }],
      });
      expect(store.usage()).toMatchObject({
        ticketBytes: unit,
        totalBytes: 3 * unit,
      });
      // With the ticket held, a new surface must evict another one.
      const commit = store.commit('tab-1', record(sid(3), 4));
      expect(commit).toMatchObject({
        ok: true,
        evicted: [{ surfaceId: sid(0) }],
      });
    });

    it('refuses a reservation over the byte cap, evicting nothing', () => {
      const store = newStore({
        limits: { maxStoreBytes: 3 * unit },
        charges: { chargedBytes: () => unit },
      });
      store.commit('tab-1', record(sid(0), 1));
      store.commit('tab-1', record(sid(1), 2));
      // cap 3u, charges 1u, protected s00 1u: at most 1u can be reserved.
      const protect = { routingId: 'tab-1', surfaceId: sid(0) };
      expect(
        store.reserveTicket('tab-1', 'op-b', unit + 1, protect),
      ).toMatchObject({
        ok: false,
        reason: 'too-many-operations',
      });
      expect(store.usage()).toMatchObject({ surfaces: 2, ticketBytes: 0 });
      expect(store.reserveTicket('tab-1', 'op-b', unit, protect)).toMatchObject(
        {
          ok: true,
          evicted: [{ surfaceId: sid(1) }],
        },
      );
    });

    it('refuses a second reservation for the same operation', () => {
      const store = newStore();
      expect(store.reserveTicket('tab-1', 'op-c', 10).ok).toBe(true);
      expect(store.reserveTicket('tab-1', 'op-c', 10)).toMatchObject({
        ok: false,
        reason: 'too-many-operations',
      });
      expect(store.reserveTicket('tab-2', 'op-c', 10).ok).toBe(true);
      expect(store.usage().ticketBytes).toBe(20);
    });

    it('evicts surfaces for ledger charges through the admission callback', () => {
      const ledger = new SurfaceOperationLedger({
        clock: () => 1_700_000_000_000,
      });
      const recordBytes = SURFACE_STORE_LIMITS.operationRecordBytes;
      // Surfaces larger than one ledger charge, so one eviction frees enough.
      const big = bytesOf(record(sid(0), 1, 1_100));
      expect(big).toBeGreaterThan(recordBytes);
      const store = newStore({
        limits: { maxStoreBytes: 2 * big + recordBytes },
        charges: ledger,
      });
      store.commit('tab-1', record(sid(0), 1, 1_100));
      store.commit('tab-1', record(sid(1), 2, 1_100));
      const evicted: string[] = [];
      const admit = (bytes: number): boolean => {
        const room = store.makeRoom(bytes);
        if (room.ok)
          evicted.push(...room.evicted.map((pair) => pair.surfaceId));
        return room.ok;
      };
      const reserve = (nonce: string) =>
        ledger.reserve(
          'tab-1',
          {
            operationId: `op-1700000000000-${nonce}`,
            kind: 'change',
            surfaceId: sid(0),
            incarnation: 1,
            fingerprint: nonce,
          },
          admit,
        );
      expect(reserve('first001').outcome).toBe('reserved');
      expect(evicted).toEqual([]);
      expect(reserve('second01').outcome).toBe('reserved');
      expect(evicted).toEqual([sid(0)]);
      expect(store.usage()).toMatchObject({
        chargedBytes: 2 * recordBytes,
        surfaces: 1,
      });
    });
  });
});
