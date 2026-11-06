import { GitFolderProbe } from './git-folder-probe';
import type { WorktreeListRead } from './git-probe-outcome';

describe('GitFolderProbe', () => {
  it('shares an in-flight list, caches confirmed answers, and invalidates them', async () => {
    let complete: ((value: WorktreeListRead) => void) | undefined;
    const list = jest.fn(() => new Promise<WorktreeListRead>((resolve) => { complete = resolve; }));
    const probe = new GitFolderProbe({
      list,
      commonDir: async () => ({ kind: 'dir', path: '/repo/.git' }),
    });
    const first = probe.readList('/repo');
    const second = probe.readList('/repo');
    expect(list).toHaveBeenCalledTimes(1);
    complete?.({ kind: 'listed', worktrees: [] });
    await Promise.all([first, second]);
    expect((await probe.readList('/repo')).kind).toBe('listed');
    expect(list).toHaveBeenCalledTimes(1);
    probe.invalidate('/repo');
    const fresh = probe.readList('/repo');
    expect(list).toHaveBeenCalledTimes(2);
    complete?.({ kind: 'listed', worktrees: [] });
    await fresh;
  });

  it('retries a failed probe after its short backoff', async () => {
    let now = 0;
    const list = jest.fn<Promise<WorktreeListRead>, []>()
      .mockResolvedValueOnce({ kind: 'failed', cause: new Error('timeout') })
      .mockResolvedValue({ kind: 'listed', worktrees: [] });
    const probe = new GitFolderProbe({
      list,
      commonDir: async () => ({ kind: 'not-a-repo' }),
      now: () => now,
    });
    expect((await probe.readList('/repo')).kind).toBe('failed');
    expect((await probe.readList('/repo')).kind).toBe('failed');
    expect(list).toHaveBeenCalledTimes(1);
    now = 2_001;
    expect((await probe.readList('/repo')).kind).toBe('listed');
    expect(list).toHaveBeenCalledTimes(2);
  });
});
