import { z } from 'zod';
import {
  normalizeWorkspaceRoot,
  type AgentProcessInfo,
  type CliSessionReference,
} from '@ptah-extension/shared';
import type { AgentSpawnEnvironment } from './agent-spawn-environment.service';

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

/** Identity restored beside, never instead of, the lifecycle projection. */
export function restoreLaneIdentity(
  ref: CliSessionReference,
  parentSessionId?: string,
): Pick<
  AgentProcessInfo,
  'parentSessionId' | 'potentialCapabilities' | 'ptahCliId' | 'workspaceKey'
> {
  return {
    ...(parentSessionId ? { parentSessionId } : {}),
    ...(ref.potentialCapabilities !== undefined
      ? { potentialCapabilities: ref.potentialCapabilities }
      : {}),
    ...(ref.ptahCliId ? { ptahCliId: ref.ptahCliId } : {}),
    ...(ref.workspaceKey ? { workspaceKey: ref.workspaceKey } : {}),
  };
}

/** Stamp the caller workspace, or preserve the original lane's key on resume. */
export function stampWorkspaceKey(
  info: AgentProcessInfo,
  spawnEnvironment: Pick<AgentSpawnEnvironment, 'scopedWorkspaceRoot'>,
  resumedFrom?: AgentProcessInfo,
): AgentProcessInfo {
  if (resumedFrom) {
    return resumedFrom.workspaceKey
      ? { ...info, workspaceKey: resumedFrom.workspaceKey }
      : info;
  }
  const scope = spawnEnvironment.scopedWorkspaceRoot();
  return scope === undefined
    ? info
    : { ...info, workspaceKey: normalizeWorkspaceRoot(scope) };
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
