import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ClaudeRpcService,
  EffortStateService,
  ModelStateService,
  RpcResult,
  type RpcCallOptions,
} from '@ptah-extension/core';
import { createMockRpcService, rpcSuccess } from '@ptah-extension/core/testing';
import {
  ConversationRegistry,
  SessionLivenessRegistry,
  TabManagerService,
  TabSessionBinding,
} from '@ptah-extension/chat-state';
import { StreamRouter, SurfaceUpdateInbox } from '@ptah-extension/chat-routing';
import { MESSAGE_TYPES, type RpcUserErrorCode } from '@ptah-extension/shared';
import { SURFACE_OPERATION_ID_PATTERN } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceComponent,
  SurfaceSelection,
  SurfaceStateView,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import { makeTable } from '@ptah-extension/shared/testing';
import type { AppsSurfaceEntry } from '../state/apps-surface-reducer';
import { AppsSessionService } from './apps-session.service';
import {
  APPS_CHANGE_TEXT,
  APPS_ECHO_WAIT_LIMIT_MS,
  APPS_MUTATION_TIMEOUT_MS,
  APPS_SELECTION_NOTICE_PREFIX,
} from './apps-surface-lanes';
import { AppsSurfaceOperations } from './apps-surface-operations.service';
import { APPS_ECHO_GRACE_MS } from './apps-surface-sync';

const SURFACE = 'profile';
const row = (rowIndex: number): SurfaceSelection => ({
  componentId: 'slowest-tests',
  target: { kind: 'table-row', rowIndex },
});
const ROW_1 = row(1);
const ROW_2 = row(2);

const COMPONENTS = [
  {
    ...makeTable(3, 2),
    actions: [
      { id: 'pick', action: 'dashboard.select', label: { text: 'Pick' } },
    ],
  },
  {
    kind: 'card',
    id: 'form',
    children: [{ kind: 'text', id: 'name', label: 'Name', path: 'form.name' }],
    actions: [
      { id: 'send', action: 'surface.submit', label: { text: 'Send' } },
    ],
  },
] as unknown as SurfaceComponent[];

function view(
  revision: number,
  name = 'Ada',
  selection: SurfaceSelection | null = null,
): SurfaceStateView {
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
    selection,
    lastSubmit: null,
  };
}

interface Call {
  readonly method: string;
  readonly params: Record<string, unknown>;
  readonly options: RpcCallOptions | undefined;
  /** Highest acknowledged (expected) revision when the call was made. */
  readonly ackedAtSend: number;
  done: boolean;
  resolve(result: RpcResult<unknown>): void;
}

const applied = (revision: number) => ({
  status: 'applied',
  operationId: 'op',
  revision,
});

const failure = (error: string, code?: RpcUserErrorCode) =>
  new RpcResult<unknown>(false, undefined, error, code);

describe('AppsSurfaceOperations', () => {
  let calls: Call[];
  let session: AppsSessionService;
  let ops: AppsSurfaceOperations;
  let inbox: SurfaceUpdateInbox;
  let routingId: string;
  let warn: jest.SpyInstance;
  let acked: number;

  /** Scripted `ClaudeRpcService.call`: open until answered; real timeout/abort. */
  function scriptedCall(
    method: string,
    params: Record<string, unknown>,
    options?: RpcCallOptions,
  ): Promise<RpcResult<unknown>> {
    return new Promise((resolve) => {
      const call: Call = {
        method,
        params,
        options,
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
      const abort = () => call.resolve(failure(`RPC aborted: ${method}`));
      options?.signal?.addEventListener('abort', abort, { once: true });
      calls.push(call);
      if (method === 'chat:start') call.resolve(rpcSuccess({ success: true }));
    });
  }

  function callsOf(method: string): Call[] {
    return calls.filter((call) => call.method === method);
  }

  function open(method: string): Call {
    const call = callsOf(method).find((candidate) => !candidate.done);
    if (call === undefined) throw new Error(`no open ${method} call`);
    return call;
  }

  async function flush(): Promise<void> {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    TestBed.tick();
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

  function push(
    revision: number,
    change: Record<string, unknown>,
    origin = 'agent',
  ): void {
    inbox.handleMessage({
      type: MESSAGE_TYPES.SURFACE_UPDATED,
      payload: { routingId, surfaceId: SURFACE, revision, origin, change },
    });
    TestBed.tick();
  }

  const snapshot = (
    revision: number,
    name = 'Ada',
    selection: SurfaceSelection | null = null,
  ) =>
    push(revision, {
      kind: 'snapshot',
      state: view(revision, name, selection),
    });

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

  const found = (...views: SurfaceStateView[]) => ({
    status: 'found',
    routingId,
    surfaces: views,
  });

  function entry(): AppsSurfaceEntry {
    const held = session.surfaces().entries.get(SURFACE);
    if (held === undefined) throw new Error('surface not held');
    return held;
  }

  const shown = () => ops.interaction(SURFACE).pendingValues.get('form.name');
  const change = (value: string) =>
    ops.change(SURFACE, { componentId: 'name', value });

  beforeEach(async () => {
    jest.useFakeTimers();
    warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    calls = [];
    acked = 0;
    const rpc = createMockRpcService();
    (rpc.call as jest.Mock).mockImplementation(scriptedCall);
    const value = (provide: unknown, useValue: unknown) => ({
      provide,
      useValue,
    });
    const tabs = { activeWorkspacePath$: signal('/ws-a') };
    const liveness = { statuses: signal(new Map()), markIdle: jest.fn() };
    const router = { onSurfaceCreated: jest.fn(), onSurfaceClosed: jest.fn() };
    TestBed.configureTestingModule({
      providers: [
        value(ClaudeRpcService, rpc),
        value(ModelStateService, { currentModel: signal('sonnet') }),
        value(EffortStateService, { currentEffort: signal(undefined) }),
        value(TabManagerService, { ...tabs, removedWorkspace$: signal(null) }),
        value(ConversationRegistry, {
          getRecord: () => ({ sessions: ['s-1'] }),
        }),
        value(TabSessionBinding, { conversationForSurface: () => 'conv-1' }),
        value(SessionLivenessRegistry, liveness),
        value(StreamRouter, router),
      ],
    });
    inbox = TestBed.inject(SurfaceUpdateInbox);
    session = TestBed.inject(AppsSessionService);
    const expectRevision = session.expectSurfaceRevision.bind(session);
    jest
      .spyOn(session, 'expectSurfaceRevision')
      .mockImplementation((id, surfaceId, revision) => {
        acked = Math.max(acked, revision);
        expectRevision(id, surfaceId, revision);
      });
    ops = TestBed.inject(AppsSurfaceOperations);
    TestBed.tick();
    await session.start('Build');
    // The first turn ran and ended: liveness reports its session idle, which
    // ends the start's pending turn (B15 fix M2), so submits are not held.
    liveness.statuses.set(new Map([['s-1', 'idle']]));
    TestBed.tick();
    routingId = session.routingId() as string;
    snapshot(1);
  });

  afterEach(() => {
    // Own writes never conflict: no base below an acknowledged revision.
    for (const call of calls) {
      if (/^surface:(change|select)$/.test(call.method))
        expect(call.params['revision']).toBeGreaterThanOrEqual(
          call.ackedAtSend,
        );
    }
    TestBed.resetTestingModule();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('reconciliation (handoff (c))', () => {
    it('case 1 - result before echo: the ack is never materialized; the overlay retires at the echo', async () => {
      change('Grace');
      const sent = open('surface:change');
      expect(sent.params).toEqual({
        routingId,
        surfaceId: SURFACE,
        revision: 1,
        operationId: expect.stringMatching(SURFACE_OPERATION_ID_PATTERN),
        componentId: 'name',
        value: 'Grace',
      });
      expect(sent.options?.timeout).toBe(APPS_MUTATION_TIMEOUT_MS);
      expect(shown()).toBe('Grace');

      await reply('surface:change', applied(2));
      expect(entry().materializedRevision).toBe(1);
      expect(entry().overlays.list()).toEqual([
        expect.objectContaining({
          value: 'Grace',
          baseRevision: 1,
          settledRevision: 2,
        }),
      ]);

      echo(1, 2, 'Grace');
      expect(entry().materializedRevision).toBe(2);
      expect(entry().overlays.size).toBe(0);
    });

    it('case 2 - echo before result: the result only settles; nothing is re-applied or read', async () => {
      change('Grace');
      echo(1, 2, 'Grace');
      expect(entry().materializedRevision).toBe(2);
      expect(shown()).toBe('Grace'); // still pending until the result

      await reply('surface:change', applied(2));
      expect(entry().materializedRevision).toBe(2);
      expect(entry().overlays.size).toBe(0);
      jest.advanceTimersByTime(APPS_ECHO_GRACE_MS * 2);
      expect(callsOf('surface:read')).toHaveLength(0);
    });

    it('case 3 - an agent write lost between base and commit is a gap: the read replaces the view', async () => {
      change('Grace');
      await reply('surface:change', applied(3));
      echo(2, 3, 'Grace'); // fromRevision 2: the agent push at 2 never arrived
      expect(entry().materializedRevision).toBe(1);
      expect(callsOf('surface:read')).toHaveLength(1);

      await reply('surface:read', found(view(3, 'Grace')));
      expect(entry().materializedRevision).toBe(3);
      expect(entry().overlays.size).toBe(0);
    });

    it('case 4 - a newer push, then an older result or read: the materialized revision stays', async () => {
      change('Grace');
      snapshot(3, 'Grace');
      await reply('surface:change', applied(2));
      expect(entry().materializedRevision).toBe(3);
      expect(entry().overlays.size).toBe(0);

      session.requestSurfaceRead(routingId, 'stale-revision');
      await reply('surface:read', found(view(2, 'Old')));
      expect(entry().materializedRevision).toBe(3);
    });

    it('case 5 - lost echo: exactly one surface:read after 1,500 ms recovers the view', async () => {
      change('Grace');
      await reply('surface:change', applied(2));

      jest.advanceTimersByTime(APPS_ECHO_GRACE_MS - 1);
      expect(callsOf('surface:read')).toHaveLength(0);
      expect(entry().materializedRevision).toBe(1);
      jest.advanceTimersByTime(1);
      expect(callsOf('surface:read')).toHaveLength(1);

      await reply('surface:read', found(view(2, 'Grace')));
      jest.advanceTimersByTime(APPS_ECHO_WAIT_LIMIT_MS * 2);
      expect(callsOf('surface:read')).toHaveLength(1);
      expect(entry().materializedRevision).toBe(2);
      expect(entry().overlays.size).toBe(0);
    });

    it('case 6 - an older operation settles while a newer edit to the same input is pending', async () => {
      change('A');
      change('B'); // A is in flight, so B queues behind it
      expect(callsOf('surface:change')).toHaveLength(1);
      expect(shown()).toBe('B');

      await reply('surface:change', applied(2));
      // B waits for A's echo: the base is always the MATERIALIZED revision.
      expect(callsOf('surface:change')).toHaveLength(1);
      echo(1, 2, 'A');
      await flush();

      expect(
        entry()
          .overlays.list()
          .map((overlay) => overlay.value),
      ).toEqual(['B']);
      expect(shown()).toBe('B');
      const second = open('surface:change');
      expect(second.params['value']).toBe('B');
      expect(second.params['revision']).toBe(2);
    });

    it('pending overlays survive an agent snapshot replace (B11 F5)', () => {
      change('Grace');
      snapshot(2, 'Agent');
      expect(entry().materializedRevision).toBe(2);
      expect(entry().overlays.size).toBe(1);
      expect(shown()).toBe('Grace');
    });
  });

  describe('queue', () => {
    it('a queued unsent change is replaced and its overlay retired unsent', async () => {
      change('A');
      change('B');
      change('C');
      expect(
        entry()
          .overlays.list()
          .map((overlay) => overlay.value),
      ).toEqual(['A', 'C']);

      await reply('surface:change', applied(2));
      echo(1, 2, 'A');
      await flush();
      const values = callsOf('surface:change').map(
        (call) => call.params['value'],
      );
      expect(values).toEqual(['A', 'C']);
    });

    it('queued selects collapse to the latest', async () => {
      ops.select(SURFACE, ROW_1);
      ops.select(SURFACE, ROW_2);
      ops.select(SURFACE, null);
      ops.select(SURFACE, ROW_2);
      expect(callsOf('surface:select')).toHaveLength(1);

      await reply('surface:select', applied(2));
      push(2, { kind: 'snapshot', state: view(2, 'Ada', ROW_1) }, 'ui');
      await flush();
      const sent = callsOf('surface:select').map(
        (call) => call.params['selection'],
      );
      expect(sent).toEqual([ROW_1, ROW_2]);
    });

    it('an invalid draft sends nothing', () => {
      ops.change(SURFACE, { componentId: 'name', value: 42 });
      ops.change(SURFACE, { componentId: 'missing', value: 'x' });
      expect(callsOf('surface:change')).toHaveLength(0);
      expect(entry().overlays.size).toBe(0);
    });
  });

  describe('stale-revision', () => {
    it('a select re-sends ONCE after the read, with a new id and the new base', async () => {
      ops.select(SURFACE, ROW_1);
      const first = open('surface:select');
      await reply('surface:select', {
        status: 'rejected',
        operationId: 'x',
        reason: 'stale-revision',
        detail: 'Revision 2 wrote the selection.',
        currentRevision: 2,
      });
      expect(callsOf('surface:read')).toHaveLength(1);
      expect(callsOf('surface:select')).toHaveLength(1);

      await reply('surface:read', found(view(2)));
      const second = open('surface:select');
      expect(second.params['operationId']).not.toBe(
        first.params['operationId'],
      );
      expect(second.params['operationId']).toMatch(
        SURFACE_OPERATION_ID_PATTERN,
      );
      expect(second.params['revision']).toBe(2);
      expect(second.params['selection']).toEqual(ROW_1);

      await reply('surface:select', {
        status: 'rejected',
        operationId: 'y',
        reason: 'stale-revision',
        detail: 'Still stale.',
        currentRevision: 3,
      });
      jest.advanceTimersByTime(APPS_ECHO_WAIT_LIMIT_MS * 2);
      await flush();
      expect(callsOf('surface:select')).toHaveLength(2);
      expect(ops.interaction(SURFACE).selection).toEqual(ROW_1);
      expect(ops.notice(SURFACE)).toBe(
        `${APPS_SELECTION_NOTICE_PREFIX}Still stale.`,
      );
    });

    it('a change does NOT re-send: overlay retired, read requested, per-input notice', async () => {
      change('Grace');
      await reply('surface:change', {
        status: 'rejected',
        operationId: 'x',
        reason: 'stale-revision',
        detail: 'Revision 2 wrote form.name.',
        currentRevision: 2,
      });
      await reply('surface:read', found(view(2, 'Agent')));
      jest.advanceTimersByTime(APPS_ECHO_WAIT_LIMIT_MS * 2);
      await flush();

      expect(callsOf('surface:change')).toHaveLength(1);
      expect(entry().overlays.size).toBe(0);
      expect(ops.interaction(SURFACE).issues.get('name')).toEqual([
        APPS_CHANGE_TEXT.stale,
      ]);
      // The next edit of that input clears its notice.
      change('Again');
      expect(ops.interaction(SURFACE).issues.has('name')).toBe(false);
    });
  });

  describe('Req 6.6 unsynced selection', () => {
    it('keeps the selection shown with the notice; the next pushed selection clears the mark', async () => {
      ops.select(SURFACE, ROW_1);
      expect(ops.interaction(SURFACE).selection).toEqual(ROW_1);
      await reply('surface:select', {
        status: 'rejected',
        operationId: 'x',
        reason: 'invalid-value',
        detail: 'Row 1 is not selectable.',
      });

      const interaction = ops.interaction(SURFACE);
      expect(interaction.selection).toEqual(ROW_1);
      expect(interaction.selectionUnsynced).toBe(true);
      expect(ops.notice(SURFACE)).toBe(
        'Selection not shared with the agent: Row 1 is not selectable.',
      );

      snapshot(2, 'Ada', ROW_2);
      expect(ops.interaction(SURFACE).selection).toEqual(ROW_2);
      expect(ops.interaction(SURFACE).selectionUnsynced).toBe(false);
      expect(ops.notice(SURFACE)).toBeNull();
    });

    it('a timed-out select asks surface:operation once and shows the notice when unconfirmed', async () => {
      ops.select(SURFACE, ROW_1);
      await jest.advanceTimersByTimeAsync(APPS_MUTATION_TIMEOUT_MS);
      await flush();
      expect(callsOf('surface:operation')).toHaveLength(1);
      await reply('surface:operation', { status: 'unknown' });

      expect(callsOf('surface:select')).toHaveLength(1);
      expect(ops.interaction(SURFACE).selectionUnsynced).toBe(true);
      expect(ops.notice(SURFACE)).toMatch(
        /^Selection not shared with the agent: /,
      );
      // The next user selection clears the mark.
      ops.select(SURFACE, ROW_2);
      expect(ops.notice(SURFACE)).toBeNull();
      expect(ops.interaction(SURFACE).selectionUnsynced).toBe(false);
    });
  });

  describe('result handling', () => {
    it.each(
      'invalid-value undeclared budget too-many-operations operation-expired operation-conflict'.split(
        ' ',
      ),
    )(
      'rejected %s: retires the overlay and shows the detail',
      async (reason) => {
        change('Grace');
        await reply('surface:change', {
          status: 'rejected',
          operationId: 'x',
          reason,
          detail: `No: ${reason}`,
        });
        expect(entry().overlays.size).toBe(0);
        expect(ops.interaction(SURFACE).issues.get('name')).toEqual([
          `No: ${reason}`,
        ]);
        expect(callsOf('surface:change')).toHaveLength(1);
        expect(callsOf('surface:operation')).toHaveLength(0);
      },
    );

    it('not-found: retires the overlay and reads', async () => {
      change('Grace');
      await reply('surface:change', { status: 'not-found' });
      expect(entry().overlays.size).toBe(0);
      expect(callsOf('surface:read')).toHaveLength(1);
    });

    it('pending is a transport failure: surface:operation once, its applied answer settles', async () => {
      change('Grace');
      await reply('surface:change', { status: 'pending', operationId: 'x' });
      const check = open('surface:operation');
      expect(check.params).toEqual({
        routingId,
        operationId: expect.stringMatching(SURFACE_OPERATION_ID_PATTERN),
      });
      expect(check.options?.timeout).toBe(APPS_MUTATION_TIMEOUT_MS);
      await reply('surface:operation', { status: 'applied', revision: 2 });

      expect(entry().overlays.list()[0].settledRevision).toBe(2);
      expect(entry().materializedRevision).toBe(1);
      expect(callsOf('surface:change')).toHaveLength(1);
    });

    it('a transport failure asks surface:operation ONCE and never resends', async () => {
      change('Grace');
      await answer('surface:change', failure('RPC timeout: surface:change'));
      await answer(
        'surface:operation',
        failure('RPC timeout: surface:operation'),
      );
      jest.advanceTimersByTime(60_000);
      await flush();

      expect(callsOf('surface:change')).toHaveLength(1);
      expect(callsOf('surface:operation')).toHaveLength(1);
      expect(entry().overlays.size).toBe(0);
      expect(callsOf('surface:read').length).toBeGreaterThanOrEqual(1);
      expect(ops.interaction(SURFACE).issues.get('name')).toEqual([
        APPS_CHANGE_TEXT.unconfirmed,
      ]);
    });

    it('a host refusal (errorCode) retires the overlay with a notice and asks nothing', async () => {
      change('Grace');
      await answer(
        'surface:change',
        failure('Invalid params.', 'INVALID_PARAMS'),
      );
      expect(entry().overlays.size).toBe(0);
      expect(callsOf('surface:operation')).toHaveLength(0);
      expect(callsOf('surface:read')).toHaveLength(0);
      expect(ops.interaction(SURFACE).issues.get('name')).toEqual([
        'Invalid params.',
      ]);
    });

    it('console.warn never carries a payload value', async () => {
      change('secret-value');
      await reply('surface:change', {
        status: 'rejected',
        operationId: 'x',
        reason: 'budget',
        detail: 'd',
      });
      for (const args of warn.mock.calls) {
        expect(args.map(String).join(' ')).not.toContain('secret-value');
      }
    });
  });

  describe('boundaries', () => {
    it('no mutation calls chat:start or chat:continue (Req 6.4)', async () => {
      const before = calls.filter((call) =>
        call.method.startsWith('chat:'),
      ).length;
      change('Grace');
      await reply('surface:change', applied(2));
      echo(1, 2, 'Grace');
      ops.select(SURFACE, ROW_1);
      await reply('surface:select', {
        status: 'rejected',
        operationId: 'y',
        reason: 'budget',
        detail: 'd',
      });
      ops.submit(SURFACE, { actionId: 'send' });
      await flush();
      await reply('surface:action', {
        status: 'applied',
        operationId: 'z',
        surfaceState: { kind: 'not-recorded' },
      });

      expect(callsOf('surface:action')).toHaveLength(1);
      expect(
        calls.filter((call) => call.method.startsWith('chat:')),
      ).toHaveLength(before);
      expect(callsOf('chat:start')).toHaveLength(1); // the conversation start only
      expect(callsOf('chat:continue')).toHaveLength(0);
    });

    it('leaves no timer after the conversation is discarded (fake timers)', async () => {
      change('A');
      await reply('surface:change', applied(2));
      change('B'); // waits for A's echo: a lane wait timer
      ops.select(SURFACE, ROW_1); // queued behind it
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      session.discard();
      TestBed.tick();
      await flush();

      expect(jest.getTimerCount()).toBe(0);
      const count = calls.length;
      await jest.advanceTimersByTimeAsync(APPS_ECHO_WAIT_LIMIT_MS * 4);
      expect(calls).toHaveLength(count);
    });

    it('release() aborts the mutation in flight and ignores its late result', async () => {
      change('Grace');
      const sent = open('surface:change');
      ops.release(routingId);
      await flush();

      expect(sent.done).toBe(true);
      expect(callsOf('surface:operation')).toHaveLength(0);
      expect(jest.getTimerCount()).toBe(0);
    });
  });
});
