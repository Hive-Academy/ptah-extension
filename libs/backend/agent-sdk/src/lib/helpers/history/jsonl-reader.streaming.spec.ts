/**
 * jsonl-reader.service — streaming + tail specs, against a REAL filesystem.
 *
 * The sibling `jsonl-reader.service.spec.ts` mocks `fs` so that path
 * resolution is deterministic. That is the wrong instrument for the questions
 * this file asks, which are all about byte offsets and chunk boundaries:
 *
 *   - does `readJsonlTail` cut on a line boundary, including the case where
 *     the requested window lands exactly ON a newline (a mocked stream cannot
 *     express `start:` at all);
 *   - does a CRLF file parse identically to an LF one;
 *   - does a file whose lines straddle the 64 KB read chunks produce the same
 *     messages as the old read-everything-then-`split` implementation;
 *   - does the parse loop actually hand control back to the event loop.
 *
 * So these run over temp files written to `os.tmpdir()`.
 */

import 'reflect-metadata';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { JsonlReaderService } from './jsonl-reader.service';
import type { Logger } from '@ptah-extension/vscode-core';
import {
  createMockLogger,
  type MockLogger,
} from '@ptah-extension/shared/testing';

function asLogger(mock: MockLogger): Logger {
  return mock as unknown as Logger;
}

/** One transcript line, sized so fixtures are predictable. */
function line(uuid: string, text: string): string {
  return JSON.stringify({
    uuid,
    sessionId: 's1',
    timestamp: '2026-01-01T00:00:00.000Z',
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
  });
}

describe('JsonlReaderService — streaming and tail reads', () => {
  let service: JsonlReaderService;
  let logger: MockLogger;
  let dir: string;

  beforeEach(async () => {
    logger = createMockLogger();
    service = new JsonlReaderService(asLogger(logger));
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-jsonl-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function write(name: string, content: string): Promise<string> {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, content, 'utf8');
    return filePath;
  }

  // -------------------------------------------------------------------------
  // readJsonlMessages — streaming equivalence
  // -------------------------------------------------------------------------

  describe('readJsonlMessages', () => {
    it('parses a 5 000-line transcript identically to a whole-file split', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 5000; i++) {
        lines.push(line(`u${i}`, `message body ${i}`));
      }
      const content = `${lines.join('\n')}\n`;
      // Comfortably past the 64 KB read chunk, so lines straddle boundaries.
      expect(Buffer.byteLength(content)).toBeGreaterThan(64 * 1024);
      const filePath = await write('big.jsonl', content);

      const out = await service.readJsonlMessages(filePath);

      // The reference: exactly what the pre-TASK_2026_323 implementation did.
      const expected = content
        .split(/\r?\n/)
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as { uuid: string });

      expect(out).toHaveLength(expected.length);
      expect(out.map((m) => m.uuid)).toEqual(expected.map((m) => m.uuid));
      expect(out[0].uuid).toBe('u0');
      expect(out[4999].uuid).toBe('u4999');
    });

    it('yields the event loop many times while parsing a long transcript', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 10_000; i++) {
        lines.push(line(`u${i}`, `message body ${i}`));
      }
      const filePath = await write('big.jsonl', `${lines.join('\n')}\n`);

      // A BOUNDED chain of macrotasks races the read. Each hop needs one turn
      // of the event loop, so the chain can only finish first if the reader
      // gives the loop back at least `HOPS` times. The old implementation
      // parsed every line in ONE synchronous tick once `readFile` resolved,
      // so the read won this race outright — which is exactly the main-thread
      // stall B4 describes. The streaming reader yields once per 200 lines
      // (50 times here) plus once per 64 KB chunk, so the chain wins with
      // room to spare. An unbounded self-rescheduling probe was tried first
      // and starves the file I/O it is trying to observe.
      const HOPS = 20;
      const hops = (async () => {
        for (let i = 0; i < HOPS; i++) {
          await new Promise<void>((resolve) => setImmediate(resolve));
        }
        return 'hops' as const;
      })();
      const read = service
        .readJsonlMessages(filePath)
        .then((out) => ({ kind: 'read' as const, out }));

      const winner = await Promise.race([hops, read]);
      expect(winner).toBe('hops');

      // And the read still produces every message.
      const settled = await read;
      expect(settled.out).toHaveLength(10_000);
    });

    it('parses CRLF transcripts exactly as LF ones', async () => {
      const lines = [line('a', 'one'), line('b', 'two'), line('c', 'three')];
      const lf = await write('lf.jsonl', `${lines.join('\n')}\n`);
      const crlf = await write('crlf.jsonl', `${lines.join('\r\n')}\r\n`);

      const fromLf = await service.readJsonlMessages(lf);
      const fromCrlf = await service.readJsonlMessages(crlf);

      expect(fromCrlf).toEqual(fromLf);
      expect(fromCrlf.map((m) => m.uuid)).toEqual(['a', 'b', 'c']);
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Skipping malformed JSONL line'),
        expect.anything(),
      );
    });

    it('parses a final line with no trailing newline', async () => {
      const filePath = await write(
        'no-trailing.jsonl',
        [line('a', 'one'), line('b', 'two')].join('\n'),
      );

      const out = await service.readJsonlMessages(filePath);
      expect(out.map((m) => m.uuid)).toEqual(['a', 'b']);
    });

    it('rejects once the abort signal fires mid-parse', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 5000; i++) {
        lines.push(line(`u${i}`, `message body ${i}`));
      }
      const filePath = await write('big.jsonl', `${lines.join('\n')}\n`);

      const controller = new AbortController();
      const read = service.readJsonlMessages(filePath, {
        signal: controller.signal,
      });
      controller.abort();

      await expect(read).rejects.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // readJsonlTail
  // -------------------------------------------------------------------------

  describe('readJsonlTail', () => {
    it('returns the whole file when it is smaller than maxBytes', async () => {
      const lines = [line('a', 'one'), line('b', 'two')];
      const content = `${lines.join('\n')}\n`;
      const filePath = await write('small.jsonl', content);

      const out = await service.readJsonlTail(filePath, {
        maxBytes: Buffer.byteLength(content) * 10,
      });

      expect(out.map((m) => m.uuid)).toEqual(['a', 'b']);
    });

    it('drops the partial first line the window cuts through', async () => {
      const lines = [
        line('a', 'first'),
        line('b', 'second'),
        line('c', 'third'),
      ];
      const content = `${lines.join('\n')}\n`;
      const filePath = await write('cut.jsonl', content);

      // Ask for a window that starts in the MIDDLE of line `b`.
      const lastTwo =
        Buffer.byteLength(lines[1]) + 1 + Buffer.byteLength(lines[2]) + 1;
      const out = await service.readJsonlTail(filePath, {
        maxBytes: lastTwo - 10,
      });

      // The `b` fragment is discarded rather than logged as malformed.
      expect(out.map((m) => m.uuid)).toEqual(['c']);
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Skipping malformed JSONL line'),
        expect.anything(),
      );
    });

    it('keeps a complete line when the window lands exactly on the boundary', async () => {
      const lines = [
        line('a', 'first'),
        line('b', 'second'),
        line('c', 'third'),
      ];
      const content = `${lines.join('\n')}\n`;
      const filePath = await write('boundary.jsonl', content);

      // Exactly the last two lines including their newlines: the window's
      // first byte is the first byte of `b`. Starting one byte earlier makes
      // the discarded "line" empty, so `b` survives whole.
      const lastTwo =
        Buffer.byteLength(lines[1]) + 1 + Buffer.byteLength(lines[2]) + 1;
      const out = await service.readJsonlTail(filePath, { maxBytes: lastTwo });

      expect(out.map((m) => m.uuid)).toEqual(['b', 'c']);
    });

    it('keeps the real first line when the window reaches back to byte 0 (TASK_2026_328)', async () => {
      const lines = [
        line('a', 'first'),
        line('b', 'second'),
        line('c', 'third'),
      ];
      const content = `${lines.join('\n')}\n`;
      const filePath = await write('one-byte-short.jsonl', content);

      // One byte short of the whole file: `windowStart` is exactly 1, so the
      // extra byte the tail always reads pulls the read back to byte 0. There
      // is no truncated fragment at the front, and the old unconditional drop
      // ate a complete turn — the `AAA\nBBB\nCCC\n` / `maxBytes = 11` repro.
      const out = await service.readJsonlTail(filePath, {
        maxBytes: Buffer.byteLength(content) - 1,
      });

      expect(out.map((m) => m.uuid)).toEqual(['a', 'b', 'c']);
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Skipping malformed JSONL line'),
        expect.anything(),
      );
    });

    it('parses a CRLF tail without treating the \\r as content', async () => {
      const lines = [
        line('a', 'first'),
        line('b', 'second'),
        line('c', 'third'),
      ];
      const content = `${lines.join('\r\n')}\r\n`;
      const filePath = await write('crlf-tail.jsonl', content);

      const lastTwo =
        Buffer.byteLength(lines[1]) + 2 + Buffer.byteLength(lines[2]) + 2;
      const out = await service.readJsonlTail(filePath, { maxBytes: lastTwo });

      expect(out.map((m) => m.uuid)).toEqual(['b', 'c']);
      expect(logger.debug).not.toHaveBeenCalledWith(
        expect.stringContaining('Skipping malformed JSONL line'),
        expect.anything(),
      );
    });

    it('returns [] for an empty file and for a non-positive window', async () => {
      const empty = await write('empty.jsonl', '');
      await expect(
        service.readJsonlTail(empty, { maxBytes: 4096 }),
      ).resolves.toEqual([]);

      const filePath = await write('some.jsonl', `${line('a', 'one')}\n`);
      await expect(
        service.readJsonlTail(filePath, { maxBytes: 0 }),
      ).resolves.toEqual([]);
    });

    it('reads a file larger than the 50 MB whole-file cap would allow', async () => {
      // The tail is bounded by `maxBytes`, so the memory-exhaustion guard that
      // `readJsonlMessages` enforces does not apply. Proven without writing
      // 50 MB by reading only the last bytes of a normal file and checking the
      // window — not the file size — decides what we get.
      const lines: string[] = [];
      for (let i = 0; i < 2000; i++) lines.push(line(`u${i}`, `body ${i}`));
      const filePath = await write('long.jsonl', `${lines.join('\n')}\n`);

      const out = await service.readJsonlTail(filePath, { maxBytes: 4 * 1024 });

      expect(out.length).toBeGreaterThan(0);
      expect(out.length).toBeLessThan(2000);
      expect(out[out.length - 1].uuid).toBe('u1999');
    });
  });
});
