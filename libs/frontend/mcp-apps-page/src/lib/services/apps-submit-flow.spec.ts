import { signal, type WritableSignal } from '@angular/core';
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
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import { SURFACE_OPERATION_ID_PATTERN } from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type {
  SurfaceComponent,
  SurfaceStateView,
} from '@ptah-extension/shared/mcp-apps-contracts/surface';
import type { AppsSurfaceEntry } from '../state/apps-surface-reducer';
import { AppsSessionService } from './apps-session.service';
import { AppsSurfaceOperations } from './apps-surface-operations.service';
import {
  APPS_SUBMIT_POLL_INTERVAL_MS,
  APPS_SUBMIT_POLL_LIMIT_MS,
  APPS_SUBMIT_POLL_TIMEOUT_MS,
  APPS_SUBMIT_TEXT,
  APPS_SUBMIT_TIMEOUT_MS,
} from './apps-submit-flow';
import { APPS_ECHO_GRACE_MS } from './apps-surface-sync';

const SURFACE = 'profile';

const COMPONENTS = [
  {
    kind: 'card',
    id: 'form',
    children: [
      {
        kind: 'text',
        id: 'name',
        label: 'Name',
        path: 'form.name',
        hints: { required: true },
      },
    ],
    actions: [
      { id: 'send', action: 'surface.submit', label: { text: 'Send' } },
    ],
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
  readonly options: RpcCallOptions | undefined;
  /** Highest acknowledged (expected) revision when the call was made. */
  readonly ackedAtSend: number;
  done: boolean;
  resolve(result: RpcResult<unknown>): void;
}

describe('AppsSubmitFlow (through AppsSurfaceOperations)', () => {
  let calls: Call[];
  let session: AppsSessionService;
  let ops: AppsSurfaceOperations;
  let inbox: SurfaceUpdateInbox;
  let statuses: WritableSignal<Map<string, string>>;
  let activePath: WritableSignal<string | null>;
  let removed: WritableSignal<{ path: string; seq: number } | null>;
  let acked: number;
  let routingId: string;

  /** Scripted `ClaudeRpcService.call` with the real timeout and abort timing. */
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
        () =>
          call.resolve(
            new RpcResult(false, undefined, `RPC timeout: ${method}`),
          ),
        options?.timeout ?? 30_000,
      );
      options?.signal?.addEventListener(
        'abort',
        () =>
          call.resolve(
            new RpcResult(false, undefined, `RPC aborted: ${method}`),
          ),
        { once: true },
      );
      calls.push(call);
      if (method === 'chat:start') call.resolve(rpcSuccess({ success: true }));
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
  const transportFailure = (method: string) =>
    answer(method, new RpcResult(false, undefined, `RPC timeout: ${method}`));

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

  const action = () => ops.interaction(SURFACE).actions.get('send');

  async function submit(): Promise<void> {
    ops.submit(SURFACE, { actionId: 'send' });
    await flush();
  }

  async function setUp(name: string): Promise<void> {
    await session.start('Build');
    routingId = session.routingId() as string;
    push(1, { kind: 'snapshot', state: view(1, name) });
  }

  beforeEach(async () => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    calls = [];
    acked = 0;
    statuses = signal(new Map());
    activePath = signal<string | null>('/ws-a');
    removed = signal<{ path: string; seq: number } | null>(null);
    const rpc = createMockRpcService();
    (rpc.call as jest.Mock).mockImplementation(scriptedCall);
    TestBed.configureTestingModule({
      providers: [
        { provide: ClaudeRpcService, useValue: rpc },
        {
          provide: ModelStateService,
          useValue: { currentModel: signal('sonnet') },
        },
        {
          provide: EffortStateService,
          useValue: { currentEffort: signal(undefined) },
        },
        {
          provide: TabManagerService,
          useValue: {
            activeWorkspacePath$: activePath,
            removedWorkspace$: removed,
          },
        },
        {
          provide: ConversationRegistry,
          useValue: { getRecord: () => ({ sessions: ['session-1'] }) },
        },
        {
          provide: TabSessionBinding,
          useValue: { conversationForSurface: () => 'conv-1' },
        },
        {
          provide: SessionLivenessRegistry,
          useValue: { statuses, markIdle: jest.fn() },
        },
        {
          provide: StreamRouter,
          useValue: { onSurfaceCreated: jest.fn(), onSurfaceClosed: jest.fn() },
        },
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
    await setUp('Ada');
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

  describe('before the send', () => {
    it('waits for the queue and the echo, then sends surface:action once on the materialized base', async () => {
      ops.change(SURFACE, { componentId: 'name', value: 'Grace' });
      await submit();
      expect(callsOf('surface:action')).toHaveLength(0);
      expect(action()).toEqual({
        status: 'pending',
        detail: APPS_SUBMIT_TEXT.sending,
      });
      expect(ops.interaction(SURFACE).submitDisabled).toBe(true);

      await reply('surface:change', {
        status: 'applied',
        operationId: 'c',
        revision: 2,
      });
      expect(callsOf('surface:action')).toHaveLength(0); // behind: no echo yet

      echo(1, 2, 'Grace');
      await flush();
      const sent = open('surface:action');
      expect(sent.params).toEqual({
        routingId,
        surfaceId: SURFACE,
        revision: 2,
        operationId: expect.stringMatching(SURFACE_OPERATION_ID_PATTERN),
        actionId: 'send',
      });
      expect(sent.options?.timeout).toBe(APPS_SUBMIT_TIMEOUT_MS);
    });

    it('requests its OWN read after the grace when the sync grace read failed (B12 N1)', async () => {
      ops.change(SURFACE, { componentId: 'name', value: 'Grace' });
      await reply('surface:change', {
        status: 'applied',
        operationId: 'c',
        revision: 2,
      });
      jest.advanceTimersByTime(1_000);
      await submit();

      jest.advanceTimersByTime(APPS_ECHO_GRACE_MS - 1_000); // the sync's grace read
      expect(callsOf('surface:read')).toHaveLength(1);
      await answer(
        'surface:read',
        new RpcResult(false, undefined, 'boom', 'INTERNAL_ERROR'),
      );

      jest.advanceTimersByTime(1_000); // the flow's own grace tick
      expect(callsOf('surface:read')).toHaveLength(2);
      expect(callsOf('surface:action')).toHaveLength(0);

      await reply('surface:read', found(view(2, 'Grace')));
      expect(entry().materializedRevision).toBe(2);
      expect(open('surface:action').params['revision']).toBe(2);
    });

    it('does not submit while the session is processing', async () => {
      statuses.set(new Map([['session-1', 'streaming']]));
      TestBed.tick();
      expect(ops.interaction(SURFACE).submitDisabled).toBe(true);
      await submit();
      expect(callsOf('surface:action')).toHaveLength(0);
      expect(action()).toBeUndefined();
    });

    it('the local pre-check marks every issue and sends nothing', async () => {
      push(2, { kind: 'snapshot', state: view(2, '') });
      await submit();

      expect(callsOf('surface:action')).toHaveLength(0);
      expect(action()).toEqual(
        expect.objectContaining({
          status: 'rejected',
          reason: 'submit-invalid',
        }),
      );
      expect(ops.interaction(SURFACE).issues.get('name')).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  describe('polling', () => {
    it('a 30 s timeout leads to polling, with no second surface:action', async () => {
      await submit();
      const sent = open('surface:action');
      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_TIMEOUT_MS);
      await flush();
      expect(action()?.status).toBe('pending');

      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_INTERVAL_MS - 1);
      expect(callsOf('surface:operation')).toHaveLength(0);
      await jest.advanceTimersByTimeAsync(1);
      const poll = open('surface:operation');
      expect(poll.params).toEqual({
        routingId,
        operationId: sent.params['operationId'],
      });
      expect(poll.options?.timeout).toBe(APPS_SUBMIT_POLL_TIMEOUT_MS);
      await reply('surface:operation', { status: 'pending' });

      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_INTERVAL_MS);
      await reply('surface:operation', { status: 'applied', revision: 2 });

      expect(callsOf('surface:action')).toHaveLength(1);
      expect(callsOf('surface:operation')).toHaveLength(2);
      expect(action()).toEqual({
        status: 'applied',
        detail: APPS_SUBMIT_TEXT.sent,
      });
      expect(ops.submittedBubbles().map((bubble) => bubble.text)).toEqual([
        'Submitted: Send',
      ]);
      expect(entry().materializedRevision).toBe(1); // expected, never materialized
    });

    it('stops at 150 s after the send and settles unknown', async () => {
      await submit();
      await transportFailure('surface:action');
      for (let tick = 0; tick < 60; tick += 1) {
        await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_INTERVAL_MS);
        if (callsOf('surface:operation').some((call) => !call.done))
          await reply('surface:operation', { status: 'pending' });
      }

      const polls = callsOf('surface:operation').length;
      expect(polls).toBe(
        APPS_SUBMIT_POLL_LIMIT_MS / APPS_SUBMIT_POLL_INTERVAL_MS - 1,
      );
      expect(action()).toEqual({
        status: 'unknown',
        detail: APPS_SUBMIT_TEXT.unknown,
      });
      expect(callsOf('surface:action')).toHaveLength(1);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('settles unknown after 3 consecutive poll failures', async () => {
      await submit();
      await transportFailure('surface:action');
      for (let failure = 0; failure < 3; failure += 1) {
        await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_INTERVAL_MS);
        await transportFailure('surface:operation');
      }

      expect(action()?.status).toBe('unknown');
      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_LIMIT_MS);
      expect(callsOf('surface:operation')).toHaveLength(3);
      expect(callsOf('surface:action')).toHaveLength(1);
    });

    it('a pending surface:action result is polled too', async () => {
      await submit();
      await reply('surface:action', { status: 'pending', operationId: 'x' });
      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_INTERVAL_MS);
      await reply('surface:operation', {
        status: 'indeterminate',
        detail: 'd',
      });
      expect(action()).toEqual({
        status: 'indeterminate',
        detail: APPS_SUBMIT_TEXT.indeterminate,
      });
    });

    it('leaves no timer after release() while polling (fake timers)', async () => {
      await submit();
      await transportFailure('surface:action');
      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_INTERVAL_MS);
      expect(jest.getTimerCount()).toBeGreaterThan(0);

      ops.release(routingId);
      await flush();

      expect(jest.getTimerCount()).toBe(0);
      const count = calls.length;
      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_LIMIT_MS);
      expect(calls.length).toBe(count);
    });
  });

  describe('results', () => {
    it('a host refusal (errorCode) is not polled', async () => {
      await submit();
      await answer(
        'surface:action',
        new RpcResult(false, undefined, 'x', 'INVALID_PARAMS'),
      );
      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_INTERVAL_MS * 3);
      expect(callsOf('surface:operation')).toHaveLength(0);
      expect(action()?.status).toBe('rejected');
    });

    it.each([
      ['stale-revision', APPS_SUBMIT_TEXT.stale, 1],
      ['busy', APPS_SUBMIT_TEXT.busy, 0],
      ['session-unavailable', APPS_SUBMIT_TEXT.sessionUnavailable, 0],
      ['budget', 'Over budget.', 0],
    ])(
      'rejected %s shows its text (reads: %#)',
      async (reason, text, reads) => {
        await submit();
        await reply('surface:action', {
          status: 'rejected',
          operationId: 'x',
          reason,
          detail: 'Over budget.',
        });
        expect(action()).toEqual({ status: 'rejected', reason, detail: text });
        expect(callsOf('surface:read')).toHaveLength(reads);
      },
    );

    it('submit-invalid marks every issue on its input', async () => {
      await submit();
      await reply('surface:action', {
        status: 'rejected',
        operationId: 'x',
        reason: 'submit-invalid',
        detail: 'Invalid.',
        issues: [
          { componentId: 'name', path: 'form.name', message: 'is required.' },
          { componentId: 'name', path: 'form.name', message: 'is too short.' },
        ],
      });
      expect(ops.interaction(SURFACE).issues.get('name')).toEqual([
        'is required.',
        'is too short.',
      ]);
    });

    it('applied with an updated surface state: the revision is expected, never materialized', async () => {
      await submit();
      await reply('surface:action', {
        status: 'applied',
        operationId: 'x',
        surfaceState: { kind: 'updated', revision: 2 },
      });
      expect(entry().materializedRevision).toBe(1);
      jest.advanceTimersByTime(APPS_ECHO_GRACE_MS);
      expect(callsOf('surface:read')).toHaveLength(1);
      expect(ops.submittedBubbles()).toHaveLength(1);
    });

    it('indeterminate adds the bubble and says do not resend; not-found reads', async () => {
      await submit();
      await reply('surface:action', {
        status: 'indeterminate',
        operationId: 'x',
        detail: 'Dispatch unresolved.',
        surfaceState: { kind: 'not-recorded' },
      });
      expect(action()?.detail).toBe(APPS_SUBMIT_TEXT.indeterminate);
      expect(ops.submittedBubbles().map((bubble) => bubble.text)).toEqual([
        'Submitted: Send',
      ]);

      await submit();
      await reply('surface:action', { status: 'not-found' });
      expect(action()?.status).toBe('not-found');
      expect(callsOf('surface:read')).toHaveLength(1);
    });

    it('never calls chat:continue', async () => {
      await submit();
      await reply('surface:action', {
        status: 'applied',
        operationId: 'x',
        surfaceState: { kind: 'not-recorded' },
      });
      expect(callsOf('chat:continue')).toHaveLength(0);
      expect(callsOf('chat:start')).toHaveLength(1);
    });
  });

  describe('serialization with the lanes (symmetric)', () => {
    it('a change committed while surface:action is pending waits until the action settles, then sends on the materialized base', async () => {
      await submit();
      expect(open('surface:action').params['revision']).toBe(1);

      ops.change(SURFACE, { componentId: 'name', value: 'Grace' });
      await flush();
      expect(callsOf('surface:change')).toHaveLength(0);
      expect(ops.interaction(SURFACE).pendingValues.get('form.name')).toBe(
        'Grace',
      );

      // Still held while the submit polls.
      await reply('surface:action', { status: 'pending', operationId: 'x' });
      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_INTERVAL_MS);
      expect(callsOf('surface:change')).toHaveLength(0);

      await reply('surface:operation', { status: 'applied', revision: 2 });
      expect(action()?.status).toBe('applied');
      // The submit's revision is expected: the change waits for it.
      expect(callsOf('surface:change')).toHaveLength(0);

      push(2, { kind: 'snapshot', state: view(2, 'Agent') });
      await flush();
      const sent = open('surface:change');
      expect(callsOf('surface:change')).toHaveLength(1);
      expect(sent.params['revision']).toBe(entry().materializedRevision);
      expect(sent.params['revision']).toBe(2);
    });

    it('with no revision to wait for, the held change sends as soon as the action settles', async () => {
      await submit();
      ops.change(SURFACE, { componentId: 'name', value: 'Grace' });
      await flush();
      expect(callsOf('surface:change')).toHaveLength(0);

      await reply('surface:action', {
        status: 'rejected',
        operationId: 'x',
        reason: 'budget',
        detail: 'Over budget.',
      });
      expect(open('surface:change').params['revision']).toBe(
        entry().materializedRevision,
      );
    });
  });

  describe('release of a conversation that is not shown', () => {
    it('a removed non-active workspace releases its lanes, poll timer and record, with no timers left', async () => {
      const routingA = routingId;
      await submit();
      await transportFailure('surface:action'); // polling: one poll timer
      ops.change(SURFACE, { componentId: 'name', value: 'Grace' }); // held
      await flush();
      expect(ops['records'].has(routingA)).toBe(true);

      activePath.set('/ws-b');
      TestBed.tick();
      await flush();
      expect(jest.getTimerCount()).toBeGreaterThan(0); // not shown, still held

      removed.set({ path: '/ws-a', seq: 1 });
      TestBed.tick();
      await flush();

      expect(session.ownedRoutingIds().has(routingA)).toBe(false);
      expect(ops['records'].has(routingA)).toBe(false);
      expect(jest.getTimerCount()).toBe(0);
      const count = calls.length;
      await jest.advanceTimersByTimeAsync(APPS_SUBMIT_POLL_LIMIT_MS);
      expect(calls.length).toBe(count);
      expect(callsOf('surface:change')).toHaveLength(0);
    });
  });
});
