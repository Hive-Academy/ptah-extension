import { Readable } from 'stream';
import { collectBounded } from './bounded-collect';

describe('collectBounded (TASK_2026_559 Batch 23b r1 M1)', () => {
  it('stops an endless producer at the limit and closes it', async () => {
    let produced = 0;
    let closed = false;
    async function* endless(): AsyncGenerator<string> {
      try {
        for (;;) {
          produced++;
          yield `file-${produced}.ts`;
        }
      } finally {
        closed = true;
      }
    }

    const items = await collectBounded(endless(), 3);

    expect(items).toEqual(['file-1.ts', 'file-2.ts', 'file-3.ts']);
    expect(produced).toBe(3);
    expect(closed).toBe(true);
  });

  it('destroys an endless readable stream after the limit (bounded reads)', async () => {
    let reads = 0;
    const stream = new Readable({
      objectMode: true,
      read() {
        reads++;
        this.push(`/tree/dir-${reads}/file.ts`);
      },
    });

    const items = await collectBounded<string>(stream, 5);

    expect(items).toHaveLength(5);
    expect(stream.destroyed).toBe(true);
    // Read-ahead is bounded by the stream's high-water mark, not the tree.
    expect(reads).toBeLessThanOrEqual(5 + stream.readableHighWaterMark + 1);
  });

  it('returns every item of a source shorter than the limit', async () => {
    expect(await collectBounded(Readable.from(['a', 'b']), 10)).toEqual([
      'a',
      'b',
    ]);
  });

  it('takes nothing for a limit below 1', async () => {
    expect(await collectBounded(Readable.from(['a']), 0)).toEqual([]);
  });
});
