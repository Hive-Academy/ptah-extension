import { injectable } from 'tsyringe';

/**
 * Narrow write-order seam (R3.5).
 *
 * `TaskWriterService` mutates the `task.md` file FIRST, then calls
 * `applyFolderChange` so the derived index reparses exactly the folder that
 * changed and emits the `tasks:changed` push. The writer depends only on this
 * narrow port (ISP) — not on the full index service.
 *
 * Batch A registers the `NoOp` default so DI resolves before the index lands;
 * Batch B re-points `TASK_INDEX_NOTIFIER_TOKEN` at the real `TaskIndexService`.
 */
export interface ITaskIndexNotifier {
  applyFolderChange(workspaceRoot: string, folderName: string): Promise<void>;
}

/** DI token — defined beside the port (skill-synthesis SPEC_FINDINGS_TOKEN pattern). */
export const TASK_INDEX_NOTIFIER_TOKEN = Symbol.for('TaskSpecsIndexNotifier');

/** Default no-op used until the real index service is wired (Batch B). */
@injectable()
export class NoOpTaskIndexNotifier implements ITaskIndexNotifier {
  async applyFolderChange(): Promise<void> {
    // Intentionally does nothing — no derived index in Batch A.
  }
}
