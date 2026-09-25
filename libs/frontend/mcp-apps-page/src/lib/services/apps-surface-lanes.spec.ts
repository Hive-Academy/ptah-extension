import { RpcResult, type RpcCallOptions } from '@ptah-extension/core';
import { createMockRpcService, rpcSuccess } from '@ptah-extension/core/testing';
import type { RpcUserErrorCode } from '@ptah-extension/shared';
import type {
  SurfaceComponent,
  SurfaceSelection,
  SurfaceStateView,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import {
  createAppsSurfaceState,
  updateSurfaceOverlays,
  type AppsSurfaceEntry,
  type AppsSurfaceState,
} from '../state/apps-surface-reducer';
import {
  APPS_CHANGE_TEXT,
  APPS_ECHO_WAIT_LIMIT_MS,
  APPS_SELECTION_NOTICE_PREFIX,
  AppsSurfaceLanes,
  type AppsLaneHost,
} from './apps-surface-lanes';
import { APPS_ECHO_GRACE_MS, AppsSurfaceSync } from './apps-surface-sync';

/**
 * `AppsSurfaceLanes` against the REAL `AppsSurfaceSync` and reducer, with a
 * scripted RPC (real timeout and abort timing) and a recording host. The
 * store re-pumps the lanes on every surface write, as the facade's effect
 * does. Every spec also checks that no mutation was sent on a base below the
 * highest acknowledged (expected) revision.
 */

const ROUTING = 'tab-lanes';
const SURFACE = 'profile';
const ROW: SurfaceSelection = {
  componentId: 'rows',
  target: { kind: 'table-row', rowIndex: 1 },
};

const COMPONENTS = [
  {
    kind: 'card',
    id: 'form',
    children: [{ kind: 'text', id: 'name', label: 'Name', path: 'form.name' }],
  },
] as unknown as SurfaceComponent[];

function view(revision: number, name = 'Ada'): SurfaceStateView {
  return {
    surfaceId: SURFACE,
    revision,
    content: {
      contract: 'dashboard-spec/2',
      surface: {
        schemaVersion: 'dashboard-spec/2',
        catalogVersion: 'dashboard-catalog/2',
        surfaceId: SURFACE,
        title: { text: 'Profile' },
        components: COMPONENTS,
      },
      dataModel: { form: { name } },
    },
    selection: null,
    lastSubmit: null,
  };
}

interface Call {
  readonly method: string;
  readonly params: Record<string, unknown>;
  /** Highest acknowledged revision when a mutation was sent. */
  readonly ackedAtSend: number;
  done: boolean;
  resolve(result: RpcResult<unknown>): void;
}

const failure = (error: string, code?: RpcUserErrorCode) =>
  new RpcResult<unknown>(false, undefined, error, code);

describe('AppsSurfaceLanes', () => {
  let calls: Call[];
  let state: AppsSurfaceState;
  let shown: boolean;
  let submitting: boolean;
  let acked: number;
  let issues: Map<string, string>;
  let unsynced: string[];
  let settled: jest.Mock;
  let warn: jest.SpyInstance;
  let sync: AppsSurfaceSync;
  let lanes: AppsSurfaceLanes;

  function scriptedCall(
    method: string,
    params: Record<string, unknown>,
    options?: RpcCallOptions,
  ): Promise<RpcResult<unknown>> {
    return new Promise((resolve) => {
      const call: Call = {
        method,
        params,
        ackedAtSend: acked,
        done: false,
        resolve: (result) => {
          if (call.done) return;
          call.done = true;
          clearTimeout(timer);
          resolve(result);
        },
      };
      const timer = setTimeout(
        () => call.resolve(failure(`RPC timeout: ${method}`)),
        options?.timeout ?? 30_000,
      );
      options?.signal?.addEventListener(
        'abort',
        () => call.resolve(failure(`RPC aborted: ${method}`)),
        { once: true },
      );
      calls.push(call);
    });
  }

  const callsOf = (method: string) =>
    calls.filter((call) => call.method === method);

  function open(method: string): Call {
    const call = callsOf(method).find((candidate) => !candidate.done);
    if (call === undefined) throw new Error(`no open ${method} call`);
    return call;
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  }

  async function answer(
    method: string,
    result: RpcResult<unknown>,
  ): Promise<void> {
    open(method).resolve(result);
    await flush();
  }

  const reply = (method: string, data: unknown) =>
    answer(method, rpcSuccess(data));
  const applied = (revision: number) =>
    reply('surface:change', { status: 'applied', operationId: 'x', revision });
  const readFails = () =>
    answer('surface:read', failure('Read failed.', 'INTERNAL_ERROR'));

  function push(
    revision: number,
    update: Record<string, unknown>,
    origin = 'agent',
  ): void {
    sync.onPush({
      routingId: ROUTING,
      surfaceId: SURFACE,
      revision,
      origin,
      change: update,
    });
  }

  const echo = (fromRevision: number, revision: number, name: string) =>
    push(
      revision,
      {
        kind: 'ops',
        fromRevision,
        ops: [{ op: 'set-data', path: 'form.name', value: name }],
      },
      'ui',
    );

  function entry(): AppsSurfaceEntry {
    const held = state.entries.get(SURFACE);
    if (held === undefined) throw new Error('surface not held');
    return held;
  }

  const overlayValues = () =>
    entry()
      .overlays.list()
      .map((overlay) => overlay.value);

  const change = (value: string) =>
    lanes.change(
      SURFACE,
      'name',
      'form.name',
      value,
      entry().materializedRevision,
    );

  /** Waits past the limit, failing every read the lane or the sync asks for. */
  async function failReadsPastLimit(): Promise<void> {
    const ticks = Math.ceil(APPS_ECHO_WAIT_LIMIT_MS / APPS_ECHO_GRACE_MS) + 1;
    for (let tick = 0; tick < ticks; tick += 1) {
      await jest.advanceTimersByTimeAsync(APPS_ECHO_GRACE_MS);
      while (callsOf('surface:read').some((call) => !call.done))
        await readFails();
    }
  }

  beforeEach(() => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    calls = [];
    state = createAppsSurfaceState();
    shown = true;
    submitting = false;
    acked = 0;
    issues = new Map();
    unsynced = [];
    settled = jest.fn();
    const rpc = createMockRpcService();
    (rpc.call as jest.Mock).mockImplementation(scriptedCall);
    sync = new AppsSurfaceSync(rpc, ROUTING, {
      surfaces: () => state,
      // The facade's effect: every surface write re-pumps the lanes.
      setSurfaces: (next) => {
        state = next;
        lanes.pumpAll();
      },
      setSyncNotice: () => undefined,
    });
    const host: AppsLaneHost = {
      entry: (surfaceId) =>
        shown ? (state.entries.get(surfaceId) ?? null) : null,
      isShown: () => shown,
      updateOverlays: (surfaceId, update) => {
        state = updateSurfaceOverlays(state, surfaceId, update);
      },
      expectRevision: (surfaceId, revision) => {
        acked = Math.max(acked, revision);
        sync.expectRevision(surfaceId, revision);
      },
      requestRead: () => sync.requestRead('stale-revision'),
      setIssue: (_surfaceId, componentId, message) =>
        issues.set(componentId, message),
      patchSelection: () => undefined,
      markUnsynced: (_surfaceId, _operationId, notice) => unsynced.push(notice),
      settled,
      isSubmitting: () => submitting,
    };
    lanes = new AppsSurfaceLanes(rpc, ROUTING, host);
    push(1, { kind: 'snapshot', state: view(1) });
  });

  afterEach(() => {
    // Own writes never conflict: no base below an acknowledged revision.
    for (const call of calls) {
      if (call.method === 'surface:change' || call.method === 'surface:select')
        expect(call.params['revision']).toBeGreaterThanOrEqual(
          call.ackedAtSend,
        );
    }
    lanes.dispose();
    sync.dispose();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('echo wait (Rule 3; own writes never conflict)', () => {
    it('the grace read fails, a later tick reads, and the queued change sends on the NEW base', async () => {
      change('A');
      change('B'); // A is in flight: B queues behind it
      await applied(2);
      expect(callsOf('surface:change')).toHaveLength(1);

      await jest.advanceTimersByTimeAsync(APPS_ECHO_GRACE_MS);
      expect(callsOf('surface:read')).toHaveLength(1); // the sync's grace read
      await readFails();
      expect(callsOf('surface:read')).toHaveLength(1); // the sync does not re-arm

      await jest.advanceTimersByTimeAsync(APPS_ECHO_GRACE_MS);
      expect(callsOf('surface:read')).toHaveLength(2); // the lane's own read
      expect(callsOf('surface:change')).toHaveLength(1);

      await reply('surface:read', {
        status: 'found',
        routingId: ROUTING,
        surfaces: [view(2, 'A')],
      });
      expect(entry().materializedRevision).toBe(2);
      const second = open('surface:change');
      expect(second.params['value']).toBe('B');
      expect(second.params['revision']).toBe(entry().materializedRevision);
      expect(second.params['revision']).toBe(2);
      expect(jest.getTimerCount()).toBe(1); // only the open change's RPC timer
    });

    it('reads keep failing until the limit: nothing more is sent, the overlays retire, the notices show', async () => {
      change('A');
      change('B-unsaved');
      lanes.select(SURFACE, 'op-select-1', ROW);
      await applied(2);

      await failReadsPastLimit();

      expect(callsOf('surface:change')).toHaveLength(1);
      expect(callsOf('surface:select')).toHaveLength(0);
      expect(callsOf('surface:read').length).toBeGreaterThan(2);
      // A stays settled at 2 until its echo; B retired unsent.
      expect(overlayValues()).toEqual(['A']);
      expect(issues.get('name')).toBe(APPS_CHANGE_TEXT.notSynced);
      expect(unsynced).toEqual([
        `${APPS_SELECTION_NOTICE_PREFIX}the page could not confirm the latest state of this app.`,
      ]);
      expect(lanes.isPending(SURFACE, 'op-select-1')).toBe(false);
      expect(lanes.syncState(SURFACE)).toBe('behind');
      expect(settled).toHaveBeenCalled();
      expect(jest.getTimerCount()).toBe(0);
      for (const args of warn.mock.calls)
        expect(args.map(String).join(' ')).not.toContain('B-unsaved');

      // The expected revision stays: a later change waits again, never stale.
      change('C');
      expect(callsOf('surface:change')).toHaveLength(1);
      echo(1, 2, 'A');
      await flush();
      expect(open('surface:change').params).toEqual(
        expect.objectContaining({ value: 'C', revision: 2 }),
      );
    });

    it('an echo during the wait sends at once and releases the wait tick', async () => {
      change('A');
      change('B');
      await applied(2);
      echo(1, 2, 'A');
      await flush();

      expect(open('surface:change').params['revision']).toBe(2);
      expect(callsOf('surface:read')).toHaveLength(0);
      expect(jest.getTimerCount()).toBe(1); // only the open change's RPC timer
    });
  });

  describe('workspace switch (not shown)', () => {
    it('pauses a queued change with no timer, and resumes it on the materialized base when shown', async () => {
      change('A');
      change('B');
      await applied(2);
      shown = false;
      echo(1, 2, 'A'); // lands while another workspace is shown
      await flush();

      expect(callsOf('surface:change')).toHaveLength(1);
      expect(lanes.syncState(SURFACE)).toBe('draining');
      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(APPS_ECHO_WAIT_LIMIT_MS * 2);
      expect(callsOf('surface:change')).toHaveLength(1);
      expect(issues.size).toBe(0); // a paused queue is never dropped

      shown = true;
      lanes.pumpAll();
      const resumed = open('surface:change');
      expect(resumed.params['value']).toBe('B');
      expect(resumed.params['revision']).toBe(2);
    });
  });

  describe('surface gone', () => {
    it('deletes the lane: the queue is dropped unsent and nothing waits', async () => {
      change('A');
      change('B');
      await applied(2);
      push(2, { kind: 'deleted', reason: 'agent-deleted' });
      await flush();

      expect(state.entries.has(SURFACE)).toBe(false);
      expect(lanes.syncState(SURFACE)).toBe('settled');
      await jest.advanceTimersByTimeAsync(APPS_ECHO_GRACE_MS);
      await reply('surface:read', {
        status: 'found',
        routingId: ROUTING,
        surfaces: [],
      });
      await jest.advanceTimersByTimeAsync(APPS_ECHO_WAIT_LIMIT_MS * 2);

      expect(callsOf('surface:change')).toHaveLength(1);
      expect(issues.size).toBe(0); // its input went with the surface
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('submit in flight (symmetric serialization)', () => {
    it('holds a change while the surface submits, then sends it on the materialized base', async () => {
      submitting = true;
      change('A');
      expect(callsOf('surface:change')).toHaveLength(0);
      expect(lanes.syncState(SURFACE)).toBe('draining');
      expect(jest.getTimerCount()).toBe(0);

      push(3, { kind: 'snapshot', state: view(3, 'Agent') }); // the submit's turn
      await jest.advanceTimersByTimeAsync(APPS_ECHO_WAIT_LIMIT_MS * 2);
      expect(callsOf('surface:change')).toHaveLength(0);
      expect(overlayValues()).toEqual(['A']);

      submitting = false;
      lanes.pumpAll(); // the facade's `submitEnded`
      const sent = open('surface:change');
      expect(sent.params['revision']).toBe(3);
      expect(sent.params['revision']).toBe(entry().materializedRevision);
    });

    it('holds a select too, then sends it on the materialized base', async () => {
      submitting = true;
      lanes.select(SURFACE, 'op-select-1', ROW);
      expect(callsOf('surface:select')).toHaveLength(0);
      expect(lanes.isPending(SURFACE, 'op-select-1')).toBe(true);

      submitting = false;
      lanes.pumpAll();
      expect(open('surface:select').params['revision']).toBe(1);
    });
  });

  describe('dispose', () => {
    it('clears the wait tick and aborts the mutation in flight', async () => {
      change('A');
      change('B');
      await applied(2);
      change('C'); // replaces B in the queue
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      lanes.dispose();
      sync.dispose();
      await flush();

      expect(jest.getTimerCount()).toBe(0);
      await jest.advanceTimersByTimeAsync(APPS_ECHO_WAIT_LIMIT_MS * 2);
      expect(callsOf('surface:change')).toHaveLength(1);
    });
  });
});
