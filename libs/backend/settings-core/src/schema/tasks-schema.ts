import { z } from 'zod';
import { defineSetting } from './definition';

/**
 * Tasks-board setting definitions (TASK_2026_181, FR-C2).
 *
 * ## `tasks.savedViews` IS DELIBERATELY PERMISSIVE. DO NOT "TIGHTEN" IT.
 *
 * `z.array(z.unknown())` reads like an oversight. It is not, and the reason is
 * not visible from this file's call site, so it is written down here.
 *
 * `BaseSettingsRepository.handleFor()` (`../repositories/base-repository.ts:36`)
 * runs `safeParse` over the WHOLE stored value and falls back to `def.default`
 * when it fails. It has no concept of a partly-valid array. So a strict
 * per-item schema HERE would mean that one malformed view — a hand-edited
 * settings.json, a view written by a newer build, a truncated file — makes
 * `get()` return `[]` and the user loses EVERY view they ever saved. FR-C2.3
 * forbids exactly that: a bad entry is skipped and reported, the rest load.
 *
 * Per-item validation therefore happens ONE LEVEL UP, at the RPC boundary,
 * where `tasks:getViews` runs `SavedTaskViewSchema.safeParse(entry)` per
 * element, drops the failures with a warning and reports `skipped: n`. That is
 * the only place with somewhere to put the survivors.
 *
 * `settings-core` does not depend on `@ptah-extension/shared` today and must
 * not start — see `cli-subagent-schema.ts`, which stores its list under the
 * same split for the same reason.
 */
export const TASKS_SAVED_VIEWS_DEF = defineSetting({
  key: 'tasks.savedViews',
  scope: 'global',
  sensitivity: 'plain',
  schema: z.array(z.unknown()),
  default: [] as unknown[],
  sinceVersion: 1,
});

/**
 * The id of the view the board opens on.
 *
 * `''` means "no active view". A dedicated empty-string sentinel rather than an
 * optional key because {@link defineSetting} defaults are total: every read
 * returns a `string`, so no consumer has to decide what a missing value means.
 * The RPC boundary maps `''` onto `null` for the wire.
 */
export const TASKS_ACTIVE_VIEW_ID_DEF = defineSetting({
  key: 'tasks.activeViewId',
  scope: 'global',
  sensitivity: 'plain',
  schema: z.string(),
  default: '',
  sinceVersion: 1,
});
