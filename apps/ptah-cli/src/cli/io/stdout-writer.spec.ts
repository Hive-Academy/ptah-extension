/**
 * Unit tests for the serialized stdout writer.
 *
 * TASK_2026_104 Batch 3.
 */

import { PassThrough } from 'node:stream';

import { StdoutWriter } from './stdout-writer.js';

const tick = () => new Promise((r) => setImmediate(r));

describe('StdoutWriter', () => {
  it('writes a single payload to the underlying stream', async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));
    const writer = new StdoutWriter({ output });

    await writer.write('hello\n');
    await tick();
    expect(Buffer.concat(chunks).toString('utf8')).toBe('hello\n');
  });

  it('preserves FIFO ordering under concurrent writes', async () => {
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));
    const writer = new StdoutWriter({ output });

    // Fire 20 writes without awaiting individually, then await all.
    const promises: Promise<void>[] = [];
    for (let i = 0; i < 20; i++) {
      promises.push(writer.write(`line-${i}\n`));
    }
    await Promise.all(promises);
    await tick();
    const text = Buffer.concat(chunks).toString('utf8');
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(20);
    for (let i = 0; i < 20; i++) {
      expect(lines[i]).toBe(`line-${i}`);
    }
  });

  it('flush() resolves when the queue drains', async () => {
    const output = new PassThrough();
    const writer = new StdoutWriter({ output });
    writer.write('a\n');
    writer.write('b\n');
    writer.write('c\n');
    await writer.flush();
    // After flush, no further writes should be in flight.
    await writer.flush();
    expect(true).toBe(true);
  });

  it('flush() on an idle writer resolves immediately', async () => {
    const writer = new StdoutWriter({ output: new PassThrough() });
    await expect(writer.flush()).resolves.toBeUndefined();
  });

  it('await drain when underlying stream returns false (backpressure)', async () => {
    // PassThrough with a tiny highWaterMark forces drain semantics.
    const output = new PassThrough({ highWaterMark: 8 });
    const writer = new StdoutWriter({ output });

    // Don't consume — write should still complete via drain after the stream
    // is read.
    const writeP = writer.write('payload-much-larger-than-eight-bytes\n');

    // Drain by reading.
    setTimeout(() => {
      // Consume to drain the buffer.
      output.read();
    }, 10);

    await expect(writeP).resolves.toBeUndefined();
  });

  it('rejects the write promise on stream error', async () => {
    const output = new PassThrough();
    // Attach a listener so the synchronous 'error' event from destroy() is
    // handled (no unhandled-error crash).
    output.on('error', () => {
      /* swallow — we want to observe the write rejection below */
    });
    const writer = new StdoutWriter({ output });
    // Force the stream into a destroyed state mid-write.
    output.destroy(new Error('pipe broke'));
    await expect(writer.write('x\n')).rejects.toThrow();
  });
});
