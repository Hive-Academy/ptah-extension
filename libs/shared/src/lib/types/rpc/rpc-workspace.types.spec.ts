import {
  RECENT_WORKSPACES_MAX,
  RecentWorkspaceSchema,
  WorkspaceListRecentParamsSchema,
  WorkspaceListRecentResultSchema,
} from './rpc-workspace.types';

const entry = (index: number) => ({
  path: `/repos/project-${index}`,
  name: `project-${index}`,
  lastOpenedAt: 1_700_000_000_000 + index,
});

describe('workspace:listRecent contract', () => {
  it('accepts empty params and rejects unknown keys', () => {
    expect(WorkspaceListRecentParamsSchema.safeParse({}).success).toBe(true);
    expect(
      WorkspaceListRecentParamsSchema.safeParse({ limit: 3 }).success,
    ).toBe(false);
  });

  it('accepts a well-formed entry', () => {
    expect(RecentWorkspaceSchema.safeParse(entry(1)).success).toBe(true);
  });

  it.each([
    ['empty path', { ...entry(1), path: '' }],
    ['over-long path', { ...entry(1), path: 'x'.repeat(4097) }],
    ['empty name', { ...entry(1), name: '' }],
    ['over-long name', { ...entry(1), name: 'n'.repeat(256) }],
    ['negative timestamp', { ...entry(1), lastOpenedAt: -1 }],
    ['fractional timestamp', { ...entry(1), lastOpenedAt: 1.5 }],
    ['unsafe timestamp', { ...entry(1), lastOpenedAt: 2 ** 60 }],
    ['extra key', { ...entry(1), pinned: true }],
  ])('rejects an entry with %s', (_label, value) => {
    expect(RecentWorkspaceSchema.safeParse(value).success).toBe(false);
  });

  it(`caps the result at ${RECENT_WORKSPACES_MAX} entries`, () => {
    const full = Array.from({ length: RECENT_WORKSPACES_MAX }, (_, i) =>
      entry(i),
    );
    expect(
      WorkspaceListRecentResultSchema.safeParse({ workspaces: full }).success,
    ).toBe(true);
    expect(
      WorkspaceListRecentResultSchema.safeParse({
        workspaces: [...full, entry(99)],
      }).success,
    ).toBe(false);
  });

  it('rejects extra keys on the result', () => {
    expect(
      WorkspaceListRecentResultSchema.safeParse({ workspaces: [], more: 1 })
        .success,
    ).toBe(false);
  });
});
