import { buildChangedFileTree } from './changed-file-tree';
describe('buildChangedFileTree', () => {
  it('filters case-insensitively and retains ancestors', () => {
    const tree = buildChangedFileTree(
      [
        { path: 'Src/Feature/A.ts', additions: 2, deletions: 1 },
        { path: 'test/b.ts' },
      ],
      'feature',
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('Src');
    expect(tree[0].children[0].children[0]).toMatchObject({
      name: 'A.ts',
      additions: 2,
      deletions: 1,
    });
  });

  it('keeps every file that shares a folder', () => {
    const tree = buildChangedFileTree([
      { path: 'src/a.ts', isDirectory: false },
      { path: 'src/c.ts', isDirectory: false },
    ]);
    expect(tree[0].children.map((node) => node.name)).toEqual(['a.ts', 'c.ts']);
  });
});
