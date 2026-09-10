import { injectable } from 'tsyringe';

/**
 * Cross-checkout visibility seam (TASK_2026_403).
 *
 * `TaskWriterService.create` allocates against the folder names it can SEE.
 * Before this port that was one directory listing of this checkout's own
 * `.ptah/specs`, so two worktrees of the same repository — and a branch already
 * pushed to `origin/main` — each allocated from a private view and minted the
 * same `TASK_YYYY_NNN`. This port lets the writer ask "what exists ELSEWHERE?"
 * without knowing that the answer comes from git.
 */
export interface ITaskFolderVisibility {
  /**
   * Folder names visible from anywhere BUT this workspace's own
   * `.ptah/specs` directory. The caller unions this with its own local scan.
   *
   * NEVER THROWS: an unreachable source contributes nothing. Every caller is on
   * the create path, where a failed remote lookup must degrade to "allocate
   * from what is local" rather than fail the create outright — the exclusive
   * `mkdir` claim is still the correctness guarantee, and this is only the
   * hint that keeps it from being contended.
   */
  listBeyondWorkspace(workspaceRoot: string): Promise<readonly string[]>;
}

/** DI token — defined beside the port (the `TASK_INDEX_NOTIFIER_TOKEN` pattern). */
export const TASK_FOLDER_VISIBILITY_TOKEN = Symbol.for(
  'TaskSpecsFolderVisibility',
);

/**
 * Null object: this checkout can see nothing beyond itself.
 *
 * The fixture for every spec that does not exercise allocation, and the honest
 * answer for a host that binds no git-backed reader.
 */
@injectable()
export class NoOpTaskFolderVisibility implements ITaskFolderVisibility {
  async listBeyondWorkspace(): Promise<readonly string[]> {
    return [];
  }
}
