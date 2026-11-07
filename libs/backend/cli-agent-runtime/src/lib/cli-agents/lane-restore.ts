import { z } from 'zod';
import {
  normalizeWorkspaceRoot,
  type AgentProcessInfo,
  type CliOutputSegment,
  type CliSessionReference,
} from '@ptah-extension/shared';
import type { AgentSpawnEnvironment } from './agent-spawn-environment.service';
import type { AgentOutputCheckpoint } from './agent-output-journal.service';

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
  'status' | 'completedAt' | 'lastActivityAt' | 'stopReason' | 'stopResetAt'
> {
  const lastActivityAt = boundedActivityAt(ref.lastActivityAt, restoredAt);

  return {
    status: ref.status,
    ...(ref.completedAt !== undefined
      ? { completedAt: ref.completedAt }
      : {}),
    ...(lastActivityAt !== undefined ? { lastActivityAt } : {}),
    ...(ref.stopReason !== undefined ? { stopReason: ref.stopReason } : {}),
    ...(typeof ref.stopResetAt === 'number' &&
    Number.isFinite(ref.stopResetAt) &&
    ref.stopResetAt > 0
      ? { stopResetAt: ref.stopResetAt }
      : {}),
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

/** Output fields of a restored lane. Lifecycle fields stay with `restoreLaneLifecycle`. */
export interface RestoredLaneOutput {
  readonly stdout: string;
  readonly segments: readonly CliOutputSegment[];
  /** ISO time of the checkpoint the output ends at; later output was lost. */
  readonly outputLostAfter?: string;
  /** The checkpoint is newer than anything the reference persisted. */
  readonly recovered?: true;
}

/**
 * Output for a restored lane. A lane interrupted by a host restart persisted
 * no output of its own, so its latest running-output checkpoint stands in and
 * names when output stopped. The checkpoint replaces, never appends, so no
 * stream is replayed twice. Returns output fields only: the `host-restart`
 * stamp and the resume gate's idle-rule exception are untouched.
 */
export function applyOutputCheckpoint(
  ref: CliSessionReference,
  checkpoint: AgentOutputCheckpoint | undefined,
): RestoredLaneOutput {
  const persisted = persistedActivitySchema.safeParse(ref.outputLostAfter);
  const persistedLostAfter = persisted.success ? persisted.data : undefined;
  if (
    !checkpoint ||
    checkpoint.agentId !== String(ref.agentId) ||
    ref.stopReason !== 'host-restart'
  ) {
    return {
      stdout: ref.stdout ?? '',
      segments: ref.segments ?? [],
      ...(persistedLostAfter ? { outputLostAfter: persistedLostAfter } : {}),
    };
  }
  const recovered =
    persistedLostAfter === undefined ||
    Date.parse(checkpoint.at) > Date.parse(persistedLostAfter);
  return {
    stdout: checkpoint.stdoutTail,
    segments: checkpoint.segmentsTail,
    outputLostAfter: checkpoint.at,
    ...(recovered ? { recovered: true as const } : {}),
  };
}

/**
 * Restore references as the renderer receives them: each carries the
 * `outputLostAfter` its restored record holds, for the lost-output notice.
 */
export function withRestoredOutputLoss(
  refs: readonly CliSessionReference[],
  findAgentInfo: (
    agentId: string,
  ) => Pick<AgentProcessInfo, 'startedAt' | 'outputLostAfter'> | undefined,
): CliSessionReference[] {
  return refs.map((ref) => {
    const info = findAgentInfo(String(ref.agentId));
    if (!info?.outputLostAfter || info.startedAt !== ref.startedAt) return ref;
    return info.outputLostAfter === ref.outputLostAfter
      ? ref
      : { ...ref, outputLostAfter: info.outputLostAfter };
  });
}
