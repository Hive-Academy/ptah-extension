import {
  COMMON_DIR_CONFIRMED_TTL_MS,
  GitFolderProbe,
  WORKTREE_PROBE_SHORT_TTL_MS,
} from './git-folder-probe';
import type { CommonDirRead, WorktreeListRead } from './git-probe-outcome';

type ListLoad = (
  folder: string,
  signal?: AbortSignal,
) => Promise<WorktreeListRead>;
type CommonLoad = (dir: string, signal?: AbortSignal) => Promise<CommonDirRead>;

function build(
  list: jest.Mock<ReturnType<ListLoad>, Parameters<ListLoad>>,
  now: () => number = () => 0,
  commonDir: jest.Mock<
    ReturnType<CommonLoad>,
    Parameters<CommonLoad>
  > = jest.fn<ReturnType<CommonLoad>, Parameters<CommonLoad>>(async () => ({
    kind: 'dir',
    path: '/repo/.git',
  })),
): GitFolderProbe {
  return new GitFolderProbe({
    reader: { readWorktreeList: list, readCommonDir: commonDir },
    now,
  });
}

/** A list read that settles when `settle` is called, or fails on abort. */
function deferredList(): {
  list: jest.Mock<ReturnType<ListLoad>, Parameters<ListLoad>>;
  settle: (value: WorktreeListRead) => void;
  childSignals: AbortSignal[];
} {
  const settlers: Array<(value: WorktreeListRead) => void> = [];
  const childSignals: AbortSignal[] = [];
  const list = jest.fn((_folder: string, signal?: AbortSignal) => {
    if (signal) childSignals.push(signal);
    return new Promise<WorktreeListRead>((resolve) => {
      settlers.push(resolve);
      signal?.addEventListener('abort', () =>
        resolve({ kind: 'failed', cause: new Error('cancelled') }),
      );
    });
  });
  return {
    list,
    settle: (value) => {
      for (const resolve of settlers.splice(0)) resolve(value);
    },
    childSignals,
  };
}

const LISTED: WorktreeListRead = { kind: 'listed', worktrees: [] };

describe('GitFolderProbe', () => {
  it('shares an in-flight list, caches the answer briefly, and invalidates it', async () => {
    const { list, settle } = deferredList();
    const probe = build(list);
    const first = probe.readList('/repo');
    const second = probe.readList('/repo');
    expect(list).toHaveBeenCalledTimes(1);
    settle(LISTED);
    await Promise.all([first, second]);
    expect((await probe.readList('/repo')).kind).toBe('listed');
    expect(list).toHaveBeenCalledTimes(1);
    probe.invalidate('/repo');
    const fresh = probe.readList('/repo');
    expect(list).toHaveBeenCalledTimes(2);
    settle(LISTED);
    await fresh;
  });

  // Review M1: a list is a negative answer for every path it does not name,
  // so a worktree created outside Ptah must be listed within seconds.
  it('re-lists after the short TTL even without an invalidation', async () => {
    let now = 0;
    const list = jest.fn<ReturnType<ListLoad>, Parameters<ListLoad>>(
      async () => LISTED,
    );
    const probe = build(list, () => now);
    await probe.readList('/repo');
    now = WORKTREE_PROBE_SHORT_TTL_MS + 1;
    await probe.readList('/repo');
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('keeps a confirmed common dir for the long TTL only', async () => {
    let now = 0;
    const commonDir = jest.fn<ReturnType<CommonLoad>, Parameters<CommonLoad>>(
      async () => ({ kind: 'dir', path: '/repo/.git' }),
    );
    const probe = build(jest.fn(), () => now, commonDir);
    await probe.readCommonDir('/repo');
    now = WORKTREE_PROBE_SHORT_TTL_MS + 1;
    await probe.readCommonDir('/repo');
    expect(commonDir).toHaveBeenCalledTimes(1);
    now = COMMON_DIR_CONFIRMED_TTL_MS + 1;
    await probe.readCommonDir('/repo');
    expect(commonDir).toHaveBeenCalledTimes(2);
  });

  it('retries a failed probe after its short backoff', async () => {
    let now = 0;
    const list = jest
      .fn<ReturnType<ListLoad>, Parameters<ListLoad>>()
      .mockResolvedValueOnce({ kind: 'failed', cause: new Error('timeout') })
      .mockResolvedValue(LISTED);
    const probe = build(list, () => now);
    expect((await probe.readList('/repo')).kind).toBe('failed');
    expect((await probe.readList('/repo')).kind).toBe('failed');
    expect(list).toHaveBeenCalledTimes(1);
    now = WORKTREE_PROBE_SHORT_TTL_MS + 1;
    expect((await probe.readList('/repo')).kind).toBe('listed');
    expect(list).toHaveBeenCalledTimes(2);
  });

  // Review M3: a later caller must not inherit an earlier caller's abort.
  it('never joins an aborted flight and never caches its answer', async () => {
    const { list, settle } = deferredList();
    const probe = build(list);
    const deadline = new AbortController();
    const doomed = probe.readList('/repo', deadline.signal);
    deadline.abort();

    const later = probe.readList('/repo');
    expect(list).toHaveBeenCalledTimes(2);
    await expect(doomed).resolves.toMatchObject({ kind: 'failed' });
    settle(LISTED);
    await expect(later).resolves.toEqual(LISTED);

    // The aborted answer was not stored; the live one was.
    await expect(probe.readList('/repo')).resolves.toEqual(LISTED);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does not store an answer from a flight that was aborted', async () => {
    const list = jest.fn<ReturnType<ListLoad>, Parameters<ListLoad>>(
      async (_folder, signal) =>
        signal?.aborted
          ? { kind: 'failed', cause: new Error('cancelled') }
          : LISTED,
    );
    const probe = build(list);
    const aborted = new AbortController();
    aborted.abort();
    await expect(
      probe.readList('/repo', aborted.signal),
    ).resolves.toMatchObject({
      kind: 'failed',
    });
    await expect(probe.readList('/repo')).resolves.toEqual(LISTED);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('aborts the child only after every signalled waiter aborted, and never with an unsigned waiter', async () => {
    const { list, childSignals, settle } = deferredList();
    const probe = build(list);
    const a = new AbortController();
    const b = new AbortController();
    const first = probe.readList('/repo', a.signal);
    const second = probe.readList('/repo', b.signal);
    a.abort();
    expect(childSignals[0].aborted).toBe(false);
    b.abort();
    expect(childSignals[0].aborted).toBe(true);
    await Promise.all([first, second]);

    const c = new AbortController();
    const signalled = probe.readList('/other', c.signal);
    const unsigned = probe.readList('/other');
    c.abort();
    expect(childSignals[1].aborted).toBe(false);
    settle(LISTED);
    await expect(Promise.all([signalled, unsigned])).resolves.toEqual([
      LISTED,
      LISTED,
    ]);
  });

  // Review #16: waiters that gave up are not retained for the flight's life.
  it('releases the abort listener of every waiter when the flight settles', async () => {
    const { list, settle } = deferredList();
    const probe = build(list);
    const keep = new AbortController();
    const keepRemove = jest.spyOn(keep.signal, 'removeEventListener');
    const pending = probe.readList('/repo', keep.signal);
    const gaveUpRemovals: jest.SpyInstance[] = [];
    for (let i = 0; i < 50; i++) {
      const gaveUp = new AbortController();
      gaveUpRemovals.push(jest.spyOn(gaveUp.signal, 'removeEventListener'));
      void probe.readList('/repo', gaveUp.signal);
      gaveUp.abort();
    }
    settle(LISTED);
    await pending;
    // An aborted waiter's `once` listener is already gone, and the flight
    // dropped it at abort time instead of holding it until settle.
    expect(keepRemove).toHaveBeenCalledTimes(1);
    for (const removal of gaveUpRemovals)
      expect(removal).not.toHaveBeenCalled();
  });
});
