/**
 * `tasks.*` setting definitions — the F4 / BR-4 behaviour, pinned.
 *
 * These tests exist to stop a future reader from "tightening"
 * `TASKS_SAVED_VIEWS_DEF.schema` into a strict per-item shape. The comment on
 * the definition explains why that would be data loss; this file DEMONSTRATES
 * it, by running the strict schema someone would reach for beside the
 * permissive one over the same input and showing what each returns.
 */
import { z } from 'zod';

import {
  TASKS_SAVED_VIEWS_DEF,
  TASKS_ACTIVE_VIEW_ID_DEF,
} from './tasks-schema';
import { BaseSettingsRepository } from '../repositories/base-repository';
import { TasksSettings } from '../repositories/tasks-settings';
import type { ISettingsStore } from '../ports/settings-store.interface';

/** A store whose global values are whatever the test puts in the map. */
function createStore(seed: Record<string, unknown> = {}): ISettingsStore {
  const values = new Map(Object.entries(seed));
  return {
    readGlobal: <T>(key: string): T | undefined => values.get(key) as T,
    writeGlobal: async <T>(key: string, value: T): Promise<void> => {
      values.set(key, value);
    },
    readSecret: async () => undefined,
    writeSecret: async () => undefined,
    deleteSecret: async () => undefined,
    watchGlobal: () => ({ dispose: () => undefined }),
    watchSecret: () => ({ dispose: () => undefined }),
  } as unknown as ISettingsStore;
}

const GOOD_VIEW = {
  id: 'view-1',
  name: 'In progress',
  filter: { statuses: ['in_progress'] },
  sort: { field: 'updated', direction: 'desc' },
  order: 0,
};

describe('TASKS_SAVED_VIEWS_DEF', () => {
  it('is a global, plain setting defaulting to an empty list', () => {
    expect(TASKS_SAVED_VIEWS_DEF.key).toBe('tasks.savedViews');
    expect(TASKS_SAVED_VIEWS_DEF.scope).toBe('global');
    expect(TASKS_SAVED_VIEWS_DEF.sensitivity).toBe('plain');
    expect(TASKS_SAVED_VIEWS_DEF.default).toEqual([]);
  });

  it('accepts entries of any shape, so one bad view cannot fail the array', () => {
    const parsed = TASKS_SAVED_VIEWS_DEF.schema.safeParse([
      GOOD_VIEW,
      42,
      { bad: 1 },
    ]);

    expect(parsed.success).toBe(true);
  });

  it('still rejects a non-array, which is what makes the default a safe fallback', () => {
    expect(TASKS_SAVED_VIEWS_DEF.schema.safeParse('not a list').success).toBe(
      false,
    );
  });
});

/**
 * The reason BR-4 exists, made concrete.
 *
 * `handleFor()` safeParses the WHOLE stored value and falls back to the
 * definition default on failure — it has no notion of a partly-valid array. So
 * the choice of schema at this layer decides, for one malformed entry, between
 * "the good views still load" and "every view the user ever saved is gone".
 */
describe('BaseSettingsRepository.handleFor over a list setting', () => {
  const strictItem = z.object({
    id: z.string(),
    name: z.string(),
    filter: z.unknown(),
    sort: z.unknown(),
    order: z.number(),
  });

  class StrictProbe extends BaseSettingsRepository {
    readonly views = this.handleFor({
      ...TASKS_SAVED_VIEWS_DEF,
      schema: z.array(strictItem),
      default: [] as unknown[],
    });
  }

  const stored = { 'tasks.savedViews': [GOOD_VIEW, 42] };

  it('DISCARDS EVERY VIEW when the item schema is strict — the outcome FR-C2.3 forbids', () => {
    const probe = new StrictProbe(createStore(stored));

    // The good view is collateral damage of the bad one. This is the failure
    // the permissive schema exists to prevent; it is asserted here so the
    // consequence of changing that schema is visible rather than theoretical.
    expect(probe.views.get()).toEqual([]);
  });

  it('KEEPS the good view with the permissive schema actually shipped', () => {
    const tasks = new TasksSettings(createStore(stored));

    // Both entries survive this layer untouched. `tasks:getViews` then drops
    // the `42` per-item and reports `skipped: 1`, which is the only place with
    // somewhere to put the survivors.
    expect(tasks.savedViews.get()).toEqual([GOOD_VIEW, 42]);
  });
});

describe('TASKS_ACTIVE_VIEW_ID_DEF', () => {
  it('defaults to the empty string, meaning no active view', () => {
    expect(TASKS_ACTIVE_VIEW_ID_DEF.key).toBe('tasks.activeViewId');
    expect(TASKS_ACTIVE_VIEW_ID_DEF.default).toBe('');
  });

  it('falls back to the default when the stored value is not a string', () => {
    const tasks = new TasksSettings(createStore({ 'tasks.activeViewId': 7 }));
    expect(tasks.activeViewId.get()).toBe('');
  });
});

describe('TasksSettings', () => {
  it('round-trips a whole-list replace through the store', async () => {
    const tasks = new TasksSettings(createStore());

    await tasks.savedViews.set([GOOD_VIEW]);
    await tasks.activeViewId.set('view-1');

    expect(tasks.savedViews.get()).toEqual([GOOD_VIEW]);
    expect(tasks.activeViewId.get()).toBe('view-1');
  });
});
