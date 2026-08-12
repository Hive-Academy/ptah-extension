import type { ISettingsStore } from '../ports/settings-store.interface';
import {
  TASKS_SAVED_VIEWS_DEF,
  TASKS_ACTIVE_VIEW_ID_DEF,
} from '../schema/tasks-schema';
import type { SettingHandle } from './setting-handle';
import { BaseSettingsRepository } from './base-repository';

/**
 * Typed accessor for the Tasks board's per-user settings (TASK_2026_181).
 *
 * Usage:
 *   const tasks = container.resolve<TasksSettings>(SETTINGS_TOKENS.TASKS_SETTINGS);
 *   const stored = tasks.savedViews.get();   // unknown[] — see below
 *   await tasks.savedViews.set([...stored, newViewAsPlainObject]);
 *
 * `savedViews` is typed `unknown[]` ON PURPOSE. The stored shape is a
 * `SavedTaskView[]`, but this lib cannot say so without depending on
 * `@ptah-extension/shared`, and it must not — the permissive storage schema is
 * itself load-bearing. `tasks:getViews` validates each entry against
 * `SavedTaskViewSchema` and is where the array becomes typed; the full
 * rationale is on `TASKS_SAVED_VIEWS_DEF`.
 */
export class TasksSettings extends BaseSettingsRepository {
  /** The whole saved-view list. Replaced as a unit, never merged. */
  readonly savedViews: SettingHandle<unknown[]>;

  /** Id of the view the board opens on; `''` means none. */
  readonly activeViewId: SettingHandle<string>;

  constructor(store: ISettingsStore) {
    super(store);
    this.savedViews = this.handleFor(TASKS_SAVED_VIEWS_DEF);
    this.activeViewId = this.handleFor(TASKS_ACTIVE_VIEW_ID_DEF);
  }
}
