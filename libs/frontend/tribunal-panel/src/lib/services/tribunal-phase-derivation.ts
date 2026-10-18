import type { MonitoredAgent } from '@ptah-extension/chat-streaming';
import { BATCHES_FILE, LEGACY_BATCHES_FILE } from '@ptah-extension/shared';
import { RELAY_DELIVERABLE } from './spec-documents';
import { DEFAULT_CRUCIBLE_ROUND_CAP } from './tribunal-run-framing';
import {
  NO_PROGRESS,
  RELAY_ROLES,
  type CrucibleDefect,
  type CrucibleRound,
  type CrucibleTermination,
  type RelayPhase,
  type RelayPhaseStatus,
  type RelayRole,
  type TribunalMove,
  type TribunalProgress,
  type VendorLane,
} from '../types/tribunal-ui.types';

interface PhaseLane {
  readonly laneId: string | null;
  readonly agent: PhaseAgent | null;
  readonly reassignedFromLaneId?: string;
}

export type PhaseAgent = Pick<MonitoredAgent, 'task' | 'status'>;

export interface PhaseDerivationInput {
  readonly move: TribunalMove;
  readonly specTaskId: string | null;
  readonly laneBindings: {
    readonly lanes: readonly VendorLane[];
    readonly bound: ReadonlyMap<string, PhaseAgent | null>;
  };
  readonly agents: readonly PhaseAgent[];
  readonly artifacts: {
    readonly names: ReadonlySet<string>;
    readonly rounds?: readonly CrucibleRound[];
    readonly roundCap?: number;
  } | null;
}

const RELAY_COMPLETION_NAMES: Record<RelayRole, readonly string[]> = {
  plan: [RELAY_DELIVERABLE.plan],
  architect: [RELAY_DELIVERABLE.architect],
  implement: [BATCHES_FILE, LEGACY_BATCHES_FILE],
  review: [RELAY_DELIVERABLE.review],
};

const LANE_ROLE_TOKEN_RE = /\[tribunal:([^\]]+)\]\s*\(([a-z-]+)\)/;

/** Agent statuses that mean the lane RAN and is not going to deliver. */
const ENDED_STATUSES: ReadonlySet<string> = new Set([
  'completed',
  'failed',
  'timeout',
  'stopped',
]);

/** Severity buckets compared worst-first when asking "did the mix improve?". */
const SEVERITY_ORDER: readonly CrucibleDefect['severity'][] = [
  'blocking',
  'major',
  'minor',
  // Compared LAST and never folded into 'major': an unrecognised severity word
  // is its own bucket, exactly as the parser keeps it.
  'unknown',
];

const NO_SPEC_FOLDER_REASON =
  'No spec folder was allocated for this run, so phase progress cannot be read.';

export function derivePhase(input: PhaseDerivationInput): TribunalProgress {
  switch (input.move) {
    case 'council':
    case 'forge':
    case 'race':
      return NO_PROGRESS;
    case 'relay':
    case 'crucible':
      break;
  }
  if (!input.specTaskId)
    return { kind: 'unavailable', reason: NO_SPEC_FOLDER_REASON };
  if (!input.artifacts)
    return {
      kind: 'unavailable',
      reason: `Phase unavailable: artifacts for ${input.specTaskId} could not be read.`,
    };
  if (input.move === 'relay') return deriveRelay(input, input.artifacts.names);
  const rounds = input.artifacts.rounds ?? [];
  const roundCap = input.artifacts.roundCap ?? DEFAULT_CRUCIBLE_ROUND_CAP;
  const inFlight = Array.from(input.laneBindings.bound.values()).some(
    (agent) => agent?.status === 'running',
  );
  const last = rounds.length > 0 ? rounds[rounds.length - 1] : null;
  const previous = rounds.length > 1 ? rounds[rounds.length - 2] : null;
  const stopped = termination(last, previous, roundCap, inFlight);

  return {
    kind: 'crucible',
    roundCap,
    // A stopped loop is ON its last judged round — only an open loop can have
    // advanced to the next one.
    currentRound:
      stopped === 'in-progress'
        ? currentRound(last, roundCap, inFlight)
        : (last?.round ?? 1),
    rounds,
    termination: stopped,
  };
}

function deriveRelay(
  input: PhaseDerivationInput,
  artifacts: ReadonlySet<string>,
): TribunalProgress {
  const lanes = input.laneBindings.lanes;
  const bindings = input.laneBindings.bound;
  const reassignments = laneByRoleToken(input.agents);

  const phases: RelayPhase[] = [];
  let runningIndex: number | null = null;

  RELAY_ROLES.forEach((role, index) => {
    const assignedLaneId = assignedLane(lanes, role);
    const live = resolvePhaseLane(
      role,
      assignedLaneId,
      bindings,
      reassignments,
    );
    const complete = RELAY_COMPLETION_NAMES[role].some((name) =>
      artifacts.has(name),
    );

    if (
      runningIndex === null &&
      !complete &&
      live.agent?.status === 'running'
    ) {
      runningIndex = index;
    }

    phases.push({
      role,
      deliverable: RELAY_DELIVERABLE[role],
      laneId: live.laneId,
      status: phaseStatus(complete, live.agent),
      ...(live.reassignedFromLaneId
        ? { reassignedFromLaneId: live.reassignedFromLaneId }
        : {}),
    });
  });

  return { kind: 'relay', phases, runningIndex };
}

/**
 * The lane a phase is ACTUALLY running on, plus the lane it was assigned to
 * when they differ (AC-4.4).
 *
 * Reassignment is only ever reported on positive evidence — an agent whose
 * task carries this role's token under a DIFFERENT lane tag. Absent that, the
 * assigned lane stands, so a phase that simply has not started yet is never
 * mislabelled as reassigned.
 */
function resolvePhaseLane(
  role: RelayRole,
  assignedLaneId: string | null,
  bindings: ReadonlyMap<string, PhaseAgent | null>,
  reassignments: ReadonlyMap<string, { laneId: string; agent: PhaseAgent }>,
): PhaseLane {
  const tokenMatch = reassignments.get(role);
  if (tokenMatch && (!assignedLaneId || tokenMatch.laneId !== assignedLaneId)) {
    return {
      laneId: tokenMatch.laneId,
      agent: tokenMatch.agent,
      ...(assignedLaneId ? { reassignedFromLaneId: assignedLaneId } : {}),
    };
  }

  const bound = assignedLaneId ? (bindings.get(assignedLaneId) ?? null) : null;
  return {
    laneId: assignedLaneId ?? tokenMatch?.laneId ?? null,
    agent: bound ?? tokenMatch?.agent ?? null,
  };
}

/**
 * Role token → the lane tag and agent currently carrying it.
 *
 * The LAST match wins: a re-spawn after a failure is the live attempt, and
 * showing the dead one would report a phase as failed while it is running.
 */
function laneByRoleToken(
  agents: readonly PhaseAgent[],
): ReadonlyMap<string, { laneId: string; agent: PhaseAgent }> {
  const found = new Map<string, { laneId: string; agent: PhaseAgent }>();
  for (const agent of agents) {
    const match = LANE_ROLE_TOKEN_RE.exec(agent.task);
    if (!match) continue;
    found.set(match[2], { laneId: match[1].trim(), agent });
  }
  return found;
}

function assignedLane(
  lanes: readonly VendorLane[],
  role: RelayRole,
): string | null {
  return lanes.find((lane) => lane.role === role)?.laneId ?? null;
}

/**
 * A phase's own status — three members, and `'running'` is deliberately not one
 * of them (it lives on the container as `runningIndex`).
 *
 * A lane that ENDED without its deliverable is `'failed'`, including a clean
 * `completed` exit: the whole design leans on lanes writing their file and then
 * exiting, so "exited, no artifact" is a lane that did not deliver — not a
 * phase that has yet to start.
 */
function phaseStatus(
  complete: boolean,
  agent: PhaseAgent | null,
): RelayPhaseStatus {
  if (complete) return 'complete';
  if (agent && ENDED_STATUSES.has(agent.status)) return 'failed';
  return 'pending';
}

/**
 * The round the loop is on.
 *
 * A judged REVISE with rounds remaining means the NEXT round is the current one
 * — that is what the conductor does with the defect list. A judged REVISE at or
 * past the cap only advances on evidence that the loop actually continued (a
 * lane still running), because that is the user-authorised 3rd round.
 *
 * R3 — the result is NEVER clamped to the cap. The panel caps at 2 but the
 * conductor may run a 3rd on the user's explicit say-so (`crucible.md:153`);
 * clamping would report a run that is genuinely in progress as one that
 * stopped, the same class of lie as defaulting a verdict to PASS.
 */
function currentRound(
  last: CrucibleRound | null,
  roundCap: number,
  inFlight: boolean,
): number {
  if (!last || last.verdict !== 'revise') return last?.round ?? 1;
  return last.round < roundCap || inFlight ? last.round + 1 : last.round;
}

function termination(
  last: CrucibleRound | null,
  previous: CrucibleRound | null,
  roundCap: number,
  inFlight: boolean,
): CrucibleTermination {
  if (!last) return 'in-progress';

  switch (last.verdict) {
    case 'pass':
      return 'pass';
    case 'reject':
      return 'reject';
    case 'unparsed':
      // A report we cannot read is not a stopping condition — the UI says
      // "awaiting verdict" and the loop is still open.
      return 'in-progress';
    case 'revise':
      break;
  }

  // A lane running past the last judged round means the loop CONTINUED,
  // whatever the cap says. Reporting it as stopped would be the R3 lie.
  if (inFlight) return 'in-progress';
  if (regressed(previous, last)) return 'regression-stop';
  if (last.round >= roundCap) return 'cap-reached-with-defects';
  return 'in-progress';
}

/**
 * `crucible.md:157` verbatim: "the defect count did not go down AND the
 * severity mix did not improve, versus the previous round".
 *
 * Only two consecutive REVISE rounds are comparable — a round with no readable
 * verdict carries no defect list worth differencing.
 */
function regressed(
  previous: CrucibleRound | null,
  last: CrucibleRound,
): boolean {
  if (!previous || previous.verdict !== 'revise' || last.verdict !== 'revise') {
    return false;
  }
  if (last.defects.length < previous.defects.length) return false;
  return !severityMixImproved(previous.defects, last.defects);
}

/**
 * Worst-bucket-first comparison. Fewer `blocking` is an improvement however
 * many `minor` appeared, and `'unknown'` is compared as its OWN bucket — never
 * folded into `'major'`, which would misreport what the judge wrote.
 */
function severityMixImproved(
  previous: readonly CrucibleDefect[],
  last: readonly CrucibleDefect[],
): boolean {
  for (const severity of SEVERITY_ORDER) {
    const before = tally(previous, severity);
    const now = tally(last, severity);
    if (now < before) return true;
    if (now > before) return false;
  }
  return false;
}

function tally(
  defects: readonly CrucibleDefect[],
  severity: CrucibleDefect['severity'],
): number {
  return defects.filter((defect) => defect.severity === severity).length;
}
