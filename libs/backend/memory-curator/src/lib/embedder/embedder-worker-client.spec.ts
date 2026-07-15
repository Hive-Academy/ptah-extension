/**
 * Unit tests for EmbedderWorkerClient — the main-side proxy over the embedder
 * utilityProcess. Uses a fake `IEmbedderWorkerProcess` (message loopback) so
 * these tests never spawn a real Electron utilityProcess.
 */
import 'reflect-metadata';
import type { Logger } from '@ptah-extension/vscode-core';
import type { ITracer } from '@ptah-extension/platform-core';
import { EmbedderWorkerClient } from './embedder-worker-client';
import type {
  IEmbedderWorkerProcess,
  IEmbedderWorkerProcessFactory,
} from './worker-process.port';

interface RecordingTracer extends ITracer {
  readonly spans: string[];
}

function makeRecordingTracer(): RecordingTracer {
  const spans: string[] = [];
  return {
    spans,
    startSpan: <T>(
      name: string,
      _attrs: Record<string, string | number | boolean>,
      fn: () => T,
    ): T => {
      spans.push(name);
      return fn();
    },
    addBreadcrumb: () => undefined,
  };
}

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/** Minimal fake `IEmbedderWorkerProcess` — message loopback, no real process. */
class FakeEmbedderWorkerProcess implements IEmbedderWorkerProcess {
  readonly sent: Array<{ id: number; type: string; [k: string]: unknown }> = [];
  killed = false;
  private readonly messageListeners: Array<(msg: unknown) => void> = [];
  private readonly exitListeners: Array<(code: number | null) => void> = [];

  postMessage(msg: unknown): void {
    this.sent.push(msg as { id: number; type: string });
  }

  on(event: 'message', cb: (msg: unknown) => void): void;
  on(event: 'exit', cb: (code: number | null) => void): void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- overload implementation signature must accept both narrower callback shapes
  on(event: 'message' | 'exit', cb: (arg: any) => void): void {
    if (event === 'message') {
      this.messageListeners.push(cb as (msg: unknown) => void);
    } else {
      this.exitListeners.push(cb as (code: number | null) => void);
    }
  }

  kill(): void {
    this.killed = true;
  }

  emitMessage(msg: unknown): void {
    for (const listener of this.messageListeners) listener(msg);
  }

  emitExit(code: number | null): void {
    for (const listener of this.exitListeners) listener(code);
  }

  lastSent(): { id: number; type: string; [k: string]: unknown } {
    const last = this.sent[this.sent.length - 1];
    if (!last) throw new Error('no message sent yet');
    return last;
  }
}

function buildFactory(): {
  factory: IEmbedderWorkerProcessFactory;
  workers: FakeEmbedderWorkerProcess[];
} {
  const workers: FakeEmbedderWorkerProcess[] = [];
  const factory: IEmbedderWorkerProcessFactory = {
    spawn: jest.fn(() => {
      const worker = new FakeEmbedderWorkerProcess();
      workers.push(worker);
      return worker;
    }),
  };
  return { factory, workers };
}

function buildClient(
  opts: {
    factory?: IEmbedderWorkerProcessFactory | null;
    idleMs?: number;
    tracer?: ITracer;
  } = {},
): {
  client: EmbedderWorkerClient;
  workers: FakeEmbedderWorkerProcess[];
  factory: IEmbedderWorkerProcessFactory | null;
  logger: Logger;
} {
  const logger = makeLogger();
  if (opts.factory === null) {
    return {
      client: new EmbedderWorkerClient(logger, null, opts.idleMs, opts.tracer),
      workers: [],
      factory: null,
      logger,
    };
  }
  const { factory, workers } = buildFactory();
  const client = new EmbedderWorkerClient(
    logger,
    factory,
    opts.idleMs,
    opts.tracer,
  );
  return { client, workers, factory, logger };
}

describe('EmbedderWorkerClient', () => {
  describe('available', () => {
    it('is false when no worker factory is registered (VS Code/CLI degrade)', () => {
      const { client } = buildClient({ factory: null });
      expect(client.available).toBe(false);
    });

    it('is true when a worker factory is registered', () => {
      const { client } = buildClient();
      expect(client.available).toBe(true);
    });
  });

  describe('embed', () => {
    it('sends an embed message and resolves with Float32Array results', async () => {
      const { client, workers } = buildClient();
      const promise = client.embed(['hello']);

      const worker = workers[0];
      const sent = worker.lastSent();
      expect(sent.type).toBe('embed');
      expect(sent.texts).toEqual(['hello']);

      worker.emitMessage({ id: sent.id, ok: true, vectors: [[0.1, 0.2, 0.3]] });
      const result = await promise;
      expect(result).toHaveLength(1);
      expect(result[0]).toBeInstanceOf(Float32Array);
      expect(Array.from(result[0])[0]).toBeCloseTo(0.1, 5);
      expect(Array.from(result[0])[1]).toBeCloseTo(0.2, 5);
      expect(Array.from(result[0])[2]).toBeCloseTo(0.3, 5);
    });

    it('rejects when the worker responds with ok:false', async () => {
      const { client, workers } = buildClient();
      const promise = client.embed(['crash']);
      const worker = workers[0];
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: false,
        error: 'OOM in worker',
      });
      await expect(promise).rejects.toThrow('OOM in worker');
    });

    it('wraps the embed round-trip in a memory.embed span', async () => {
      const tracer = makeRecordingTracer();
      const { client, workers } = buildClient({ tracer });
      const promise = client.embed(['hello']);
      const worker = workers[0];
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: true,
        vectors: [[0.1, 0.2, 0.3]],
      });
      const result = await promise;
      expect(result).toHaveLength(1);
      expect(tracer.spans).toContain('memory.embed');
    });

    it('short-circuits empty input without opening a span or spawning', async () => {
      const tracer = makeRecordingTracer();
      const { client, workers } = buildClient({ tracer });
      const result = await client.embed([]);
      expect(result).toEqual([]);
      expect(tracer.spans).not.toContain('memory.embed');
      expect(workers).toHaveLength(0);
    });
  });

  describe('rerank', () => {
    it('sends a rerank message with the correct shape and resolves ranked', async () => {
      const { client, workers } = buildClient();
      const candidates = [
        { id: 'a', text: 'first candidate' },
        { id: 'b', text: 'second candidate' },
      ];
      const promise = client.rerank('my query', candidates, 2);

      const worker = workers[0];
      const sent = worker.lastSent();
      expect(sent.type).toBe('rerank');
      expect(sent.query).toBe('my query');
      expect(sent.candidates).toEqual(candidates);
      expect(sent.topK).toBe(2);

      worker.emitMessage({
        id: sent.id,
        ok: true,
        ranked: [
          { id: 'b', score: 0.9 },
          { id: 'a', score: 0.5 },
        ],
      });
      await expect(promise).resolves.toEqual([
        { id: 'b', score: 0.9 },
        { id: 'a', score: 0.5 },
      ]);
    });

    it('rejects when the worker responds with ok:false', async () => {
      const { client, workers } = buildClient();
      const promise = client.rerank('query', [{ id: 'x', text: 'text' }], 1);
      const worker = workers[0];
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: false,
        error: 'model load timeout',
      });
      await expect(promise).rejects.toThrow('model load timeout');
    });
  });

  describe('warmup', () => {
    it('sends a warmup message and resolves on success', async () => {
      const { client, workers } = buildClient();
      const promise = client.warmup();
      const worker = workers[0];
      expect(worker.lastSent().type).toBe('warmup');
      worker.emitMessage({ id: worker.lastSent().id, ok: true, ranked: [] });
      await expect(promise).resolves.toBeUndefined();
    });

    it('rejects when the worker responds with ok:false', async () => {
      const { client, workers } = buildClient();
      const promise = client.warmup();
      const worker = workers[0];
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: false,
        error: 'ONNX init failed',
      });
      await expect(promise).rejects.toThrow('ONNX init failed');
    });
  });

  describe('pipeline-progress fan-out', () => {
    it('re-emits pipeline-progress worker messages through onPipelineProgress', async () => {
      const { client, workers } = buildClient();
      const events: unknown[] = [];
      client.onPipelineProgress((info) => events.push(info));

      const promise = client.embed(['x']);
      const worker = workers[0];
      worker.emitMessage({
        type: 'pipeline-progress',
        info: { status: 'progress', progress: 42 },
      });
      expect(events).toEqual([{ status: 'progress', progress: 42 }]);

      worker.emitMessage({
        id: worker.lastSent().id,
        ok: true,
        vectors: [[0.1]],
      });
      await promise;
    });

    it('stops delivering events to a disposed listener', async () => {
      const { client, workers } = buildClient();
      const events: unknown[] = [];
      const sub = client.onPipelineProgress((info) => events.push(info));
      sub.dispose();

      const promise = client.embed(['x']);
      const worker = workers[0];
      worker.emitMessage({
        type: 'pipeline-progress',
        info: { status: 'initiate' },
      });
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: true,
        vectors: [[0.1]],
      });
      await promise;

      expect(events).toEqual([]);
    });
  });

  describe('respawn after exit', () => {
    it('rejects in-flight requests on exit and respawns fresh on the next request', async () => {
      const { client, workers } = buildClient();
      const promise = client.embed(['a']).catch((e: unknown) => e);
      const worker1 = workers[0];

      worker1.emitExit(1);
      const err = await promise;
      expect(err).toBeInstanceOf(Error);

      const promise2 = client.embed(['b']);
      expect(workers).toHaveLength(2);
      const worker2 = workers[1];
      worker2.emitMessage({
        id: worker2.lastSent().id,
        ok: true,
        vectors: [[0.2]],
      });
      await expect(promise2).resolves.toHaveLength(1);
    });

    it('does not set a permanent failed flag — a clean exit (code 0) also respawns on next request', async () => {
      const { client, workers } = buildClient();
      const promise = client.embed(['a']).catch((e: unknown) => e);
      workers[0].emitExit(0);
      await promise;

      void client.embed(['b']).catch(() => undefined);
      expect(workers).toHaveLength(2);
    });
  });

  describe('idle teardown', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('tears down the worker after the idle timeout once in-flight requests settle', async () => {
      jest.useFakeTimers();
      const { client, workers } = buildClient({ idleMs: 1000 });
      const promise = client.embed(['a']);
      const worker = workers[0];
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: true,
        vectors: [[0.1]],
      });
      await promise;

      expect(worker.killed).toBe(false);
      jest.advanceTimersByTime(1000);
      expect(worker.killed).toBe(true);
      expect(worker.sent.some((m) => m.type === 'dispose')).toBe(true);
    });

    it('cancels the idle timer when a new request arrives before it fires, reusing the warm worker', async () => {
      jest.useFakeTimers();
      const { client, workers } = buildClient({ idleMs: 1000 });

      const p1 = client.embed(['a']);
      const worker = workers[0];
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: true,
        vectors: [[0.1]],
      });
      await p1;

      jest.advanceTimersByTime(500);

      const p2 = client.embed(['b']);
      expect(workers).toHaveLength(1); // reused the warm worker, no respawn
      worker.emitMessage({
        id: worker.lastSent().id,
        ok: true,
        vectors: [[0.2]],
      });
      await p2;

      jest.advanceTimersByTime(500);
      expect(worker.killed).toBe(false);

      jest.advanceTimersByTime(500);
      expect(worker.killed).toBe(true);
    });
  });

  describe('crash-loop backoff', () => {
    it('refuses to spawn for a backoff window after 3 exits within the crash-loop window', async () => {
      const { client, workers } = buildClient();

      for (let i = 0; i < 3; i++) {
        const p = client.embed([`t${i}`]).catch((e: unknown) => e);
        workers[workers.length - 1].emitExit(1);
        await p;
      }
      expect(workers).toHaveLength(3);

      await expect(client.embed(['refused'])).rejects.toThrow(
        /crash-loop backoff/,
      );
      expect(workers).toHaveLength(3);
    });
  });

  describe('dispose', () => {
    it('rejects pending requests, kills the worker, and is idempotent', async () => {
      const { client, workers } = buildClient();
      const promise = client.embed(['a']).catch((e: unknown) => e);
      const worker = workers[0];

      await client.dispose();

      const err = await promise;
      expect(err).toBeInstanceOf(Error);
      expect(worker.killed).toBe(true);
      await expect(client.dispose()).resolves.toBeUndefined();
    });
  });

  describe('unavailable runtime (no worker factory)', () => {
    it('throws instead of attempting to spawn', async () => {
      const { client } = buildClient({ factory: null });
      await expect(client.embed(['a'])).rejects.toThrow(
        /no worker process factory registered/,
      );
    });
  });
});
