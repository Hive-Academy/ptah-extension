import { normalizeWorkspaceRoot, sameWorkspaceRoot } from './workspace-root';

describe('workspace root identity', () => {
  it('normalizes slashes and Windows drive case without folding Unix paths', () => {
    expect(normalizeWorkspaceRoot('C:\\Work\\Repo\\')).toBe('c:/work/repo');
    expect(sameWorkspaceRoot('C:\\Work\\Repo', 'c:/work/repo/')).toBe(true);
    expect(sameWorkspaceRoot('/Work/Repo', '/work/repo')).toBe(false);
  });

  it('folds the drive letter of a drive-root workspace', () => {
    expect(normalizeWorkspaceRoot('C:\\')).toBe('c:');
    expect(sameWorkspaceRoot('C:\\', 'c:\\')).toBe(true);
    expect(sameWorkspaceRoot('C:/', 'c:')).toBe(true);
    expect(sameWorkspaceRoot('C:\\', 'D:\\')).toBe(false);
  });
});
