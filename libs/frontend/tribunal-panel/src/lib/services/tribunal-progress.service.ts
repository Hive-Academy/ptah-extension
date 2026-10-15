import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import {
  AgentMonitorStore,
  type MonitoredAgent,
} from '@ptah-extension/chat-streaming';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService } from '@ptah-extension/core';
import { roundJudgeFile } from '@ptah-extension/shared';
import { parseJudgeReport } from './judge-report.parser';
import { DEFAULT_CRUCIBLE_ROUND_CAP } from './tribunal-run-framing';
import { derivePhase } from './tribunal-phase-derivation';
import { TribunalStateService } from './tribunal-state.service';
import {
  type CrucibleRound,
  type TribunalMove,
  type TribunalProgress,
} from '../types/tribunal-ui.types';

/**
 * Highest round this service will look for.
 *
 * 4, matching the `tasks:getRoundJudge` Zod bound — the panel caps at 2 and the
 * conductor may run a user-authorised 3rd (`crucible.md:153`), so a 3rd and even
 * a 4th report must be READ and shown rather than clamped away. A 5th is a skill
 * violation the RPC cannot express, so there is nothing to fetch.
 */
const MAX_JUDGED_ROUND = 4;

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

  /** The derivation currently in flight, or null. At most one ever exists. */
  private cycle: Promise<void> | null = null;

  /** An input changed mid-cycle: re-derive ONCE when the cycle lands. */
  private restart = false;

  /**
   * Everything a derivation actually reads off the roster and the run, flattened
   * to one comparable string.
   *
   * This exists because `AgentMonitorStore.agents` allocates a fresh array on
   * every write, and its writers touch it on EVERY streaming delta — stdout,
   * segments, `streamRevision`. Tracking that signal directly made one
   * `tasks:get` per output chunk of every running lane, which is what a live
   * relay looked like in the RPC log. The derivation reads exactly four fields
   * per agent (`status` for phase state, `task` for the lane-role token,
   * `agentId`/`parentSessionId` for identity and scoping), so those four are
   * what the effect gets to depend on. Output deltas now change nothing here
   * and cost nothing.
   *
   * The fix belongs on this side rather than as an `equal` on the store's
   * `agents`: `MonitoredAgent` is mutated IN PLACE and the new array identity is
   * the only change signal, so any equality narrowing there would silently
   * freeze the monitor panel's live cards.
   */
  private readonly derivationInputs = computed(() =>
    // Serialized rather than concatenated: a task string can contain anything,
    // and `id + status` glued together makes two different rosters compare
    // equal often enough to lose a real transition.
    JSON.stringify({
      move: this.state.move(),
      specTaskId: this.state.specTaskId(),
      roster: this.agentMonitor
        .agents()
        .map((agent) => [
          agent.agentId,
          agent.status,
          agent.parentSessionId ?? '',
          agent.task,
        ]),
    }),
  );

  constructor() {
    // Tracks the agent roster (every artifact is written by a lane that then
    // exits), plus the two run identifiers, so a freshly prepared run populates
    // without waiting for the first agent tick — all three folded into
    // {@link derivationInputs} so only a MEANINGFUL change re-derives.
    //
    // It must NEVER read `state.progress()`: publishing writes that signal, and
    // a tracked read of it here would be an unbounded RPC loop. `specTaskId()`
    // and `move()` are safe to track because they are memoized computeds whose
    // VALUES do not change when progress is published.
    effect(() => {
      this.derivationInputs();
      untracked(() => void this.refresh());
    });
  }

  /**
   * Recompute progress and publish it onto the active run slice.
   *
   * Both the effect's trigger and the manual escape hatch — the latter being
   * the one caller that re-reads on UNCHANGED inputs, since an artifact the
   * conductor wrote itself moves no signal.
   *
   * A call arriving mid-cycle does NOT open a second round trip, and does not
   * simply join either: the running cycle issued its reads BEFORE this call, so
   * answering from it could report a disk state older than the write that
   * prompted the call. It marks the cycle for one more derivation instead. A
   * burst therefore collapses to a single follow-up rather than one read each,
   * and the returned promise resolves only after that follow-up has published.
   *
   * Never rejects: an unexpected failure resolves to the `unavailable` arm,
   * because a thrown refresh would leave the last (now stale) progress on
   * screen with nothing saying so.
   */
  refresh(): Promise<void> {
    if (this.cycle) {
      this.restart = true;
      return this.cycle;
    }
    this.cycle = this.runCycle();
    return this.cycle;
  }

  /**
   * Run derivations until the inputs stop moving underneath them. `cycle` is
   * cleared in the `finally`, which runs synchronously with the loop's exit —
   * so there is no window in which a trigger could see a settled cycle, set
   * `restart` on it, and have that request dropped.
   */
  private async runCycle(): Promise<void> {
    try {
      do {
        this.restart = false;
        await this.deriveAndPublish();
      } while (this.restart);
    } finally {
      this.cycle = null;
    }
  }

  private async deriveAndPublish(): Promise<void> {
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
    if (move === 'council' || move === 'forge' || move === 'race') {
      return derivePhase({
        move,
        specTaskId,
        laneBindings: {
          lanes: this.state.lanes(),
          bound: this.state.laneBindings(),
        },
        agents: [],
        artifacts: null,
      });
    }
    const folder = await this.readSpecFolder(specTaskId);
    if (folder.kind === 'unavailable') return folder;
    const rounds: CrucibleRound[] = [];
    if (move === 'crucible') {
      for (let round = 1; round <= MAX_JUDGED_ROUND; round += 1) {
        if (!folder.artifacts.has(roundJudgeFile(round))) continue;
        const read = await this.readJudgeReport(folder.taskId, round);
        if (read.kind === 'unavailable') return read;
        if (read.content !== null)
          rounds.push(parseJudgeReport(round, read.content));
      }
    }
    const sessionId = this.state.tribunalSessionId();
    return derivePhase({
      move,
      specTaskId,
      laneBindings: {
        lanes: this.state.lanes(),
        bound: this.state.laneBindings(),
      },
      agents: sessionId ? this.agentMonitor.agentsForSession(sessionId) : [],
      artifacts: {
        names: folder.artifacts,
        rounds,
        roundCap: this.state.roundCap() ?? DEFAULT_CRUCIBLE_ROUND_CAP,
      },
    });
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

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
