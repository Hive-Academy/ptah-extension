import {
  isSameWorkingRoot,
  resolveSessionWorkingRoot,
  type SessionWorkingRootInput,
} from './session-working-root';

const EMPTY: SessionWorkingRootInput = {
  organizationWorktreePath: null,
  agentOriginWorktreePath: null,
  sessionCwd: null,
  workspaceRoot: null,
};

describe('resolveSessionWorkingRoot', () => {
  it.each([
    [
      'organization worktree wins over everything',
      {
        organizationWorktreePath: '/repo/.wt/a',
        agentOriginWorktreePath: '/repo/.wt/b',
        sessionCwd: '/repo/cwd',
        workspaceRoot: '/repo',
      },
      '/repo/.wt/a',
      'organization-worktree',
    ],
    [
      'agent origin wins when no organization worktree',
      {
        ...EMPTY,
        agentOriginWorktreePath: '/repo/.wt/b',
        sessionCwd: '/repo/cwd',
        workspaceRoot: '/repo',
      },
      '/repo/.wt/b',
      'agent-origin-worktree',
    ],
    [
      'session cwd wins over the workspace root',
      { ...EMPTY, sessionCwd: '/repo/cwd', workspaceRoot: '/repo' },
      '/repo/cwd',
      'session-cwd',
    ],
    [
      'workspace root is the last resort',
      { ...EMPTY, workspaceRoot: '/repo' },
      '/repo',
      'workspace-root',
    ],
  ] as const)('%s', (_name, input, root, source) => {
    expect(resolveSessionWorkingRoot(input)).toEqual({ root, source });
  });

  it('skips empty and whitespace-only candidates', () => {
    expect(
      resolveSessionWorkingRoot({
        ...EMPTY,
        organizationWorktreePath: '',
        agentOriginWorktreePath: '   ',
        workspaceRoot: '/repo',
      }),
    ).toEqual({ root: '/repo', source: 'workspace-root' });
  });

  it('trims the chosen root', () => {
    expect(
      resolveSessionWorkingRoot({ ...EMPTY, sessionCwd: '  C:\\repo  ' }).root,
    ).toBe('C:\\repo');
  });

  it('returns null root and source when every candidate is absent', () => {
    expect(resolveSessionWorkingRoot(EMPTY)).toEqual({
      root: null,
      source: null,
    });
  });

  it('is deterministic for the same input', () => {
    const input = { ...EMPTY, agentOriginWorktreePath: '/x', workspaceRoot: '/y' };
    expect(resolveSessionWorkingRoot(input)).toEqual(
      resolveSessionWorkingRoot(input),
    );
  });
});

describe('isSameWorkingRoot', () => {
  it('folds Windows case and separators', () => {
    expect(isSameWorkingRoot('C:\\Repo\\wt\\', 'c:/repo/wt')).toBe(true);
  });

  it('treats null and undefined as never equal', () => {
    expect(isSameWorkingRoot(null, null)).toBe(false);
    expect(isSameWorkingRoot(undefined, '/a')).toBe(false);
  });

  it('distinguishes different roots', () => {
    expect(isSameWorkingRoot('/repo/a', '/repo/b')).toBe(false);
  });

  // The one "same root" rule (review: divergent normalizers). Chat's
  // `workspace-root.ts` delegates here, so stats cards and the dock agree.
  it('folds case on POSIX paths too, and drive roots', () => {
    expect(isSameWorkingRoot('/Repo/WT/', '/repo/wt')).toBe(true);
    expect(isSameWorkingRoot('C:\\', 'c:')).toBe(true);
    expect(isSameWorkingRoot('C:\\', 'D:\\')).toBe(false);
  });
});
