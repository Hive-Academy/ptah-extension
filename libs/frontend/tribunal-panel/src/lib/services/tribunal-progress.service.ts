import { Injectable, effect, inject, untracked } from '@angular/core';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  BATCHES_FILE,
  LEGACY_BATCHES_FILE,
  roundJudgeFile,
} from '@ptah-extension/shared';
import { parseJudgeReport } from './judge-report.parser';
import { RELAY_DELIVERABLE } from './spec-documents';
import { DEFAULT_CRUCIBLE_ROUND_CAP } from './tribunal-run.service';
import { TribunalStateService } from './tribunal-state.service';
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

/**
 * The filenames whose presence PROVES a phase completed.
 *
 * R5 — the rename trap. Relay's own reference still calls the implement
 * deliverable `tasks.md` (`relay.md:49`) while this repo renamed that document
 * to `batches.md`. A conductor following the root `CLAUDE.md` writes the new
 * name; one following the skill writes the old one. A completion check that
 * knows only one of them reports a FINISHED phase as pending — so the implement
 * phase accepts either, and both names come from the shared contract rather
 * than from a literal typed here.
 */
const RELAY_COMPLETION_NAMES: Record<RelayRole, readonly string[]> = {
  plan: [RELAY_DELIVERABLE.plan],
  architect: [RELAY_DELIVERABLE.architect],
  implement: [BATCHES_FILE, LEGACY_BATCHES_FILE],
  review: [RELAY_DELIVERABLE.review],
};

/**
 * Highest round this service will look for.
 *
 * 4, matching the `tasks:getRoundJudge` Zod bound — the panel caps at 2 and the
 * conductor may run a user-authorised 3rd (`crucible.md:153`), so a 3rd and even
 * a 4th report must be READ and shown rather than clamped away. A 5th is a skill
 * violation the RPC cannot express, so there is nothing to fetch.
 */
const MAX_JUDGED_ROUND = 4;

/**
 * `[tribunal:<laneId>] (<role>)` — the framing's own lane-line form, which the
 * conductor reproduces at the head of each sub-agent task.
 *
 * Used ONLY to detect a phase reassignment (`relay.md:136`: "a lane that fails
 * twice is dropped ... reassign its phase to another lane"). Anchoring on the
 * tag AND the role token in the same match is what keeps it from firing on the
 * word "(plan)" appearing in ordinary prose.
 */
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

/** The outcome of reading the run's spec folder. No third, optimistic arm. */
type SpecFolderRead =
  | { readonly kind: 'unavailable'; readonly reason: string }
  | {
      readonly kind: 'folder';
      readonly taskId: string;
      readonly artifacts: ReadonlySet<string>;
    };

/** The outcome of reading one judge report. `content: null` = not judged yet. */
type JudgeRead =
  | { readonly kind: 'unavailable'; readonly reason: string }
  | { readonly kind: 'report'; readonly content: string | null };

/** The live lane for a phase, and the lane it was reassigned away from. */
interface PhaseLane {
  readonly laneId: string | null;
  readonly agent: MonitoredAgent | null;
  readonly reassignedFromLaneId?: string;
}

/**
 * Derives the active Tribunal run's phase/round progress and publishes it onto
 * {@link TribunalStateService}.
 *
 * ## Where the facts come from
 *
 * A pure join over data the panel ALREADY owns plus the `.ptah/specs` folder it
 * allocated at launch: role → lane (the wizard's own assignment) → lane binding
 * → `MonitoredAgent.status`, joined with `tasks:get`'s artifact list and, for
 * Crucible, `tasks:getRoundJudge`. Nothing is regexed out of the conductor's
 * chat transcript (AC-4.3), and there is no second source that could disagree
 * with the first.
 *
 * ## Why an effect and not a `tasks:changed` subscription
 *
 * Subscribing to `tasks:changed` means registering in `MESSAGE_HANDLERS`, which
 * is EAGER at webview bootstrap and would drag `TribunalPageComponent` and
 * gridstack into the initial bundle — the TASK_2026_187 regression. Every
 * artifact read here is written by a spawned lane, and a lane writes its file
 * and then exits, so agent-status transitions strictly follow the writes that
 * matter. {@link refresh} is public as the manual escape hatch for the one case
 * that ordering does not cover: an artifact the CONDUCTOR wrote itself, with no
 * agent tick behind it.
 *
 * ## The honesty rules this file exists to keep
 *
 * - `pending` means "we know it has not started". "We cannot tell" is
 *   `{ kind: 'unavailable', reason }` and is always LABELLED (AC-4.5, R1).
 * - No `default:` arm and no `??` anywhere can produce a `pass` or a
 *   `complete`. An absent judge report yields no round at all.
 * - The round is NEVER clamped to the cap. A user-authorised 3rd round renders
 *   as "Round 3 of 2" because that is what is happening (R3).
 */
@Injectable({ providedIn: 'root' })
export class TribunalProgressService {
  private readonly state = inject(TribunalStateService);
  private readonly agentMonitor = inject(AgentMonitorStore);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly tabManager = inject(TabManagerService);

  /** Monotonic request id — only the NEWEST derivation may publish. */
  private requestSeq = 0;

  constructor() {
    // Tracks the agent roster (every artifact is written by a lane that then
    // exits), plus the two run identifiers, so a freshly prepared run populates
    // without waiting for the first agent tick.
    //
    // It must NEVER read `state.progress()`: publishing writes that signal, and
    // a tracked read of it here would be an unbounded RPC loop. `specTaskId()`
    // and `move()` are safe to track because they are memoized computeds whose
    // VALUES do not change when progress is published.
    effect(() => {
      this.agentMonitor.agents();
      this.state.specTaskId();
      this.state.move();
      untracked(() => void this.refresh());
    });
  }

  /**
   * Recompute progress and publish it onto the active run slice.
   *
   * Never rejects: an unexpected failure resolves to the `unavailable` arm,
   * because a thrown refresh would leave the last (now stale) progress on
   * screen with nothing saying so.
   */
  async refresh(): Promise<void> {
    const seq = ++this.requestSeq;
    const runKey = this.runKey();
    let progress: TribunalProgress;
    try {
      progress = await this.derive(this.state.move(), this.state.specTaskId());
    } catch (error: unknown) {
      progress = {
        kind: 'unavailable',
        reason: `Progress could not be derived: ${describe(error)}`,
      };
    }

    // A response that lost the race, or that belongs to a run the user has
    // since replaced or switched away from, must not overwrite the live one.
    if (seq !== this.requestSeq || this.runKey() !== runKey) return;
    this.state.setProgress(progress);
  }

  /** Identity of the run a derivation was started for. */
  private runKey(): string {
    return `${this.state.correlationId() ?? ''}|${this.state.specTaskId() ?? ''}`;
  }

  /**
   * Exhaustive over {@link TribunalMove} with NO `default:` — a sixth move must
   * state its own answer here rather than inheriting a plausible one.
   */
  private async derive(
    move: TribunalMove,
    specTaskId: string | null,
  ): Promise<TribunalProgress> {
    switch (move) {
      case 'council':
      case 'forge':
      case 'race':
        return NO_PROGRESS;
      case 'relay': {
        const folder = await this.readSpecFolder(specTaskId);
        return folder.kind === 'unavailable'
          ? folder
          : this.deriveRelay(folder.artifacts);
      }
      case 'crucible': {
        const folder = await this.readSpecFolder(specTaskId);
        return folder.kind === 'unavailable'
          ? folder
          : await this.deriveCrucible(folder.taskId, folder.artifacts);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Relay
  // -------------------------------------------------------------------------

  /**
   * Join the four phases against the artifact list and the lane bindings.
   *
   * AC-4.2 is enforced by the SHAPE: `runningIndex` is one nullable index on
   * the container, so however many lanes report `running`, at most one phase
   * can be shown as live — and it is the earliest one in pipeline order, which
   * is the one the sequential relay is actually on.
   */
  private deriveRelay(artifacts: ReadonlySet<string>): TribunalProgress {
    const lanes = this.state.lanes();
    const bindings = this.state.laneBindings();
    const reassignments = this.laneByRoleToken();

    const phases: RelayPhase[] = [];
    let runningIndex: number | null = null;

    RELAY_ROLES.forEach((role, index) => {
      const assignedLaneId = assignedLane(lanes, role);
      const live = this.resolvePhaseLane(
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
  private resolvePhaseLane(
    role: RelayRole,
    assignedLaneId: string | null,
    bindings: ReadonlyMap<string, MonitoredAgent | null>,
    reassignments: ReadonlyMap<
      string,
      { laneId: string; agent: MonitoredAgent }
    >,
  ): PhaseLane {
    const tokenMatch = reassignments.get(role);
    if (tokenMatch && assignedLaneId && tokenMatch.laneId !== assignedLaneId) {
      return {
        laneId: tokenMatch.laneId,
        agent: tokenMatch.agent,
        reassignedFromLaneId: assignedLaneId,
      };
    }

    const bound = assignedLaneId
      ? (bindings.get(assignedLaneId) ?? null)
      : null;
    return {
      laneId: assignedLaneId,
      agent: bound ?? tokenMatch?.agent ?? null,
    };
  }

  /**
   * Role token → the lane tag and agent currently carrying it.
   *
   * The LAST match wins: a re-spawn after a failure is the live attempt, and
   * showing the dead one would report a phase as failed while it is running.
   */
  private laneByRoleToken(): ReadonlyMap<
    string,
    { laneId: string; agent: MonitoredAgent }
  > {
    const sessionId = this.state.tribunalSessionId();
    const found = new Map<string, { laneId: string; agent: MonitoredAgent }>();
    if (!sessionId) return found;

    for (const agent of this.agentMonitor.agentsForSession(sessionId)) {
      const match = LANE_ROLE_TOKEN_RE.exec(agent.task);
      if (!match) continue;
      found.set(match[2], { laneId: match[1].trim(), agent });
    }
    return found;
  }

  // -------------------------------------------------------------------------
  // Crucible
  // -------------------------------------------------------------------------

  /**
   * Read every judge report the folder holds and derive the loop's state.
   *
   * The round counter is free (AC-5.1): the artifact list already names
   * `round-N-judge.md`, so only the report's CONTENT needs a call.
   */
  private async deriveCrucible(
    taskId: string,
    artifacts: ReadonlySet<string>,
  ): Promise<TribunalProgress> {
    const roundCap = this.state.roundCap() ?? DEFAULT_CRUCIBLE_ROUND_CAP;
    const rounds: CrucibleRound[] = [];

    for (let round = 1; round <= MAX_JUDGED_ROUND; round += 1) {
      if (!artifacts.has(roundJudgeFile(round))) continue;
      const read = await this.readJudgeReport(taskId, round);
      if (read.kind === 'unavailable') return read;
      // Listed but empty on read: the folder listing and the read raced. Not a
      // round, and emphatically not a verdict.
      if (read.content === null) continue;
      rounds.push(parseJudgeReport(round, read.content));
    }

    const inFlight = this.hasRunningLane();
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

  /** Is any lane of this run executing right now? */
  private hasRunningLane(): boolean {
    for (const agent of this.state.laneBindings().values()) {
      if (agent?.status === 'running') return true;
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // RPC
  // -------------------------------------------------------------------------

  private async readSpecFolder(
    specTaskId: string | null,
  ): Promise<SpecFolderRead> {
    if (!specTaskId) {
      return { kind: 'unavailable', reason: NO_SPEC_FOLDER_REASON };
    }

    try {
      const result = await this.rpc.call('tasks:get', {
        taskId: specTaskId,
        ...this.workspaceScope(),
      });
      if (!result.isSuccess()) {
        return {
          kind: 'unavailable',
          reason: `Could not read the run's spec folder ${specTaskId}: ${
            result.error ?? 'unknown error'
          }.`,
        };
      }
      const task = result.data.task;
      if (!task) {
        return {
          kind: 'unavailable',
          reason: `The run's spec folder ${specTaskId} is no longer on disk.`,
        };
      }
      return {
        kind: 'folder',
        taskId: specTaskId,
        artifacts: new Set(task.artifacts),
      };
    } catch (error: unknown) {
      return {
        kind: 'unavailable',
        reason: `Could not read the run's spec folder ${specTaskId}: ${describe(
          error,
        )}.`,
      };
    }
  }

  /**
   * One judge report. The ROUND is sent as an integer and echoed back; a
   * mismatch is refused rather than rendered, because a late response shown
   * under the wrong round would attribute one round's defects to another.
   */
  private async readJudgeReport(
    taskId: string,
    round: number,
  ): Promise<JudgeRead> {
    try {
      const result = await this.rpc.call('tasks:getRoundJudge', {
        taskId,
        round,
        ...this.workspaceScope(),
      });
      if (!result.isSuccess()) {
        return {
          kind: 'unavailable',
          reason: `Round ${round}'s judge report could not be read: ${
            result.error ?? 'unknown error'
          }.`,
        };
      }
      if (result.data.round !== round) {
        return {
          kind: 'unavailable',
          reason: `Round ${round}'s judge report came back tagged round ${result.data.round}.`,
        };
      }
      return { kind: 'report', content: result.data.content };
    } catch (error: unknown) {
      return {
        kind: 'unavailable',
        reason: `Round ${round}'s judge report could not be read: ${describe(
          error,
        )}.`,
      };
    }
  }

  private workspaceScope(): { workspaceRoot?: string } {
    const workspaceRoot = this.tabManager.activeWorkspacePath;
    return workspaceRoot ? { workspaceRoot } : {};
  }
}

// ---------------------------------------------------------------------------
// Pure derivation helpers
// ---------------------------------------------------------------------------

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
  agent: MonitoredAgent | null,
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
