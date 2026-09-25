import { RpcResult, type RpcCallOptions } from '@ptah-extension/core';
import type {
  SurfaceComponent,
  SurfaceContent,
  SurfaceStateView,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { makeTable } from '@ptah-extension/shared/testing';
import { createAppsSurfaceState } from '../state/apps-surface-reducer';
import type { AppsSurfaceState } from '../state/apps-surface-reducer';
import {
  APPS_ECHO_GRACE_MS,
  APPS_REFRESH_FAILED_NOTICE,
  APPS_SURFACE_READ_TIMEOUT_MS,
  AppsSurfaceSync,
} from './apps-surface-sync';
import type { AppsSurfaceRpc, AppsSurfaceStore } from './apps-surface-sync';

const ROUTING_ID = 'tab-apps';

function content(surfaceId: string, name = 'Ada'): SurfaceContent {
  const nameInput: SurfaceComponent = {
    kind: 'text',
    id: 'name',
    label: 'Name',
    path: 'form.name',
  };
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: 'Profile' },
      components: [makeTable(3, 2) as SurfaceComponent, nameInput],
    },
    dataModel: { form: { name } },
  };
}

function view(surfaceId: string, revision: number): SurfaceStateView {
  return {
    surfaceId,
    revision,
    content: content(surfaceId),
    selection: null,
    lastSubmit: null,
  };
}

function snapshot(surfaceId: string, revision: number, routingId = ROUTING_ID) {
  return {
    routingId,
    surfaceId,
    revision,
    origin: 'agent',
    change: { kind: 'snapshot', state: view(surfaceId, revision) },
  };
}

function gapOps(surfaceId: string, fromRevision: number, revision: number) {
  return {
    routingId: ROUTING_ID,
    surfaceId,
    revision,
    origin: 'agent',
    change: {
      kind: 'ops',
      fromRevision,
      ops: [{ op: 'set-data', path: 'form.name', value: 'Grace' }],
    },
  };
}

function found(...surfaces: SurfaceStateView[]) {
  return { status: 'found', routingId: ROUTING_ID, surfaces };
}

interface PendingRead {
  readonly method: string;
  readonly params: unknown;
  readonly options: RpcCallOptions | undefined;
  resolve(result: RpcResult<unknown>): void;
}

/**
 * Deferred `ClaudeRpcService.call`: every call stays pending until the spec
 * resolves it, and the mock tracks how many calls are open at once.
 */
function createDeferredRpc() {
  const pending: PendingRead[] = [];
  let open = 0;
  let maxOpen = 0;
  const call = jest.fn(
    (method: string, params: unknown, options?: RpcCallOptions) =>
      new Promise<RpcResult<unknown>>((resolve) => {
        open += 1;
        maxOpen = Math.max(maxOpen, open);
        pending.push({
          method,
          params,
          options,
          resolve: (result) => {
            open -= 1;
            resolve(result);
          },
        });
      }),
  );
  return {
    rpc: { call } as unknown as AppsSurfaceRpc,
    call,
    pending,
    maxOpen: () => maxOpen,
    open: () => open,
  };
}

/**
 * Mirrors `ClaudeRpcService.call` timing (claude-rpc.service.ts:145-199):
 * resolves `RPC timeout: <method>` when `options.timeout` elapses, and
 * resolves `RPC aborted` (clearing its timer) when the signal aborts.
 */
function createTimingRpc() {
  const call = jest.fn(
    (method: string, _params: unknown, options?: RpcCallOptions) =>
      new Promise<RpcResult<unknown>>((resolve) => {
        const timer = setTimeout(
          () =>
            resolve(new RpcResult(false, undefined, `RPC timeout: ${method}`)),
          options?.timeout ?? 30_000,
        );
        options?.signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            resolve(new RpcResult(false, undefined, `RPC aborted: ${method}`));
          },
          { once: true },
        );
      }),
  );
  return { rpc: { call } as unknown as AppsSurfaceRpc, call };
}

function createStore(initial: AppsSurfaceState = createAppsSurfaceState()) {
  const box = { state: initial, notice: null as string | null, writes: 0 };
  const store: AppsSurfaceStore = {
    surfaces: () => box.state,
    setSurfaces: (next) => {
      box.writes += 1;
      box.state = next;
    },
    setSyncNotice: (notice) => {
      box.notice = notice;
    },
  };
  return { store, box };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve();
}

function ok(data: unknown): RpcResult<unknown> {
  return new RpcResult(true, data);
}

describe('AppsSurfaceSync', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
    warn.mockRestore();
  });

  describe('push intake', () => {
    it('applies a push for its own routing id through the reducer', () => {
      const { rpc } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);

      sync.onPush(snapshot('profile', 1));

      expect(box.state.entries.get('profile')?.materializedRevision).toBe(1);
      expect(box.state.activeSurfaceId).toBe('profile');
    });

    it('drops a push for another routing id before the reducer sees it', () => {
      const { rpc, call } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      const before = box.state;

      sync.onPush(snapshot('profile', 1, 'tab-someone-else'));
      sync.onPush({ surfaceId: 'profile', revision: 1 });
      sync.onPush(null);

      expect(box.state).toBe(before);
      expect(box.writes).toBe(0);
      expect(call).not.toHaveBeenCalled();
    });

    it('a malformed push changes nothing and logs no payload value', () => {
      const { rpc } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      const before = box.state;

      sync.onPush({
        routingId: ROUTING_ID,
        surfaceId: 'secret-value',
        revision: -1,
      });

      expect(box.state).toBe(before);
      for (const [message] of warn.mock.calls) {
        expect(String(message)).not.toContain('secret-value');
      }
    });

    it('a gap push requests a surface:read of its routing id with a 10 s timeout', () => {
      const { rpc, call, pending } = createDeferredRpc();
      const { store } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));

      sync.onPush(gapOps('profile', 3, 4));

      expect(call).toHaveBeenCalledTimes(1);
      expect(pending[0].method).toBe('surface:read');
      expect(pending[0].params).toEqual({ routingId: ROUTING_ID });
      expect(pending[0].options?.timeout).toBe(APPS_SURFACE_READ_TIMEOUT_MS);
      expect(pending[0].options?.signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('read coordination', () => {
    it('coalesces read requests made while one is in flight into ONE follow-up read', async () => {
      const { rpc, call, pending } = createDeferredRpc();
      const { store } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);

      sync.requestRead('needs-read');
      sync.requestRead('needs-read');
      sync.requestRead('stale-revision');
      sync.requestRead('echo-missing');
      expect(call).toHaveBeenCalledTimes(1);

      pending[0].resolve(ok(found(view('profile', 2))));
      await flush();
      expect(call).toHaveBeenCalledTimes(2);

      pending[1].resolve(ok(found(view('profile', 2))));
      await flush();
      expect(call).toHaveBeenCalledTimes(2);
      expect(sync.isReading).toBe(false);
    });

    it('keeps AT MOST ONE surface:read in flight per slice (B11 F7)', async () => {
      const deferred = createDeferredRpc();
      const { store } = createStore();
      const sync = new AppsSurfaceSync(deferred.rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));

      // Every trigger kind, repeatedly, while reads are open.
      for (let round = 0; round < 3; round += 1) {
        sync.onPush(gapOps('profile', 7, 8));
        sync.requestRead('stale-revision');
        sync.onPush(gapOps('missing', 1, 2));
        sync.expectRevision('profile', 50 + round);
        jest.advanceTimersByTime(APPS_ECHO_GRACE_MS);
        expect(deferred.open()).toBeLessThanOrEqual(1);
        const next = deferred.pending[deferred.pending.length - 1];
        next.resolve(ok(found(view('profile', 1))));
        await flush();
      }
      while (deferred.open() > 0) {
        deferred.pending[deferred.pending.length - 1].resolve(
          ok(found(view('profile', 1))),
        );
        await flush();
      }

      expect(deferred.maxOpen()).toBe(1);
      expect(deferred.call.mock.calls.length).toBeGreaterThan(1);
    });

    it('drops the stale part of a read result via readSeq: a push applied after the read was sent survives', async () => {
      const { rpc, pending } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));

      sync.requestRead('needs-read');
      // Arrives after the read was SENT, before its result.
      sync.onPush(snapshot('orders', 1));
      pending[0].resolve(ok(found(view('profile', 1))));
      await flush();

      expect(box.state.entries.has('orders')).toBe(true);
      expect(box.state.entries.get('profile')?.materializedRevision).toBe(1);
    });

    it('a failed read keeps the last good view, sets the notice, and the next trigger retries', async () => {
      const { rpc, call, pending } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));
      const before = box.state;

      sync.requestRead('needs-read');
      pending[0].resolve(
        new RpcResult(false, undefined, 'boom', 'INTERNAL_ERROR'),
      );
      await flush();

      expect(box.state).toBe(before);
      expect(box.notice).toBe(APPS_REFRESH_FAILED_NOTICE);
      expect(call).toHaveBeenCalledTimes(1);

      sync.requestRead('needs-read');
      pending[1].resolve(ok(found(view('profile', 3))));
      await flush();
      expect(box.notice).toBeNull();
      expect(box.state.entries.get('profile')?.materializedRevision).toBe(3);
    });

    it('a malformed read result is treated as a failed read', async () => {
      const { rpc, pending } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));
      const before = box.state;

      sync.requestRead('needs-read');
      pending[0].resolve(ok({ status: 'found', routingId: ROUTING_ID }));
      await flush();

      expect(box.state).toBe(before);
      expect(box.notice).toBe(APPS_REFRESH_FAILED_NOTICE);
    });

    it('a read timeout leaves the slice consistent and the next read goes out', async () => {
      const { rpc, call } = createTimingRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 2));
      const before = box.state;

      sync.requestRead('needs-read');
      sync.requestRead('needs-read'); // coalesced follow-up
      expect(call).toHaveBeenCalledTimes(1);
      expect(call.mock.calls[0][2]?.timeout).toBe(APPS_SURFACE_READ_TIMEOUT_MS);

      await jest.advanceTimersByTimeAsync(APPS_SURFACE_READ_TIMEOUT_MS);

      expect(box.state).toBe(before);
      expect(box.state.entries.get('profile')?.materializedRevision).toBe(2);
      expect(box.notice).toBe(APPS_REFRESH_FAILED_NOTICE);
      // The coalesced trigger is the retry: exactly one more read.
      expect(call).toHaveBeenCalledTimes(2);
      expect(sync.isReading).toBe(true);

      sync.dispose();
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('Rule 3 grace timer', () => {
    it('an acknowledged revision never materializes by itself (Rules 1-2)', () => {
      const { rpc } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));
      const before = box.state;

      sync.expectRevision('profile', 2);

      expect(box.state).toBe(before);
      expect(box.state.entries.get('profile')?.materializedRevision).toBe(1);
      expect(sync.expectedRevision('profile')).toBe(2);
    });

    it('fires exactly one read when the echo is lost (reconciliation case 5)', async () => {
      const { rpc, call, pending } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));

      sync.expectRevision('profile', 2);
      sync.expectRevision('profile', 3); // re-arm, never a second timer
      expect(jest.getTimerCount()).toBe(1);

      jest.advanceTimersByTime(APPS_ECHO_GRACE_MS - 1);
      expect(call).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(call).toHaveBeenCalledTimes(1);
      expect(sync.isGraceArmed).toBe(false);

      pending[0].resolve(ok(found(view('profile', 3))));
      await flush();
      jest.advanceTimersByTime(
        APPS_SURFACE_READ_TIMEOUT_MS + APPS_ECHO_GRACE_MS,
      );

      expect(call).toHaveBeenCalledTimes(1);
      expect(box.state.entries.get('profile')?.materializedRevision).toBe(3);
      expect(sync.expectedRevision('profile')).toBeNull();
      expect(jest.getTimerCount()).toBe(0);
    });

    it('is cleared when the echo catches the view up, and no read is sent', () => {
      const { rpc, call } = createDeferredRpc();
      const { store } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));

      sync.expectRevision('profile', 2);
      expect(sync.isGraceArmed).toBe(true);
      sync.onPush(snapshot('profile', 2)); // the echo

      expect(sync.isGraceArmed).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      jest.advanceTimersByTime(APPS_ECHO_GRACE_MS * 2);
      expect(call).not.toHaveBeenCalled();
    });

    it('is never armed when the echo arrived before the result (case 2)', () => {
      const { rpc } = createDeferredRpc();
      const { store } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 2));

      sync.expectRevision('profile', 2);

      expect(sync.isGraceArmed).toBe(false);
      expect(sync.expectedRevision('profile')).toBeNull();
    });
  });

  describe('dispose', () => {
    it('leaves no timer and sends no read after dispose()', async () => {
      const { rpc, call } = createTimingRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.onPush(snapshot('profile', 1));
      sync.requestRead('needs-read'); // in flight, holds an RPC timer
      sync.requestRead('needs-read'); // queued follow-up
      sync.expectRevision('profile', 2); // grace armed
      expect(jest.getTimerCount()).toBe(2);
      const signal = call.mock.calls[0][2]?.signal;

      sync.dispose();

      expect(signal?.aborted).toBe(true);
      expect(jest.getTimerCount()).toBe(0);
      const stateAfterDispose = box.state;
      await jest.advanceTimersByTimeAsync(
        APPS_SURFACE_READ_TIMEOUT_MS + APPS_ECHO_GRACE_MS + 1,
      );
      sync.requestRead('needs-read');
      sync.expectRevision('profile', 9);
      sync.onPush(snapshot('profile', 5));
      await flush();

      expect(call).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
      expect(box.state).toBe(stateAfterDispose);
      expect(box.notice).toBeNull();
      expect(sync.isReading).toBe(false);
      expect(sync.isDisposed).toBe(true);
    });

    it('ignores a read result that lands after dispose()', async () => {
      const { rpc, pending } = createDeferredRpc();
      const { store, box } = createStore();
      const sync = new AppsSurfaceSync(rpc, ROUTING_ID, store);
      sync.requestRead('needs-read');

      sync.dispose();
      pending[0].resolve(ok(found(view('profile', 4))));
      await flush();

      expect(box.state.entries.size).toBe(0);
      expect(box.notice).toBeNull();
    });
  });
});
