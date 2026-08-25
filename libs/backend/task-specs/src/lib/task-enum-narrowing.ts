/**
 * The ONE narrowing of the two task-spec frontmatter enums (`type`, `status`).
 *
 * This file exists because there were two of them. `parseTaskFile` narrowed
 * `type` with a case-SENSITIVE `z.enum(TASK_TYPES)` while the doctor, thirteen
 * files away in this same lib, narrowed the same union case-INSENSITIVELY. The
 * two disagreed about identical bytes: a hand-authored `type: bugfix` was a
 * `BUGFIX` to the doctor and "no type, plus an `invalid_type` warning" to the
 * board (TASK_2026_255). Keeping two copies in sync by convention is exactly
 * what failed, so both call sites now go through here.
 *
 * Carriers are hand-authored with ordinary file tools — that is what the
 * task-spec contract tells agents to do — so the read path folds case rather
 * than demanding the author remember which of the two tuples shouts. Note the
 * tuples have OPPOSITE casing conventions (`TASK_STATUSES` is lowercase,
 * `TASK_TYPES` is uppercase), so each helper folds toward its own tuple; there
 * is no single "normalize" direction to share.
 *
 * Both accept `unknown` because YAML hands the parser whatever the author
 * typed: a bare `status: 1` is a number, `type: [a, b]` is an array. Those take
 * the same path as an unrecognised word (`undefined`), never a throw — the
 * parser must not throw past its boundary.
 */
import {
  TASK_STATUSES,
  TASK_TYPES,
  type TaskStatus,
  type TaskType,
} from '@ptah-extension/shared';

/**
 * Narrow a declared value to a `TaskType`, case-insensitively.
 *
 * `toUpperCase()` (not `toLocaleUpperCase()`) is deliberate: the fold must give
 * the same answer on every machine, and a Turkish locale maps `i` to `İ`, which
 * would make `bugfix` unrecognisable on one developer's box and fine on
 * another's.
 */
export function toTaskType(value: unknown): TaskType | undefined {
  if (typeof value !== 'string') return undefined;
  const upper = value.trim().toUpperCase();
  return (TASK_TYPES as readonly string[]).includes(upper)
    ? (upper as TaskType)
    : undefined;
}

/** Narrow a declared value to a `TaskStatus`, case-insensitively. */
export function toTaskStatus(value: unknown): TaskStatus | undefined {
  if (typeof value !== 'string') return undefined;
  const lower = value.trim().toLowerCase();
  return (TASK_STATUSES as readonly string[]).includes(lower)
    ? (lower as TaskStatus)
    : undefined;
}
