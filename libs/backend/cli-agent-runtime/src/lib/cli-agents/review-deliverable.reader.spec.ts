/**
 * `readReviewDeliverables` - the host reads only this run's review files, by
 * real path inside the lane's roots, and one bad file never discards the
 * others (TASK_2026_857 Req 7, review findings F1, F2, F9).
 */
import { resolve } from 'path';
import {
  REVIEW_DELIVERABLE_MAX_FILES,
  REVIEW_DELIVERABLE_MAX_FILE_CHARS,
} from '@ptah-extension/lane-outcomes';
import type { LaneDeliverableCheck } from '@ptah-extension/shared';
import { readReviewDeliverables } from './review-deliverable.reader';

const ROOT = resolve('/ws');
const OUTSIDE = resolve('/elsewhere');

function fresh(path: string, bytes = 10): LaneDeliverableCheck {
  return { path, exists: true, bytes, writtenAfterSpawn: true };
}

function deps(
  files: Record<string, string>,
  links: Record<string, string> = {},
) {
  const readFile = jest.fn(async (path: string) => {
    const text = files[path];
    if (text === undefined) throw new Error('ENOENT');
    return text;
  });
  const realpath = jest.fn(async (path: string) => {
    const target = links[path] ?? path;
    if (target !== ROOT && files[target] === undefined)
      throw new Error('ENOENT');
    return target;
  });
  return { fileSystem: { readFile }, realpath, readFile };
}

describe('readReviewDeliverables', () => {
  it('reads an absolute deliverable path inside the root', async () => {
    const path = resolve(ROOT, 'review.md');
    const d = deps({ [path]: 'Verdict: APPROVED' });
    const read = await readReviewDeliverables([fresh(path)], [ROOT], d);
    expect(read).toEqual({
      text: 'Verdict: APPROVED',
      filesRead: 1,
      skipped: [],
    });
  });

  it('skips a missing, empty or stale file and keeps reading', async () => {
    const good = resolve(ROOT, 'good.md');
    const d = deps({ [good]: 'ok' });
    const read = await readReviewDeliverables(
      [
        { path: resolve(ROOT, 'missing.md'), exists: false },
        { path: resolve(ROOT, 'empty.md'), exists: true, bytes: 0 },
        {
          path: resolve(ROOT, 'old.md'),
          exists: true,
          bytes: 5,
          writtenAfterSpawn: false,
        },
        fresh(good),
      ],
      [ROOT],
      d,
    );
    expect(read).toEqual({
      text: 'ok',
      filesRead: 1,
      skipped: ['not-fresh', 'not-fresh', 'not-fresh'],
    });
    expect(d.readFile).toHaveBeenCalledTimes(1);
  });

  it('skips a file outside the root and reads the next one', async () => {
    const outside = resolve(OUTSIDE, 'secret.md');
    const good = resolve(ROOT, 'good.md');
    const d = deps({ [outside]: 'secret', [good]: 'ok' });
    const read = await readReviewDeliverables(
      [fresh(outside), fresh(good)],
      [ROOT],
      d,
    );
    expect(read).toEqual({
      text: 'ok',
      filesRead: 1,
      skipped: ['outside-root'],
    });
    expect(d.readFile).not.toHaveBeenCalledWith(outside);
  });

  it('refuses a symlink inside the root that resolves outside it', async () => {
    const link = resolve(ROOT, 'link.md');
    const target = resolve(OUTSIDE, 'secret.md');
    const d = deps({ [target]: 'secret' }, { [link]: target });
    const read = await readReviewDeliverables([fresh(link)], [ROOT], d);
    expect(read).toEqual({ text: '', filesRead: 0, skipped: ['outside-root'] });
    expect(d.readFile).not.toHaveBeenCalled();
  });

  it('skips an oversize file by its checked size and by its read length', async () => {
    const big = resolve(ROOT, 'big.md');
    const grew = resolve(ROOT, 'grew.md');
    const good = resolve(ROOT, 'good.md');
    const d = deps({
      [big]: 'x',
      [grew]: 'y'.repeat(REVIEW_DELIVERABLE_MAX_FILE_CHARS + 1),
      [good]: 'ok',
    });
    const read = await readReviewDeliverables(
      [
        fresh(big, REVIEW_DELIVERABLE_MAX_FILE_CHARS + 1),
        fresh(grew),
        fresh(good),
      ],
      [ROOT],
      d,
    );
    expect(read).toEqual({
      text: 'ok',
      filesRead: 1,
      skipped: ['too-large', 'too-large'],
    });
  });

  it('skips a file whose real path or contents cannot be read', async () => {
    const gone = resolve(ROOT, 'gone.md');
    const good = resolve(ROOT, 'good.md');
    const d = deps({ [good]: 'ok' });
    const read = await readReviewDeliverables(
      [fresh(gone), fresh(good)],
      [ROOT],
      d,
    );
    expect(read).toEqual({ text: 'ok', filesRead: 1, skipped: ['unreadable'] });
  });

  it('reads at most the lane-outcomes file count, in declared order', async () => {
    const paths = Array.from(
      { length: REVIEW_DELIVERABLE_MAX_FILES + 1 },
      (_, i) => resolve(ROOT, `r${i}.md`),
    );
    const d = deps(Object.fromEntries(paths.map((path, i) => [path, `t${i}`])));
    const read = await readReviewDeliverables(
      paths.map((path) => fresh(path)),
      [ROOT],
      d,
    );
    expect(read.filesRead).toBe(REVIEW_DELIVERABLE_MAX_FILES);
    expect(read.text).toBe(
      paths
        .slice(0, REVIEW_DELIVERABLE_MAX_FILES)
        .map((_, i) => `t${i}`)
        .join('\n'),
    );
  });

  it('accepts a file inside the task folder root', async () => {
    const taskRoot = resolve(OUTSIDE, 'specs');
    const path = resolve(taskRoot, 'review.md');
    const d = deps({ [path]: 'ok' }, { [taskRoot]: taskRoot });
    d.realpath.mockImplementation(async (p: string) => p);
    const read = await readReviewDeliverables(
      [fresh(path)],
      [ROOT, taskRoot],
      d,
    );
    expect(read.filesRead).toBe(1);
  });
});
