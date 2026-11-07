import { z } from 'zod';
import type {
  AgentProcessInfo,
  CliSessionReference,
} from '@ptah-extension/shared';

const persistedActivitySchema = z.iso.datetime({ offset: true });
const RESTORE_CLOCK_SKEW_MS = 60_000;

/** Clamp a future checkpoint to the restore instant after a small skew allowance. */
function boundedActivityAt(
  value: string | undefined,
  restoredAt: string,
): string | undefined {
  const parsed = persistedActivitySchema.safeParse(value);
  if (!parsed.success) return undefined;
  return Date.parse(parsed.data) > Date.parse(restoredAt) + RESTORE_CLOCK_SKEW_MS
    ? restoredAt
    : parsed.data;
}

/**
 * Lifecycle fields rebuilt from a persisted lane reference. `restoreAgents`
 * excludes live `running` references before calling this helper. The store has
 * already normalized an interrupted lane to `stopped` / `host-restart`.
 */
export function restoreLaneLifecycle(
  ref: CliSessionReference,
  restoredAt: string,
): Pick<
  AgentProcessInfo,
  'status' | 'completedAt' | 'lastActivityAt' | 'stopReason'
> {
  const lastActivityAt = boundedActivityAt(ref.lastActivityAt, restoredAt);

  return {
    status: ref.status,
    ...(ref.completedAt !== undefined
      ? { completedAt: ref.completedAt }
      : {}),
    ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
    ...(ref.stopReason !== undefined ? { stopReason: ref.stopReason } : {}),
  };
}

/** The resume clock starts at activity, then completion, then spawn. */
export function laneLastActivityAt(
  info: Pick<
    AgentProcessInfo,
    'lastActivityAt' | 'completedAt' | 'startedAt'
  >,
): number {
  return Date.parse(
    info.lastActivityAt ?? info.completedAt ?? info.startedAt,
  );
}
