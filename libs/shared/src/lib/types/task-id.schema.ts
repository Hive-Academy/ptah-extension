/**
 * The one task-id grammar (TASK_2026_854 RR1-8).
 *
 * A registry task folder id is `TASK_<year>_<sequence>` with an optional
 * four-character lowercase-hex suffix. The allocator pads the sequence to at
 * least three digits and never caps it (`task-specs/src/lib/id-allocator.ts`),
 * so `TASK_2026_1234` is as valid as `TASK_2026_123`. Every entry point that
 * accepts a task id (the MCP `ptah_session_start` schema, the host auto-link
 * rules) builds on these constants, so they always agree.
 */
import { z } from 'zod';

/** Unanchored source of one task id; callers add their own boundaries. */
export const TASK_ID_TOKEN_SOURCE = String.raw`TASK_\d{4}_\d{3,}(?:_[0-9a-f]{4})?`;

/** A whole string that is exactly one task id. */
export const TASK_ID_PATTERN = new RegExp(`^${TASK_ID_TOKEN_SOURCE}$`);

/** Longest task id any entry point accepts. */
export const MAX_TASK_ID_LENGTH = 64;

/** Zod schema of a task id (length-capped before the regex runs). */
export const TaskIdSchema = z
  .string()
  .max(MAX_TASK_ID_LENGTH)
  .regex(TASK_ID_PATTERN, 'must be a task id such as TASK_2026_123');
