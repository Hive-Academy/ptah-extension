import { Injectable, signal } from '@angular/core';

/** How the Tasks surface lays its tasks out. */
export type TaskViewMode = 'kanban' | 'list';

/** The modes, in switcher order. */
export const TASK_VIEW_MODES: readonly TaskViewMode[] = ['kanban', 'list'];

export const TASK_VIEW_MODE_LABELS: Record<TaskViewMode, string> = {
  kanban: 'Kanban',
  list: 'List',
};

const STORAGE_KEY = 'ptah.tasks.viewMode';

function isTaskViewMode(value: unknown): value is TaskViewMode {
  return value === 'kanban' || value === 'list';
}

/**
 * TaskViewModeService
 *
 * Which layout the Tasks surface renders, remembered across reloads.
 *
 * ## Why `localStorage` and not `tasks:saveViews`
 *
 * A saved view is a LENS — a filter and a sort, describing which tasks the user
 * wants to see. The view mode is a rendering preference and applies to every
 * lens equally, so folding it into `SavedTaskView` would make each stored view
 * carry a layout it has no opinion about, and would put a per-machine
 * preference in a file that is shared as project settings. `localStorage` is
 * already how this codebase persists webview-local UI state (see
 * `TabWorkspacePartitionService`), and it is per-machine by construction.
 *
 * ## Storage is a boundary, so it is validated and it may fail
 *
 * A stored value is untrusted text: anything that is not one of the two known
 * modes falls back to `kanban`, which is the layout that shipped. Reads and
 * writes are both guarded — `localStorage` throws outright when storage is
 * disabled, and a preference that cannot be saved must not take the board down
 * with it. A failed write costs the user the memory of their choice on the next
 * reload and nothing else.
 */
@Injectable({ providedIn: 'root' })
export class TaskViewModeService {
  private readonly _mode = signal<TaskViewMode>(readStoredMode());

  public readonly mode = this._mode.asReadonly();

  public setMode(mode: TaskViewMode): void {
    if (mode === this._mode()) return;
    this._mode.set(mode);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, mode);
    } catch {
      // Storage is unavailable or full. The mode still applies for this
      // session; only the memory of it is lost.
    }
  }
}

function readStoredMode(): TaskViewMode {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isTaskViewMode(stored) ? stored : 'kanban';
  } catch {
    return 'kanban';
  }
}
