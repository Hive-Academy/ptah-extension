import {
  isSameWorkingRoot,
  normalizeWorkspaceRoot as sharedNormalize,
} from '@ptah-extension/shared';
import { normalizeWorkspaceRoot, sameWorkspaceRoot } from './workspace-root';

describe('workspace root identity', () => {
  it('normalizes slashes, trailing separators and case', () => {
    expect(normalizeWorkspaceRoot('C:\\Work\\Repo\\')).toBe('c:/work/repo');
    expect(sameWorkspaceRoot('C:\\Work\\Repo', 'c:/work/repo/')).toBe(true);
    expect(sameWorkspaceRoot('/Work/Repo', '/work/repo')).toBe(true);
    expect(sameWorkspaceRoot('/work/a', '/work/b')).toBe(false);
  });

  it('folds the drive letter of a drive-root workspace', () => {
    expect(normalizeWorkspaceRoot('C:\\')).toBe('c:');
    expect(sameWorkspaceRoot('C:\\', 'c:\\')).toBe(true);
    expect(sameWorkspaceRoot('C:/', 'c:')).toBe(true);
    expect(sameWorkspaceRoot('C:\\', 'D:\\')).toBe(false);
  });

  it('uses the same rule as the git dock (shared normalizer)', () => {
    for (const [a, b] of [
      ['C:\\Repo\\wt\\', 'c:/repo/wt'],
      ['/Repo/WT', '/repo/wt'],
      ['/repo/a', '/repo/b'],
    ] as const) {
      expect(normalizeWorkspaceRoot(a)).toBe(sharedNormalize(a));
      expect(sameWorkspaceRoot(a, b)).toBe(isSameWorkingRoot(a, b));
    }
  });
});
