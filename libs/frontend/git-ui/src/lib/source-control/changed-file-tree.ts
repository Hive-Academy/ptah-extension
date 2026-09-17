interface ChangedFileTreeNodeBase {
  name: string;
  path: string;
  additions: number | null;
  deletions: number | null;
}

export type ChangedFileTreeNode<T = { path: string }> =
  | (ChangedFileTreeNodeBase & {
      kind: 'folder';
      children: ChangedFileTreeNode<T>[];
    })
  | (ChangedFileTreeNodeBase & {
      kind: 'file';
      children: [];
      file: T;
    });

export function buildChangedFileTree<
  T extends {
    path: string;
    additions?: number | null;
    deletions?: number | null;
    isDirectory?: boolean;
  },
>(files: readonly T[], query = ''): ChangedFileTreeNode<T>[] {
  const needle = query.trim().toLowerCase();
  const roots: ChangedFileTreeNode<T>[] = [];
  for (const file of files) {
    if (needle && !file.path.toLowerCase().includes(needle)) continue;
    const parts = file.path.replace(/\\/g, '/').split('/');
    let level = roots;
    let current = '';
    parts.forEach((name, index) => {
      current = current ? `${current}/${name}` : name;
      const kind =
        index === parts.length - 1 && !file.isDirectory ? 'file' : 'folder';
      let node = level.find((item) => item.name === name && item.kind === kind);
      if (!node) {
        node =
          kind === 'file'
            ? {
                name,
                path: current,
                kind,
                children: [],
                file,
                additions: file.additions ?? null,
                deletions: file.deletions ?? null,
              }
            : {
                name,
                path: current,
                kind,
                children: [],
                additions: 0,
                deletions: 0,
              };
        level.push(node);
      }
      if (node.kind === 'folder') level = node.children;
    });
  }
  const sort = (nodes: ChangedFileTreeNode<T>[]): ChangedFileTreeNode<T>[] =>
    nodes
      .map((node) =>
        node.kind === 'folder'
          ? { ...node, children: sort(node.children) }
          : node,
      )
      .sort((a, b) =>
        a.kind === b.kind
          ? a.name.localeCompare(b.name)
          : a.kind === 'folder'
            ? -1
            : 1,
      );
  return sort(roots);
}
