import { Injectable, computed, inject } from '@angular/core';
import { GitStatusService } from '@ptah-extension/git-ui';
import type { GitFileStatus } from '@ptah-extension/shared';

/**
 * FileTreeGitIndexService — the two tree-only derivations of the active
 * workspace's git status, re-homed out of `GitStatusService`.
 *
 * TASK_2026_385 moved `GitStatusService` into `@ptah-extension/git-ui` and
 * dropped `fileStatusMap` / `changedDirPrefixes` from it, because both exist
 * solely for {@link FileTreeNodeComponent} and the tree is not part of the git
 * surface. They live here instead of inside the component so they are computed
 * ONCE per status update rather than once per visible node — see the perf
 * contract in `changedDirPrefixes` below.
 *
 * Root-provided, and deleted together with this library in Phase 4.
 */
@Injectable({ providedIn: 'root' })
export class FileTreeGitIndexService {
  private readonly gitStatus = inject(GitStatusService);

  /**
   * Map<relativePath, GitFileStatus[]> for O(1) lookup by FileTreeNodeComponent.
   * Keys are relative paths from workspace root (as reported by git status --porcelain=v2).
   * Values are arrays because a file can have both staged and unstaged changes
   * (e.g., staged 'M' and unstaged 'M' for a partially staged file).
   */
  readonly fileStatusMap = computed(() => {
    const map = new Map<string, GitFileStatus[]>();
    for (const file of this.gitStatus.files()) {
      const existing = map.get(file.path);
      if (existing) {
        existing.push(file);
      } else {
        map.set(file.path, [file]);
      }
    }
    return map;
  });

  /**
   * Every directory (relative to the workspace root) that transitively
   * contains a changed entry, as a `Set` for O(1) membership tests.
   *
   * `FileTreeNodeComponent.hasChangedChildren` used to answer that question by
   * scanning every key of {@link fileStatusMap} per directory node, which made
   * a `git:status-update` cost O(changed files × visible directory nodes).
   * Building the ancestor set once per status update is O(total path segments)
   * and turns every node's evaluation into a single `Set.has` (B3 AC1, AC2).
   *
   * Contract:
   * - Paths are stored **without** a trailing slash and always with `/`
   *   separators, so a lookup must normalize the same way (B3 AC5). Windows is
   *   the primary development platform, so `\`-separated payloads must land in
   *   the same buckets as `/`-separated ones.
   * - An entry that is itself a directory (an untracked directory, which git
   *   reports as a single entry instead of listing its files) is added in its
   *   own right, not only as an ancestor — it does transitively contain
   *   changed files (B3 AC3).
   * - Derived from `GitStatusService.files()`, which is already the ACTIVE
   *   workspace's slice, so other workspaces cannot leak in (B3 AC4) and a
   *   reverted change clears the parent entries on the next update (B3 AC6).
   *   Never cache this in a mutable field; `files` carries `equal: filesEqual`,
   *   so the `computed` already recomputes only on a genuine change.
   */
  readonly changedDirPrefixes = computed<ReadonlySet<string>>(() => {
    const prefixes = new Set<string>();
    for (const file of this.gitStatus.files()) {
      let path = file.path.replace(/\\/g, '/');
      while (path.endsWith('/')) path = path.slice(0, -1);
      if (!path) continue;

      if (file.isDirectory) prefixes.add(path);

      for (let i = path.indexOf('/'); i !== -1; i = path.indexOf('/', i + 1)) {
        if (i > 0) prefixes.add(path.slice(0, i));
      }
    }
    return prefixes;
  });
}
