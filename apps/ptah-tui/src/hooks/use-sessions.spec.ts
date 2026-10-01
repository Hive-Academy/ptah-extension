import { EventEmitter } from 'node:events';
import { SessionController, type SessionTransport } from './use-sessions.js';

interface RpcCall {
  method: string;
  params: Record<string, unknown>;
}

function makeTransport(
  responder: (call: RpcCall) => {
    success: boolean;
    data?: unknown;
    error?: string;
  } = () => ({ success: true }),
): { transport: SessionTransport; calls: RpcCall[] } {
  const calls: RpcCall[] = [];
  const transport: SessionTransport = {
    call: async (method, params) => {
      const call = { method, params: params as Record<string, unknown> };
      calls.push(call);
      return responder(call) as {
        success: boolean;
        data?: never;
        error?: string;
      };
    },
  };
  return { transport, calls };
}

describe('SessionController', () => {
  it('session:list passes workspacePath and maps results', async () => {
    const { transport, calls } = makeTransport((call) => {
      if (call.method === 'session:list') {
        return {
          success: true,
          data: {
            sessions: [
              { id: 'abcdef123456', name: 'Alpha', model: 'claude-opus' },
            ],
          },
        };
      }
      return { success: true };
    });
    const c = new SessionController(
      transport,
      new EventEmitter(),
      '/work',
      () => undefined,
    );
    await c.loadSessions();
    expect(calls[0]).toEqual({
      method: 'session:list',
      params: { workspacePath: '/work' },
    });
    expect(c.sessions[0]).toMatchObject({ id: 'abcdef123456', name: 'Alpha' });
    c.dispose();
  });

  it('session:stats derives the displayed model via pickPrimaryModel', () => {
    const push = new EventEmitter();
    const { transport } = makeTransport();
    const c = new SessionController(transport, push, '/w', () => undefined);
    c.setActiveSession('s1');
    push.emit('session:stats', {
      sessionId: 's1',
      turnCost: 0.03,
      tokens: { input: 100, output: 50 },
      modelUsage: [
        {
          model: 'claude-haiku',
          inputTokens: 10,
          outputTokens: 5,
          contextWindow: 200_000,
          costUSD: 0.001,
          cacheReadInputTokens: 0,
        },
        {
          model: 'claude-opus',
          inputTokens: 90,
          outputTokens: 45,
          contextWindow: 200_000,
          costUSD: 0.029,
          cacheReadInputTokens: 0,
          lastTurnContextTokens: 4000,
        },
      ],
    });
    expect(c.stats?.model).toBe('claude-opus');
    expect(c.stats?.contextUsed).toBe(4000);
    expect(c.stats?.contextUsagePercent).toBe(2);
    c.dispose();
  });

  describe('session cost comes from the backend sessionStats snapshot', () => {
    function snapshot(
      totalCost: number | null,
      knownCost: number | null,
      pricingCoverage: 'full' | 'partial' | 'none',
    ) {
      return {
        sessionId: 's1',
        model: 'claude-opus',
        totalCost,
        knownCost,
        pricingCoverage,
        tokens: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0 },
        messageCount: 1,
        status: 'ok',
        scope: 'session',
      };
    }

    function turn(
      turnCost: number | null,
      sessionStats?: ReturnType<typeof snapshot>,
      rowCost: number | null = 3,
    ) {
      return {
        sessionId: 's1',
        turnCost,
        tokens: { input: 100, output: 50 },
        duration: 1000,
        modelUsage: [
          {
            model: 'claude-opus',
            inputTokens: 100,
            outputTokens: 50,
            contextWindow: 200_000,
            costUSD: rowCost,
            cacheReadInputTokens: 0,
          },
        ],
        ...(sessionStats ? { sessionStats } : {}),
      };
    }

    it('shows the snapshot total, not the last turn or a model row', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession('s1');
      push.emit('session:stats', turn(10, snapshot(10, 10, 'full')));
      expect(c.stats?.costUSD).toBe(10);
      push.emit('session:stats', turn(5, snapshot(15, 15, 'full')));
      expect(c.stats?.costUSD).toBe(15);
      expect(c.stats?.costPartial).toBe(false);
      c.dispose();
    });

    it('shows knownCost marked partial when pricing is partial', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession('s1');
      push.emit('session:stats', turn(null, snapshot(null, 4, 'partial')));
      expect(c.stats?.costUSD).toBe(4);
      expect(c.stats?.costPartial).toBe(true);
      c.dispose();
    });

    it('reports an unknown session cost as null, never $0', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession('s1');
      push.emit('session:stats', turn(null, undefined, null));
      expect(c.stats).not.toBeNull();
      expect(c.stats?.costUSD).toBeNull();
      push.emit('session:stats', turn(null, snapshot(null, null, 'none')));
      expect(c.stats?.costUSD).toBeNull();
      expect(c.stats?.costPartial).toBe(false);
      c.dispose();
    });

    it('keeps the previous session cost when a push carries no snapshot', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession('s1');
      push.emit('session:stats', turn(10, snapshot(10, 10, 'full')));
      push.emit('session:stats', turn(5));
      expect(c.stats?.costUSD).toBe(10);
      expect(c.stats?.costPartial).toBe(false);
      c.dispose();
    });

    it('does not carry one session cost over to another session', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession('s1');
      push.emit('session:stats', turn(10, snapshot(10, 10, 'full')));
      c.setActiveSession('s2');
      push.emit('session:stats', { ...turn(5), sessionId: 's2' });
      expect(c.stats?.sessionId).toBe('s2');
      expect(c.stats?.costUSD).toBeNull();
      c.dispose();
    });

    it('ignores a push snapshot that belongs to another session', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession('s1');
      push.emit('session:stats', turn(10, snapshot(10, 10, 'full')));
      push.emit(
        'session:stats',
        turn(5, { ...snapshot(99, 99, 'full'), sessionId: 'other' }),
      );
      expect(c.stats?.costUSD).toBe(10);
      c.setActiveSession('s2');
      push.emit('session:stats', {
        ...turn(5, { ...snapshot(99, 99, 'full'), sessionId: 'other' }),
        sessionId: 's2',
      });
      expect(c.stats?.sessionId).toBe('s2');
      expect(c.stats?.costUSD).toBeNull();
      c.dispose();
    });

    it('ignores a stats-batch entry that belongs to another session', async () => {
      const { transport } = makeTransport((call) =>
        call.method === 'session:stats-batch'
          ? {
              success: true,
              data: {
                sessionStats: [
                  {
                    sessionId: 'other',
                    totalCost: 99,
                    knownCost: 99,
                    pricingCoverage: 'full',
                    tokens: { input: 800, output: 300 },
                    status: 'ok',
                  },
                ],
              },
            }
          : { success: true },
      );
      const c = new SessionController(
        transport,
        new EventEmitter(),
        '/work',
        () => undefined,
      );
      await c.loadSession('sess-x');
      expect(c.stats?.sessionId).toBe('sess-x');
      expect(c.stats?.costUSD).toBeNull();
      c.dispose();
    });

    it('seeds a partial or unknown cost from session:stats-batch, never $0', async () => {
      let entry: Record<string, unknown> = {
        sessionId: 'sess-p',
        totalCost: null,
        knownCost: 0.07,
        pricingCoverage: 'partial',
        tokens: { input: 800, output: 300 },
        status: 'ok',
      };
      const { transport } = makeTransport((call) =>
        call.method === 'session:stats-batch'
          ? { success: true, data: { sessionStats: [entry] } }
          : { success: true },
      );
      const c = new SessionController(
        transport,
        new EventEmitter(),
        '/work',
        () => undefined,
      );
      await c.loadSession('sess-p');
      expect(c.stats?.costUSD).toBe(0.07);
      expect(c.stats?.costPartial).toBe(true);

      entry = {
        ...entry,
        sessionId: 'sess-u',
        knownCost: null,
        pricingCoverage: 'none',
      };
      await c.loadSession('sess-u');
      expect(c.stats?.costUSD).toBeNull();
      expect(c.stats?.costPartial).toBe(false);
      c.dispose();
    });
  });

  it('seeds stats on session load from session:stats-batch without a push', async () => {
    const { transport, calls } = makeTransport((call) => {
      if (call.method === 'session:stats-batch') {
        return {
          success: true,
          data: {
            sessionStats: [
              {
                sessionId: 'sess-9',
                totalCost: 0.12,
                tokens: { input: 800, output: 300 },
                modelUsageList: [
                  {
                    model: 'claude-opus',
                    inputTokens: 800,
                    outputTokens: 300,
                    costUSD: 0.12,
                  },
                ],
                status: 'ok',
              },
            ],
          },
        };
      }
      return { success: true };
    });
    const c = new SessionController(
      transport,
      new EventEmitter(),
      '/work',
      () => undefined,
    );
    await c.loadSession('sess-9');
    expect(calls.some((call) => call.method === 'session:stats-batch')).toBe(
      true,
    );
    expect(c.stats?.model).toBe('claude-opus');
    expect(c.stats?.inputTokens).toBe(800);
    expect(c.stats?.costUSD).toBe(0.12);
    c.dispose();
  });

  it('clears stats on load when the session has no usage yet', async () => {
    const { transport } = makeTransport((call) => {
      if (call.method === 'session:stats-batch') {
        return {
          success: true,
          data: {
            sessionStats: [
              {
                totalCost: null,
                tokens: { input: 0, output: 0 },
                status: 'empty',
              },
            ],
          },
        };
      }
      return { success: true };
    });
    const c = new SessionController(
      transport,
      new EventEmitter(),
      '/work',
      () => undefined,
    );
    await c.loadSession('sess-empty');
    expect(c.stats).toBeNull();
    c.dispose();
  });

  describe('a stats-batch seed racing a session:stats push', () => {
    interface Deferred<T> {
      promise: Promise<T>;
      resolve: (value: T) => void;
      reject: (reason: unknown) => void;
    }

    function deferred<T>(): Deferred<T> {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      return { promise, resolve, reject };
    }

    type BatchResult = { success: boolean; data?: unknown };

    /** `session:load` succeeds at once; each `session:stats-batch` waits on its own deferred. */
    function makeDeferredBatchTransport(): {
      transport: SessionTransport;
      batches: Map<string, Deferred<BatchResult>>;
    } {
      const batches = new Map<string, Deferred<BatchResult>>();
      const transport: SessionTransport = {
        call: (async (method: string, params: unknown) => {
          if (method !== 'session:stats-batch') return { success: true };
          const [id] = (params as { sessionIds: string[] }).sessionIds;
          const pending = deferred<BatchResult>();
          batches.set(id, pending);
          return pending.promise;
        }) as SessionTransport['call'],
      };
      return { transport, batches };
    }

    function flush(): Promise<void> {
      return new Promise((resolve) => setTimeout(resolve, 0));
    }

    function batchEntry(sessionId: string, totalCost: number, input: number) {
      return {
        success: true,
        data: {
          sessionStats: [
            {
              sessionId,
              totalCost,
              knownCost: totalCost,
              pricingCoverage: 'full',
              tokens: { input, output: 1 },
              status: 'ok',
            },
          ],
        },
      };
    }

    function pushFor(sessionId: string, totalCost: number, input: number) {
      return {
        sessionId,
        turnCost: 1,
        tokens: { input, output: 2 },
        modelUsage: [],
        sessionStats: {
          sessionId,
          totalCost,
          knownCost: totalCost,
          pricingCoverage: 'full',
          tokens: { input, output: 2, cacheRead: 0, cacheCreation: 0 },
          messageCount: 2,
          status: 'ok',
          scope: 'session',
        },
      };
    }

    it('keeps a push accepted while the seed was in flight over older batch data', async () => {
      const push = new EventEmitter();
      const { transport, batches } = makeDeferredBatchTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      const loading = c.loadSession('s1');
      await flush();
      push.emit('session:stats', pushFor('s1', 20, 900));
      batches.get('s1')?.resolve(batchEntry('s1', 5, 100));
      await loading;
      expect(c.stats?.costUSD).toBe(20);
      expect(c.stats?.inputTokens).toBe(900);
      c.dispose();
    });

    it('keeps a push accepted while the seed was in flight when the batch rejects', async () => {
      const push = new EventEmitter();
      const { transport, batches } = makeDeferredBatchTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      const loading = c.loadSession('s1');
      await flush();
      push.emit('session:stats', pushFor('s1', 20, 900));
      batches.get('s1')?.reject(new Error('transport down'));
      await loading;
      expect(c.stats).not.toBeNull();
      expect(c.stats?.costUSD).toBe(20);
      expect(c.stats?.inputTokens).toBe(900);
      c.dispose();
    });

    it('applies the batch result when no push arrived during the request', async () => {
      const push = new EventEmitter();
      const { transport, batches } = makeDeferredBatchTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      const loading = c.loadSession('s1');
      await flush();
      batches.get('s1')?.resolve(batchEntry('s1', 5, 100));
      await loading;
      expect(c.stats?.sessionId).toBe('s1');
      expect(c.stats?.costUSD).toBe(5);
      expect(c.stats?.inputTokens).toBe(100);
      c.dispose();
    });

    it('does not let a stale seed for a session switched away from overwrite the new one', async () => {
      const push = new EventEmitter();
      const { transport, batches } = makeDeferredBatchTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      const loadingA = c.loadSession('a');
      await flush();
      const loadingB = c.loadSession('b');
      await flush();
      batches.get('b')?.resolve(batchEntry('b', 7, 300));
      await loadingB;
      batches.get('a')?.resolve(batchEntry('a', 3, 50));
      await loadingA;
      expect(c.activeSessionId).toBe('b');
      expect(c.stats?.sessionId).toBe('b');
      expect(c.stats?.costUSD).toBe(7);
      c.dispose();
    });

    it('applies the active seed when a push for another session arrives meanwhile, never showing it', async () => {
      const push = new EventEmitter();
      const { transport, batches } = makeDeferredBatchTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      const loading = c.loadSession('a');
      await flush();
      push.emit('session:stats', pushFor('b', 99, 9999));
      expect(c.stats?.sessionId).not.toBe('b');
      batches.get('a')?.resolve(batchEntry('a', 5, 100));
      await loading;
      expect(c.stats?.sessionId).toBe('a');
      expect(c.stats?.costUSD).toBe(5);
      expect(c.stats?.inputTokens).toBe(100);
      c.dispose();
    });

    it("clears A's stats on switching to B while B is seeding, then shows B's", async () => {
      const push = new EventEmitter();
      const { transport, batches } = makeDeferredBatchTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      const loadingA = c.loadSession('a');
      await flush();
      batches.get('a')?.resolve(batchEntry('a', 5, 100));
      await loadingA;
      expect(c.stats?.costUSD).toBe(5);

      const loadingB = c.loadSession('b');
      await flush();
      expect(c.activeSessionId).toBe('b');
      expect(c.stats).toBeNull();
      batches.get('b')?.resolve(batchEntry('b', 7, 300));
      await loadingB;
      expect(c.stats?.sessionId).toBe('b');
      expect(c.stats?.costUSD).toBe(7);
      c.dispose();
    });

    it('keeps the stats when the same session is activated again', async () => {
      const push = new EventEmitter();
      const { transport, batches } = makeDeferredBatchTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      const loadingA = c.loadSession('a');
      await flush();
      batches.get('a')?.resolve(batchEntry('a', 5, 100));
      await loadingA;

      c.setActiveSession('a');
      expect(c.stats?.sessionId).toBe('a');
      expect(c.stats?.costUSD).toBe(5);

      const reloading = c.loadSession('a');
      await flush();
      expect(c.stats?.costUSD).toBe(5);
      batches.get('a')?.resolve(batchEntry('a', 6, 120));
      await reloading;
      expect(c.stats?.costUSD).toBe(6);
      c.dispose();
    });
  });

  describe('session:stats pushes are scoped to the active session', () => {
    function pushFor(sessionId: string, totalCost: number) {
      return {
        sessionId,
        turnCost: 1,
        tokens: { input: 10, output: 2 },
        modelUsage: [],
        sessionStats: {
          sessionId,
          totalCost,
          knownCost: totalCost,
          pricingCoverage: 'full',
          tokens: { input: 10, output: 2, cacheRead: 0, cacheCreation: 0 },
          messageCount: 1,
          status: 'ok',
          scope: 'session',
        },
      };
    }

    it('a push for a non-active session never changes stats', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession('a');
      push.emit('session:stats', pushFor('a', 3));
      const before = c.stats;
      push.emit('session:stats', pushFor('b', 99));
      expect(c.stats).toBe(before);
      expect(c.stats?.sessionId).toBe('a');
      expect(c.stats?.costUSD).toBe(3);
      c.dispose();
    });

    it("shows a brand-new session's first push once its id is resolved", () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession(null);
      push.emit('session:id-resolved', { tabId: 't1', realSessionId: 'new' });
      push.emit('session:stats', pushFor('new', 4));
      expect(c.stats?.sessionId).toBe('new');
      expect(c.stats?.costUSD).toBe(4);
      c.dispose();
    });

    it('keeps a push that arrives before its session id resolves and shows it on resolution', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      c.setActiveSession(null);
      push.emit('session:stats', pushFor('new', 4));
      push.emit('session:stats', pushFor('background', 99));
      push.emit('session:id-resolved', { tabId: 't1', realSessionId: 'new' });
      expect(c.stats?.sessionId).toBe('new');
      expect(c.stats?.costUSD).toBe(4);
      c.dispose();
    });
  });

  it('session:id-resolved promotes the active session to the real UUID', () => {
    const push = new EventEmitter();
    const { transport } = makeTransport();
    const c = new SessionController(transport, push, '/w', () => undefined);
    push.emit('session:id-resolved', {
      tabId: 'tab-1',
      realSessionId: 'real-123',
    });
    expect(c.activeSessionId).toBe('real-123');
    c.dispose();
  });

  it('session:delete clears active + stats and reloads', async () => {
    const { transport, calls } = makeTransport((call) => {
      if (call.method === 'session:list') {
        return { success: true, data: { sessions: [] } };
      }
      return { success: true };
    });
    const c = new SessionController(
      transport,
      new EventEmitter(),
      '/w',
      () => undefined,
    );
    c.setActiveSession('s1');
    await c.deleteSession('s1');
    expect(calls.some((call) => call.method === 'session:delete')).toBe(true);
    expect(calls.some((call) => call.method === 'session:list')).toBe(true);
    expect(c.activeSessionId).toBeNull();
    c.dispose();
  });

  it('detaches push listeners on dispose', () => {
    const push = new EventEmitter();
    const { transport } = makeTransport();
    const c = new SessionController(transport, push, '/w', () => undefined);
    expect(push.listenerCount('session:stats')).toBe(1);
    c.dispose();
    expect(push.listenerCount('session:stats')).toBe(0);
    expect(push.listenerCount('session:id-resolved')).toBe(0);
  });
});
