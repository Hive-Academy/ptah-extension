import type { GitFileStatus } from '@ptah-extension/shared';
import { buildChangedFileTree } from './changed-file-tree';
describe('buildChangedFileTree', () => {
  it('places conflicted (U) and type-changed (T) rows as files, entry intact', () => {
    const conflicted: GitFileStatus = {
      path: 'src/merge.ts',
      status: 'U',
      staged: false,
      conflict: { kind: 'add-add' },
    };
    const typeChanged: GitFileStatus = {
      path: 'src/link.ts',
      status: 'T',
      staged: false,
      additions: 0,
      deletions: 1,
    };
    const submodule: GitFileStatus = {
      path: 'vendor/lib',
      status: 'M',
      staged: false,
      submodule: true,
    };

    const tree = buildChangedFileTree([conflicted, typeChanged, submodule]);

    expect(tree.map((node) => node.name)).toEqual(['src', 'vendor']);
    const [link, merge] = tree[0].children;
    expect(merge).toMatchObject({
      kind: 'file',
      name: 'merge.ts',
      additions: null,
      deletions: null,
    });
    expect(merge.kind === 'file' && merge.file).toBe(conflicted);
    expect(link).toMatchObject({ kind: 'file', additions: 0, deletions: 1 });
    expect(link.kind === 'file' && link.file).toBe(typeChanged);
    // A submodule is a changed entry, not a folder to expand.
    expect(tree[1].children[0]).toMatchObject({ kind: 'file', name: 'lib' });
  });

  it('filters U and T rows by path like any other row', () => {
    const tree = buildChangedFileTree<GitFileStatus>(
      [
        { path: 'a/conflict.ts', status: 'U', staged: false },
        { path: 'b/type.ts', status: 'T', staged: true },
      ],
      'TYPE',
    );
    expect(tree).toHaveLength(1);
    expect(tree[0].children[0]).toMatchObject({ name: 'type.ts' });
  });

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

  it('lists an untracked directory as one leaf entry, not an empty folder (parity row 80)', () => {
    const dir: GitFileStatus = {
      path: 'build/out/',
      status: '??',
      staged: false,
      isDirectory: true,
    };
    const tree = buildChangedFileTree([dir]);
    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ kind: 'folder', name: 'build' });
    expect(tree[0].children).toHaveLength(1);
    const [leaf] = tree[0].children;
    expect(leaf).toMatchObject({
      kind: 'file',
      name: 'out',
      path: 'build/out',
      children: [],
    });
    expect(leaf.kind === 'file' && leaf.file).toBe(dir);
  });

  it('keeps every file that shares a folder', () => {
    const tree = buildChangedFileTree([
      { path: 'src/a.ts', isDirectory: false },
      { path: 'src/c.ts', isDirectory: false },
    ]);
    expect(tree[0].children.map((node) => node.name)).toEqual(['a.ts', 'c.ts']);
  });
});
