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
      push.emit('session:stats', turn(null, snapshot(null, 4, 'partial')));
      expect(c.stats?.costUSD).toBe(4);
      expect(c.stats?.costPartial).toBe(true);
      c.dispose();
    });

    it('reports an unknown session cost as null, never $0', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
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
      push.emit('session:stats', turn(10, snapshot(10, 10, 'full')));
      push.emit('session:stats', { ...turn(5), sessionId: 's2' });
      expect(c.stats?.sessionId).toBe('s2');
      expect(c.stats?.costUSD).toBeNull();
      c.dispose();
    });

    it('ignores a push snapshot that belongs to another session', () => {
      const push = new EventEmitter();
      const { transport } = makeTransport();
      const c = new SessionController(transport, push, '/w', () => undefined);
      push.emit('session:stats', turn(10, snapshot(10, 10, 'full')));
      push.emit(
        'session:stats',
        turn(5, { ...snapshot(99, 99, 'full'), sessionId: 'other' }),
      );
      expect(c.stats?.costUSD).toBe(10);
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
