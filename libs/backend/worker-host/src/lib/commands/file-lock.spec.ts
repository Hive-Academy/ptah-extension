import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withFileLock } from './file-lock';

it('serializes competing writers and releases the lock after failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ptah-worker-lock-'));
  const file = join(directory, 'tokens.json');
  const order: string[] = [];
  let release!: () => void;
  const first = withFileLock(file, async () => {
    order.push('first start');
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    order.push('first end');
  });
  try {
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1));
    const second = withFileLock(file, async () => {
      order.push('second');
    });
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first start', 'first end', 'second']);
    await expect(
      withFileLock(file, async () => {
        throw new Error('write failed');
      }),
    ).rejects.toThrow('write failed');
    await expect(withFileLock(file, async () => 'recovered')).resolves.toBe(
      'recovered',
    );
  } finally {
    release?.();
    await first;
    await rm(directory, { recursive: true, force: true });
  }
});
