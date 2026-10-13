import { normalizeWorkspaceRoot, sameWorkspaceRoot } from './workspace-root';

describe('workspace root identity', () => {
  it('normalizes slashes and Windows drive case without folding Unix paths', () => {
    expect(normalizeWorkspaceRoot('C:\\Work\\Repo\\')).toBe('c:/work/repo');
    expect(sameWorkspaceRoot('C:\\Work\\Repo', 'c:/work/repo/')).toBe(true);
    expect(sameWorkspaceRoot('/Work/Repo', '/work/repo')).toBe(false);
  });
});
