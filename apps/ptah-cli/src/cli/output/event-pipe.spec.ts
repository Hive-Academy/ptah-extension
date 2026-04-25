/**
 * Unit tests for the backend-event → JSON-RPC notification pipe.
 *
 * TASK_2026_104 Batch 3.
 */

import { EventEmitter } from 'node:events';

import { EventPipe } from './event-pipe.js';
import type { Formatter } from './formatter.js';

interface RecordedNotification {
  method: string;
  params: unknown;
}

class RecordingFormatter implements Formatter {
  readonly notifications: RecordedNotification[] = [];

  async writeNotification(method: string, params?: unknown): Promise<void> {
    this.notifications.push({ method, params });
  }
  async writeRequest(): Promise<void> {
    /* unused */
  }
  async writeResponse(): Promise<void> {
    /* unused */
  }
  async writeError(): Promise<void> {
    /* unused */
  }
  async close(): Promise<void> {
    /* unused */
  }
}

/** Allow the EventEmitter listeners to schedule and run their async writes. */
const tick = () => new Promise((r) => setImmediate(r));

describe('EventPipe', () => {
  describe('attach + mapping', () => {
    it.each([
      ['chat:chunk', 'agent.message'],
      ['chat:thought', 'agent.thought'],
      ['chat:tool_use', 'agent.tool_use'],
      ['chat:tool_result', 'agent.tool_result'],
      ['tool:start', 'agent.tool_use'],
      ['tool:end', 'agent.tool_result'],
      ['task:start', 'task.start'],
      ['task:complete', 'task.complete'],
      ['task:error', 'task.error'],
    ])('maps %s → %s', async (eventType, expectedMethod) => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit(eventType, { foo: 'bar' });
      await tick();
      expect(fmt.notifications).toEqual([
        { method: expectedMethod, params: { foo: 'bar' } },
      ]);

      pipe.detach();
    });
  });

  describe('cost delta computation', () => {
    it('computes delta from total_usd against running total', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('session:cost', {
        session_id: 's1',
        turn_id: 't1',
        total_usd: 0.05,
      });
      await tick();
      adapter.emit('session:cost', {
        session_id: 's1',
        turn_id: 't2',
        total_usd: 0.12,
      });
      await tick();

      expect(fmt.notifications).toHaveLength(2);
      expect(fmt.notifications[0]?.params).toMatchObject({
        session_id: 's1',
        turn_id: 't1',
        delta_usd: 0.05,
        total_usd: 0.05,
      });
      const second = fmt.notifications[1]?.params as {
        delta_usd: number;
        total_usd: number;
      };
      expect(second.delta_usd).toBeCloseTo(0.07, 6);
      expect(second.total_usd).toBeCloseTo(0.12, 6);

      pipe.detach();
    });

    it('passes through explicit delta_usd payloads', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('session:cost-delta', {
        session_id: 's1',
        turn_id: 't1',
        delta_usd: 0.02,
      });
      await tick();
      const params = fmt.notifications[0]?.params as {
        delta_usd: number;
        total_usd: number;
      };
      expect(params.delta_usd).toBe(0.02);
      expect(params.total_usd).toBe(0.02);

      pipe.detach();
    });

    it('tracks running totals per session_id independently', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('session:cost', { session_id: 'a', total_usd: 0.1 });
      adapter.emit('session:cost', { session_id: 'b', total_usd: 0.3 });
      adapter.emit('session:cost', { session_id: 'a', total_usd: 0.15 });
      await tick();

      const aDeltas = fmt.notifications
        .filter((n) => (n.params as { session_id: string }).session_id === 'a')
        .map((n) => (n.params as { delta_usd: number }).delta_usd);
      expect(aDeltas[0]).toBeCloseTo(0.1, 6);
      expect(aDeltas[1]).toBeCloseTo(0.05, 6);

      pipe.detach();
    });
  });

  describe('token delta computation', () => {
    it('forwards explicit per-turn deltas as-is', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('session:tokens', {
        session_id: 's',
        turn_id: 't',
        input_tokens: 100,
        output_tokens: 40,
        cache_read_tokens: 5,
      });
      await tick();
      const params = fmt.notifications[0]?.params as Record<string, number>;
      expect(params['input_tokens']).toBe(100);
      expect(params['output_tokens']).toBe(40);
      expect(params['cache_read_tokens']).toBe(5);
      pipe.detach();
    });

    it('computes deltas from total_input_tokens / total_output_tokens', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('session:tokens', {
        session_id: 's',
        total_input_tokens: 100,
        total_output_tokens: 40,
      });
      adapter.emit('session:tokens', {
        session_id: 's',
        total_input_tokens: 250,
        total_output_tokens: 90,
      });
      await tick();

      const first = fmt.notifications[0]?.params as Record<string, number>;
      const second = fmt.notifications[1]?.params as Record<string, number>;
      expect(first['input_tokens']).toBe(100);
      expect(first['output_tokens']).toBe(40);
      expect(second['input_tokens']).toBe(150);
      expect(second['output_tokens']).toBe(50);

      pipe.detach();
    });
  });

  describe('debug.di.phase verbose gating', () => {
    it('forwards debug.di.phase when verbose=true', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt, { verbose: true });
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('debug.di.phase', {
        phase: '0',
        state: 'start',
      });
      adapter.emit('debug.di.phase', {
        phase: '0',
        state: 'end',
        durationMs: 12,
      });
      await tick();

      expect(fmt.notifications).toHaveLength(2);
      expect(fmt.notifications[0]).toEqual({
        method: 'debug.di.phase',
        params: { phase: '0', state: 'start' },
      });
      expect(fmt.notifications[1]).toEqual({
        method: 'debug.di.phase',
        params: { phase: '0', state: 'end', durationMs: 12 },
      });
      pipe.detach();
    });

    it('drops debug.di.phase when verbose=false (default)', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('debug.di.phase', { phase: '0', state: 'start' });
      adapter.emit('debug.di.phase', { phase: '0', state: 'end' });
      await tick();

      expect(fmt.notifications).toHaveLength(0);
      pipe.detach();
    });

    it('drops debug.di.phase when verbose=false explicitly set', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt, { verbose: false });
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('debug.di.phase', { phase: '1', state: 'start' });
      await tick();

      expect(fmt.notifications).toHaveLength(0);
      pipe.detach();
    });

    it('does not gate non-debug events when verbose=false', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt, { verbose: false });
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('chat:chunk', { text: 'hello' });
      await tick();

      expect(fmt.notifications).toEqual([
        { method: 'agent.message', params: { text: 'hello' } },
      ]);
      pipe.detach();
    });
  });

  describe('lifecycle', () => {
    it('detach() stops emitting notifications', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);
      pipe.detach();

      adapter.emit('chat:chunk', { text: 'should not appear' });
      await tick();
      expect(fmt.notifications).toHaveLength(0);
    });

    it('attach() twice rebinds to the new adapter', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const a = new EventEmitter();
      const b = new EventEmitter();
      pipe.attach(a);
      pipe.attach(b);

      a.emit('chat:chunk', { text: 'a' });
      b.emit('chat:chunk', { text: 'b' });
      await tick();

      expect(fmt.notifications).toEqual([
        { method: 'agent.message', params: { text: 'b' } },
      ]);
      pipe.detach();
    });

    it('ignores unknown event types', async () => {
      const fmt = new RecordingFormatter();
      const pipe = new EventPipe(fmt);
      const adapter = new EventEmitter();
      pipe.attach(adapter);

      adapter.emit('not:mapped', { x: 1 });
      await tick();
      expect(fmt.notifications).toHaveLength(0);
      pipe.detach();
    });
  });
});
