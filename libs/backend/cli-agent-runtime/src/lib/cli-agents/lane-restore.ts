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

/** Lifecycle fields rebuilt from a persisted lane reference. */
export function restoreLaneLifecycle(
  ref: CliSessionReference,
  restoredAt: string,
): Pick<
  AgentProcessInfo,
  'status' | 'completedAt' | 'lastActivityAt' | 'stopReason'
> {
  const lastActivityAt = boundedActivityAt(ref.lastActivityAt, restoredAt);

  if (ref.status === 'running') {
    // The process died with the previous host. An old record has no activity
    // checkpoint, so the restore instant is the only honest interruption time.
    const interruptedAt = lastActivityAt ?? restoredAt;
    return {
      status: 'stopped',
      completedAt: interruptedAt,
      lastActivityAt: interruptedAt,
      stopReason: 'host-restart',
    };
  }

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
