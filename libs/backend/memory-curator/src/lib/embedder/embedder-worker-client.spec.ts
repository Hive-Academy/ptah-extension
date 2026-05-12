/**
 * Unit tests for EmbedderWorkerClient.
 *
 * Uses a message-passing fake that simulates the worker thread protocol
 * without spawning a real Worker. The fake is built from Node's
 * EventEmitter to replicate the `Worker` message/error/exit surface.
 */
import 'reflect-metadata';
import { EventEmitter } from 'node:events';
import { Worker } from 'node:worker_threads';
import type { Logger } from '@ptah-extension/vscode-core';
import { EmbedderWorkerClient } from './embedder-worker-client';

// ---------------------------------------------------------------------------
// Fake Worker
// ---------------------------------------------------------------------------

/**
 * A minimal Worker-shaped EventEmitter that auto-replies to postMessage calls
 * via the provided handler. Because EmbedderWorkerClient registers 'message',
 * 'error', and 'exit' listeners on the Worker it creates, FakeWorker must
 * support EventEmitter so those registrations work.
 */
class FakeWorker extends EventEmitter {
  private readonly handler: (
    msg: unknown,
    reply: (response: unknown) => void,
  ) => void;

  constructor(
    handler: (msg: unknown, reply: (response: unknown) => void) => void,
  ) {
    super();
    this.handler = handler;
  }

  postMessage(msg: unknown): void {
    // Use setImmediate so the pending map is populated before the reply fires.
    setImmediate(() => {
      this.handler(msg, (resp) => this.emit('message', resp));
    });
  }

  terminate(): Promise<void> {
    return Promise.resolve();
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  } as unknown as Logger;
}

/**
 * Build an EmbedderWorkerClient and inject a FakeWorker into it by
 * monkey-patching `ensureWorker` so the real Worker constructor is never
 * called.
 */
function makeClient(
  fakeHandler: (msg: unknown, reply: (resp: unknown) => void) => void,
): EmbedderWorkerClient {
  const logger = makeLogger();
  const client = new EmbedderWorkerClient(logger, '/fake/worker.mjs');

  const fake = new FakeWorker(fakeHandler);

  // Patch ensureWorker so the fake is returned and its listeners are wired
  // through the same listener-setup path as the real worker.
  (
    client as unknown as {
      ensureWorker: () => Worker;
    }
  ).ensureWorker = () => {
    // First call wires the listeners on the fake; subsequent calls return the
    // same instance (matching the real implementation's "if (this.worker)"
    // short-circuit).
    if (!(client as unknown as { worker: unknown }).worker) {
      fake.on(
        'message',
        (msg: {
          id: number;
          ok: boolean;
          error?: string;
          vectors?: number[][];
          ranked?: unknown[];
        }) => {
          const pending = (
            client as unknown as {
              pending: Map<
                number,
                { resolve: (v: unknown) => void; reject: (e: Error) => void }
              >;
            }
          ).pending;
          const slot = pending.get(msg.id);
          if (!slot) return;
          pending.delete(msg.id);
          slot.resolve(msg);
        },
      );
      fake.on('error', (err: Error) => {
        const pending = (
          client as unknown as {
            pending: Map<
              number,
              { resolve: (v: unknown) => void; reject: (e: Error) => void }
            >;
          }
        ).pending;
        for (const slot of pending.values()) slot.reject(err);
        pending.clear();
      });
      (client as unknown as { worker: unknown }).worker = fake;
    }
    return fake as unknown as Worker;
  };

  return client;
}

// ---------------------------------------------------------------------------
// embed() — smoke test to confirm existing behaviour is preserved
// ---------------------------------------------------------------------------

describe('EmbedderWorkerClient.embed', () => {
  it('sends an EMBED message and resolves with Float32Array results', async () => {
    const client = makeClient((msg, reply) => {
      const m = msg as { id: number; type: string };
      if (m.type === 'embed') {
        reply({ id: m.id, ok: true, vectors: [[0.1, 0.2, 0.3]] });
      }
    });

    const result = await client.embed(['hello']);
    expect(result).toHaveLength(1);
    expect(result[0]).toBeInstanceOf(Float32Array);
    // Float32Array loses precision on round-trip; use approximate comparisons.
    expect(Array.from(result[0])[0]).toBeCloseTo(0.1, 5);
    expect(Array.from(result[0])[1]).toBeCloseTo(0.2, 5);
    expect(Array.from(result[0])[2]).toBeCloseTo(0.3, 5);
  });

  it('rejects when the worker responds with ok:false', async () => {
    const client = makeClient((msg, reply) => {
      const m = msg as { id: number; type: string };
      if (m.type === 'embed') {
        reply({ id: m.id, ok: false, error: 'OOM in worker' });
      }
    });

    await expect(client.embed(['crash'])).rejects.toThrow('OOM in worker');
  });
});

// ---------------------------------------------------------------------------
// rerank()
// ---------------------------------------------------------------------------

describe('EmbedderWorkerClient.rerank', () => {
  it('sends a RERANK message with the correct shape', async () => {
    const sentMessages: unknown[] = [];
    const client = makeClient((msg, reply) => {
      sentMessages.push(msg);
      const m = msg as { id: number; type: string };
      if (m.type === 'rerank') {
        reply({
          id: m.id,
          ok: true,
          ranked: [
            { id: 'b', score: 0.9 },
            { id: 'a', score: 0.5 },
          ],
        });
      }
    });

    const candidates = [
      { id: 'a', text: 'first candidate' },
      { id: 'b', text: 'second candidate' },
    ];
    const result = await client.rerank('my query', candidates, 2);

    // Verify the sent message shape.
    const sent = sentMessages[0] as {
      type: string;
      query: string;
      candidates: unknown[];
      topK: number;
    };
    expect(sent.type).toBe('rerank');
    expect(sent.query).toBe('my query');
    expect(sent.candidates).toEqual(candidates);
    expect(sent.topK).toBe(2);

    // Verify the resolved value.
    expect(result).toEqual([
      { id: 'b', score: 0.9 },
      { id: 'a', score: 0.5 },
    ]);
  });

  it('rejects when the worker responds with ok:false', async () => {
    const client = makeClient((msg, reply) => {
      const m = msg as { id: number; type: string };
      if (m.type === 'rerank') {
        reply({ id: m.id, ok: false, error: 'model load timeout' });
      }
    });

    await expect(
      client.rerank('query', [{ id: 'x', text: 'text' }], 1),
    ).rejects.toThrow('model load timeout');
  });
});

// ---------------------------------------------------------------------------
// warmup()
// ---------------------------------------------------------------------------

describe('EmbedderWorkerClient.warmup', () => {
  it('sends a WARMUP message and resolves on success', async () => {
    const sentMessages: unknown[] = [];
    const client = makeClient((msg, reply) => {
      sentMessages.push(msg);
      const m = msg as { id: number; type: string };
      if (m.type === 'warmup') {
        reply({ id: m.id, ok: true, ranked: [] });
      }
    });

    await expect(client.warmup()).resolves.toBeUndefined();

    const sent = sentMessages[0] as { type: string };
    expect(sent.type).toBe('warmup');
  });

  it('rejects when the worker responds with ok:false', async () => {
    const client = makeClient((msg, reply) => {
      const m = msg as { id: number; type: string };
      if (m.type === 'warmup') {
        reply({ id: m.id, ok: false, error: 'ONNX init failed' });
      }
    });

    await expect(client.warmup()).rejects.toThrow('ONNX init failed');
  });
});
