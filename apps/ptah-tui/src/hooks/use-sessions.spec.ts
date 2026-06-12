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
      cost: 0.03,
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
