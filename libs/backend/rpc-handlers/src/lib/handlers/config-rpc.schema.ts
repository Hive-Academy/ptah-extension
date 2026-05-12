/**
 * Zod schemas for {@link ConfigRpcHandlers}.
 *
 * Provides validated reads for `permissionLevel` and `effort` values that come
 * from `configManager.getWithDefault()` — these values originate from disk and
 * could be any string if the settings file was externally modified or written
 * by a future Ptah version. Without Zod validation the generic cast
 * `getWithDefault<PermissionLevel>(...)` passes unrecognized values straight
 * through to the permission handler, which trusts the type.
 *
 * `parsePermissionLevel` and `parseEffortLevel` replace the unchecked
 * `getWithDefault<PermissionLevel>` / `as EffortLevel` casts. They return a
 * documented default when the stored value is unrecognized so the handler
 * continues to work with a safe fallback rather than silently admitting garbage.
 */
import { z } from 'zod';
import type { PermissionLevel, EffortLevel } from '@ptah-extension/shared';

// ---------------------------------------------------------------------------
// Permission level
// ---------------------------------------------------------------------------

export const PermissionLevelSchema = z.enum([
  'ask',
  'auto-edit',
  'yolo',
  'plan',
] as const);

/**
 * Parse a `permissionLevel` value from config storage.
 * Returns `fallback` (default: `'ask'`) for any unrecognized value.
 */
export function parsePermissionLevel(
  raw: unknown,
  fallback: PermissionLevel = 'ask',
): PermissionLevel {
  const result = PermissionLevelSchema.safeParse(raw);
  return result.success ? result.data : fallback;
}

// ---------------------------------------------------------------------------
// Effort level
// ---------------------------------------------------------------------------

export const EffortLevelSchema = z.enum([
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const);

/**
 * Parse an `effort` value from config storage.
 * Returns `undefined` for any unrecognized / empty value.
 */
export function parseEffortLevel(raw: unknown): EffortLevel | undefined {
  if (!raw) return undefined;
  const result = EffortLevelSchema.safeParse(raw);
  return result.success ? result.data : undefined;
}
