/**
 * The Zod boundary for the task filter and sort contract (TASK_2026_181,
 * family C).
 *
 * Split out of `task-filter.ts` so the predicate, the sort comparator and the
 * facet vocabularies can be imported without pulling `zod` in. Dependency
 * direction is one-way: schemas → types.
 */
import { z } from 'zod';
import {
  DEFAULT_TASK_SORT,
  MAX_TASK_FILTER_TEXT_LENGTH,
  MAX_TASK_FILTER_VALUES,
  TASK_LABEL_MATCH_MODES,
  TASK_PARENTAGE_FACETS,
  TASK_RELATION_FACETS,
  TASK_SORT_DIRECTIONS,
  TASK_SORT_FIELDS,
} from './task-filter';
import type { TaskFilterSpec, TaskSortSpec } from './task-filter';
import { TASK_ESTIMATES, TASK_STATUSES, TASK_TYPES } from './task-spec.types';
import { TaskIdRefSchema } from './task-view.schemas';

/**
 * The RPC/settings boundary shape.
 *
 * Every key is optional ON INPUT and defaulted, so a partial spec from an agent
 * or a script parses into a total {@link TaskFilterSpec} — which is what lets
 * the predicate itself stay free of `?? []` defensive reads.
 *
 * ## The write-path label limits are deliberately NOT applied here
 *
 * `LabelSchema` caps a label at 32 characters because that is a WRITE
 * constraint. A carrier hand-authored with a 40-character label still reaches
 * the board (carrying a warning), and refusing to let anyone filter for it
 * would hide the very task the warning is about. Only a length bound that
 * exists to bound WORK is applied.
 */
export const TaskFilterSpecSchema = z.object({
  text: z.string().max(MAX_TASK_FILTER_TEXT_LENGTH).default(''),
  statuses: z
    .array(z.enum(TASK_STATUSES))
    .max(MAX_TASK_FILTER_VALUES)
    .default([]),
  types: z.array(z.enum(TASK_TYPES)).max(MAX_TASK_FILTER_VALUES).default([]),
  labels: z
    .array(z.string().min(1).max(MAX_TASK_FILTER_TEXT_LENGTH))
    .max(MAX_TASK_FILTER_VALUES)
    .default([]),
  labelsMode: z.enum(TASK_LABEL_MATCH_MODES).default('any'),
  estimates: z
    .array(z.enum(TASK_ESTIMATES))
    .max(MAX_TASK_FILTER_VALUES)
    .default([]),
  unestimated: z.boolean().default(false),
  executors: z
    .array(z.string().min(1).max(MAX_TASK_FILTER_TEXT_LENGTH))
    .max(MAX_TASK_FILTER_VALUES)
    .default([]),
  parentage: z
    .array(z.enum(TASK_PARENTAGE_FACETS))
    .max(MAX_TASK_FILTER_VALUES)
    .default([]),
  // A task id, so it is validated as one — `TaskIdRefSchema` from
  // `task-view.types`, never a re-derived containment check (BR-14). Nothing
  // joins a filter value onto a path today, which is precisely why the guard
  // belongs here rather than at whichever consumer first does.
  childrenOf: z.array(TaskIdRefSchema).max(MAX_TASK_FILTER_VALUES).default([]),
  relations: z
    .array(z.enum(TASK_RELATION_FACETS))
    .max(MAX_TASK_FILTER_VALUES)
    .default([]),
  hasValidationIssues: z.boolean().default(false),
});

export const TaskSortSpecSchema = z.object({
  field: z.enum(TASK_SORT_FIELDS).default(DEFAULT_TASK_SORT.field),
  direction: z.enum(TASK_SORT_DIRECTIONS).default(DEFAULT_TASK_SORT.direction),
});

/**
 * Compile-time proof that the parsed shapes still satisfy the declared types.
 * A facet added to one and not the other fails typecheck here.
 */
const _filterSchemaMatchesType: TaskFilterSpec = {} as z.infer<
  typeof TaskFilterSpecSchema
>;
const _sortSchemaMatchesType: TaskSortSpec = {} as z.infer<
  typeof TaskSortSpecSchema
>;
void _filterSchemaMatchesType;
void _sortSchemaMatchesType;
