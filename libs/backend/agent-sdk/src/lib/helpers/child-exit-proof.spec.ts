import { isChildExitProved, spawnedChildPid } from './child-exit-proof';

describe('isChildExitProved', () => {
  it('accepts any numeric exit status', () => {
    expect(isChildExitProved({}, 0)).toBe(true);
    expect(isChildExitProved({}, 1)).toBe(true);
  });

  it('accepts a signal-only exit only when the handle observed the child exit', () => {
    expect(isChildExitProved({ exitObserved: true }, null)).toBe(true);
    expect(isChildExitProved({ exitObserved: false }, null)).toBe(false);
    expect(isChildExitProved({}, null)).toBe(false);
    expect(isChildExitProved({ exitObserved: 'yes' }, null)).toBe(false);
  });
});

describe('spawnedChildPid', () => {
  it('prefers the pid the spawner reports once the child started', async () => {
    await expect(spawnedChildPid({ pid: undefined, whenSpawned: Promise.resolve(4321) })).resolves.toBe(4321);
    await expect(spawnedChildPid({ pid: 17 })).resolves.toBe(17);
  });

  it('is null for a child that never started or exposes no valid pid', async () => {
    await expect(spawnedChildPid({ whenSpawned: Promise.resolve(null) })).resolves.toBeNull();
    await expect(spawnedChildPid({ pid: 0 })).resolves.toBeNull();
    await expect(spawnedChildPid({})).resolves.toBeNull();
  });
});
