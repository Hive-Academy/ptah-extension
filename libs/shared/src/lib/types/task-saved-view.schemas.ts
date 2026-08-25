/**
 * The Zod half of the saved board views contract (TASK_2026_181, FR-C2).
 *
 * Split out of `task-saved-view.types.ts` so the `SavedTaskView` shape and its
 * three limits can be imported without pulling `zod` in. Dependency direction
 * is one-way: schemas → types.
 */
import { z } from 'zod';
import {
  TaskFilterSpecSchema,
  TaskSortSpecSchema,
} from './task-filter.schemas';
import {
  MAX_SAVED_VIEW_ID_LENGTH,
  MAX_SAVED_VIEW_NAME_LENGTH,
} from './task-saved-view.types';
import type { SavedTaskView } from './task-saved-view.types';

/**
 * The per-item validation schema (FR-C2.3, gate 3).
 *
 * This is applied ONE ENTRY AT A TIME at the RPC boundary, never to the stored
 * array as a whole. The settings layer stores `z.array(z.unknown())` on purpose
 * — see the comment on `TASKS_SAVED_VIEWS_DEF` in
 * `libs/backend/settings-core/src/schema/tasks-schema.ts` for why a strict
 * schema down there would turn one malformed view into zero surviving views.
 *
 * `filter` and `sort` are the IMPORTED shared schemas rather than restated
 * shapes, so a facet added to the board is a facet a saved view can store
 * without a second edit here. Both carry per-key defaults, which is what lets a
 * view stored before a facet existed still parse after it is added instead of
 * being counted as malformed and dropped.
 */
export const SavedTaskViewSchema = z.object({
  id: z.string().min(1).max(MAX_SAVED_VIEW_ID_LENGTH),
  name: z.string().min(1).max(MAX_SAVED_VIEW_NAME_LENGTH),
  filter: TaskFilterSpecSchema,
  sort: TaskSortSpecSchema,
  order: z.number().int().min(0),
});

/**
 * Compile-time proof that the parsed shape still satisfies the declared wire
 * type. A field added to one and not the other fails typecheck here.
 */
const _savedViewSchemaMatchesType: SavedTaskView = {} as z.infer<
  typeof SavedTaskViewSchema
>;
void _savedViewSchemaMatchesType;
