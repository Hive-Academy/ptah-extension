import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, EffortStateService } from '@ptah-extension/core';
import { SurfaceId, TabManagerService } from '@ptah-extension/chat-state';
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
import { RUBRIC_FILE, SPEC_ROOT, roundJudgeFile } from '@ptah-extension/shared';
import { RELAY_DELIVERABLE } from './spec-documents';
import { TribunalStateService } from './tribunal-state.service';
import { rosterIsLaunchable } from './tribunal-roster-rules';
import {
  RELAY_ROLES,
  rolesForMove,
  type LaneRole,
  type RelayRole,
  type TribunalMove,
  type VendorLane,
} from '../types/tribunal-ui.types';

const MOVE_PHRASE: Record<TribunalMove, string> = {
  council: 'Convene a Tribunal Council',
  forge: 'Convene a Tribunal Forge',
  race: 'Convene a Tribunal Race',
  relay: 'Convene a Tribunal Relay',
  crucible: 'Convene a Tribunal Crucible',
};

const MOVE_FRAMING: Record<TribunalMove, string> = {
  council:
    'Council: each panelist weighs in independently, then synthesize a single cited verdict.',
  forge:
    'Forge: each panelist implements the objective in its own worktree, then cross-review the diffs.',
  race: 'Race: panelists compete on the objective; score the results against a rubric and rank them.',
  relay:
    'Relay: one task through a sequential plan → architect → implement → review pipeline, one CLI lane per phase.',
  crucible:
    'Crucible: a cheap executor lane writes the code and a stronger judge lane from a different family scores it against a frozen rubric, looping until PASS or the round cap.',
};

/**
 * The autonomy rules the flat moves (council/forge/race) carry, verbatim.
 *
 * ONE frozen array shared by all three arms of {@link MOVE_AUTONOMY}, so the
 * three cannot drift from each other by an edit to one of them. The string is
 * byte-identical to the module constant this replaced: the framing is a wire
 * contract with the tribunal skill, and a plausible paraphrase here is a silent
 * break the conductor reads and nothing type-checks.
 */
const FLAT_MOVE_AUTONOMY: readonly string[] = [
  'Do NOT call AskUserQuestion. Run fully autonomously and make reasonable assumptions; state assumptions inline rather than asking.',
];

/**
 * Autonomy is a property of the MOVE, not a user preference.
 *
 * Council/Forge/Race read nothing and gate on nothing, so full autonomy is
 * honest for them. Relay and Crucible both write code and both have mandatory
 * user checkpoints their CLI lanes cannot run themselves, so "run fully
 * autonomously" would contradict the skill it is instructing. The record is
 * exhaustive with no `default:` — a sixth move must state its own answer.
 */
const MOVE_AUTONOMY: Record<TribunalMove, readonly string[]> = {
  council: FLAT_MOVE_AUTONOMY,
  forge: FLAT_MOVE_AUTONOMY,
  race: FLAT_MOVE_AUTONOMY,
  relay: [
    'Do NOT call `AskUserQuestion` for ordinary implementation decisions — state assumptions inline. You DO own every user gate, because CLI lanes cannot ask: after `task-description.md` and again after `implementation-plan.md`, present the document path and a short summary as a plain message and wait for `APPROVED` before relaying the next phase. If a lane returns a `## Clarifications Needed` block instead of its deliverable, surface those questions to the user, then re-spawn that lane with a `## User Decisions` section.',
  ],
  crucible: [
    'Do NOT call `AskUserQuestion` for ordinary decisions. The round cap below is hard: stop at it and present the open defects honestly. A 3rd revise round runs **only if the user explicitly asks for it** — never on your own initiative, and never a 4th.',
  ],
};

/** The flat moves' conductor clause, verbatim and shared — see {@link FLAT_MOVE_AUTONOMY}. */
const FLAT_MOVE_CONDUCTOR_CLAUSE =
  'You are the Tribunal conductor running FULLY AUTONOMOUSLY.';

/**
 * The second place the old code hardcoded full autonomy. Per-move for the same
 * reason {@link MOVE_AUTONOMY} is: telling the conductor it runs fully
 * autonomously and then handing it four mandatory gates is a contradiction the
 * model resolves by ignoring one of them.
 */
const MOVE_CONDUCTOR_CLAUSE: Record<TribunalMove, string> = {
  council: FLAT_MOVE_CONDUCTOR_CLAUSE,
  forge: FLAT_MOVE_CONDUCTOR_CLAUSE,
  race: FLAT_MOVE_CONDUCTOR_CLAUSE,
  relay: 'You are the Tribunal conductor. You own every user gate.',
  crucible: 'You are the Tribunal conductor. You own every user gate.',
};

/** The skill reference file each role move defers to, by name only. */
const MOVE_REFERENCE: Partial<Record<TribunalMove, string>> = {
  relay: 'references/relay.md',
  crucible: 'references/crucible.md',
};

/** Placeholder used when no spec folder could be allocated (Q3 failure path). */
const UNALLOCATED_SPEC_FOLDER = '<spec folder>';

/**
 * `round-N-judge.md` as the conductor should read it — the per-round name with
 * the round left as the symbol `N`.
 *
 * Derived from {@link roundJudgeFile} rather than hand-written so a rename of
 * the artifact reaches this framing automatically. The panel's Crucible parser
 * reads the very files this line asks for; the two must never disagree.
 */
const ROUND_JUDGE_NAME_PATTERN = roundJudgeFile(1).replace('1', 'N');

/** Crucible's default revise-round cap, and its maximum at launch (AC-3.2). */
export const DEFAULT_CRUCIBLE_ROUND_CAP = 2;

/**
 * Everything a launch needs, in one object.
 *
 * A single parameter rather than a widening positional list: Crucible's rubric
 * and round cap travel WITH the move and lanes they belong to, so a call site
 * cannot pass a rubric for a move that has no rubric, or forget one for the
 * move that requires it.
 */
export interface TribunalLaunchSpec {
  readonly move: TribunalMove;
  readonly lanes: readonly VendorLane[];
  /** Crucible only. Forwarded to the framing VERBATIM — it is user input. */
  readonly rubric?: string;
  /** Crucible only. 1..2 at launch. */
  readonly roundCap?: number;
}

@Injectable({ providedIn: 'root' })
export class TribunalRunService {
  private readonly effortState = inject(EffortStateService);
  private readonly claims = inject(WorkflowSessionClaimService);
  private readonly tabManager = inject(TabManagerService);
  private readonly state = inject(TribunalStateService);
  private readonly rpc = inject(ClaudeRpcService);

  /**
   * Prepare a Tribunal run WITHOUT starting a session. Creates the (hidden)
   * conductor tab as a draft, builds the panelist tiles, and stamps the council
   * framing as the conductor tab's first-message preamble. The user then drives
   * the run from the conductor's normal chat input: their first message starts
   * the session via the standard send path with the framing prepended to the
   * backend prompt. No bespoke `chat:start` launch — the robust normal-chat
   * machinery owns the streaming, turn-end, and spawn lifecycle.
   *
   * Async because the role moves allocate their `.ptah/specs/TASK_[ID]` folder
   * up front (see {@link allocateSpecFolder}). That allocation is the only
   * awaited step and it can NEVER block a launch.
   */
  async prepare(spec: TribunalLaunchSpec): Promise<boolean> {
    const { move, lanes } = spec;
    if (lanes.length === 0) {
      return false;
    }
    // The wizard already blocks Next on this; re-asserting here means no other
    // caller can launch a roster the rules reject (AC-2.3, AC-2.5).
    if (!rosterIsLaunchable(move, lanes)) {
      return false;
    }

    if (this.state.correlationId()) {
      this.teardownTab(this.state.correlationId());
      this.state.reset();
    }

    const roundCap = this.roundCapFor(spec);
    const rubric = move === 'crucible' ? (spec.rubric ?? null) : null;
    const specTaskId = await this.allocateSpecFolder(move, lanes);

    const conductorTabId = this.tabManager.createTab(`Tribunal: ${move}`);
    const surfaceId = SurfaceId.create();

    this.claims.claim(conductorTabId, surfaceId);

    this.state.setMove(move);
    this.state.setLanes(lanes);
    this.state.buildTilesForRun(lanes);
    this.state.setSurfaceId(surfaceId);
    this.state.setCorrelationId(conductorTabId);
    this.state.setSpecTaskId(specTaskId);
    this.state.setRoundCap(roundCap);
    this.state.setRubric(rubric);

    this.tabManager.setFirstMessagePreamble(
      conductorTabId,
      this.buildTribunalFraming(move, lanes, {
        specTaskId,
        roundCap,
        rubric,
      }),
    );

    const effort = this.effortState.currentEffort();
    if (effort) {
      this.tabManager.setOverrideEffort(conductorTabId, effort);
    }

    return true;
  }

  async endRun(): Promise<boolean> {
    const conductorTabId = this.state.correlationId();
    if (!conductorTabId) {
      this.state.reset();
      return true;
    }
    await this.tabManager.closeTab(conductorTabId);
    const stillOpen = this.tabManager
      .tabs()
      .some((t) => t.id === conductorTabId);
    if (stillOpen) {
      return false;
    }
    this.claims.release(conductorTabId);
    this.state.reset();
    return true;
  }

  private rollback(conductorTabId: string): void {
    this.claims.release(conductorTabId);
    this.teardownTab(conductorTabId);
    this.state.reset();
  }

  private teardownTab(conductorTabId: string | null): void {
    if (!conductorTabId) return;
    this.tabManager.forceCloseTab(conductorTabId);
  }

  private roundCapFor(spec: TribunalLaunchSpec): number | null {
    if (spec.move !== 'crucible') return null;
    const requested = spec.roundCap ?? DEFAULT_CRUCIBLE_ROUND_CAP;
    return Math.min(Math.max(1, Math.trunc(requested)), 2);
  }

  /**
   * Allocate the run's spec folder via `tasks:create`, for the role moves only.
   *
   * The backend allocator already implements the folder-scan id rule and the
   * exclusive-create race; discovering the folder after the fact would be a
   * guess, because agents create task folders constantly.
   *
   * **Failure is non-blocking and silent to the launch path.** A null return
   * means the framing omits its `Spec folder:` line (the conductor then
   * allocates per the skill) and the run view shows progress as unavailable.
   * Progress is an enhancement; it never gates convening a panel.
   */
  private async allocateSpecFolder(
    move: TribunalMove,
    lanes: readonly VendorLane[],
  ): Promise<string | null> {
    if (rolesForMove(move).length === 0) {
      return null;
    }
    const workspaceRoot = this.tabManager.activeWorkspacePath;
    try {
      const result = await this.rpc.call('tasks:create', {
        title: `Tribunal ${this.moveLabel(move)} — ${new Date()
          .toISOString()
          .slice(0, 10)}`,
        type: 'FEATURE',
        status: 'in_progress',
        description: this.rosterDescription(move, lanes),
        ...(workspaceRoot ? { workspaceRoot } : {}),
      });
      if (result.isSuccess() && result.data?.success && result.data.task) {
        return result.data.task.id;
      }
      console.warn(
        '[TribunalRunService] spec folder allocation failed:',
        result.data?.error?.message ?? result.error ?? 'unknown error',
      );
      return null;
    } catch (error: unknown) {
      console.warn(
        '[TribunalRunService] spec folder allocation threw:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private moveLabel(move: TribunalMove): string {
    return `${move.charAt(0).toUpperCase()}${move.slice(1)}`;
  }

  private rosterDescription(
    move: TribunalMove,
    lanes: readonly VendorLane[],
  ): string {
    const roster = lanes
      .map((lane) =>
        lane.role
          ? `${lane.role}: ${lane.displayName}${lane.model ? ` (${lane.model})` : ''}`
          : lane.displayName,
      )
      .join('; ');
    return `Tribunal ${this.moveLabel(move)} convened from the Tribunal panel. Lanes — ${roster}.`;
  }

  /**
   * Council framing prepended (hidden) to the conductor's first message. The
   * user's objective is appended after this block by the normal send path, so
   * the panelist spawn lines reference "the objective below" rather than
   * embedding it.
   *
   * The `[tribunal:<laneId>]` tag grammar is UNCHANGED across every move. A
   * role move adds a parenthesised `(role)` token to the human-readable
   * remainder of the line, which is why lane-tag matching needs no migration.
   */
  private buildTribunalFraming(
    move: TribunalMove,
    lanes: readonly VendorLane[],
    context: {
      specTaskId: string | null;
      roundCap: number | null;
      rubric: string | null;
    },
  ): string {
    const isRoleMove = rolesForMove(move).length > 0;
    const specFolder = context.specTaskId
      ? `${SPEC_ROOT}/${context.specTaskId}`
      : UNALLOCATED_SPEC_FOLDER;

    const laneLines = lanes
      .map((lane) => this.laneLine(move, lane, specFolder))
      .join('\n');

    const reference = MOVE_REFERENCE[move];

    return [
      `${MOVE_PHRASE[move]}. ${MOVE_CONDUCTOR_CLAUSE[move]}`,
      '',
      MOVE_FRAMING[move],
      ...(reference
        ? [
            '',
            `Read the tribunal skill's ${reference} before spawning anything; it is the authority for this move.`,
          ]
        : []),
      ...(context.specTaskId
        ? [
            '',
            `Spec folder: ${context.specTaskId} (already created by the Tribunal UI). Use it. Do NOT scan for or allocate a new task id.`,
          ]
        : []),
      '',
      'This panel is EXPLICITLY defined by the user. Spawn EXACTLY these panelists with EXACTLY these spawn args via ptah_agent_spawn, passing each the objective stated at the end of this message. Do NOT run your own vendor discovery or family-spread selection, do NOT collapse duplicate vendors, and do NOT substitute models. The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task, verbatim.',
      ...(isRoleMove
        ? [
            "Each lane's ROLE is stated below and is authoritative — do not infer it from lane order.",
          ]
        : []),
      '',
      laneLines,
      ...this.crucibleBlock(move, context, specFolder),
      '',
      'Rules:',
      ...MOVE_AUTONOMY[move].map((rule) => `- ${rule}`),
      '- The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task. Do not omit it and do not alter the laneId inside it.',
      '',
      'Objective:',
    ].join('\n');
  }

  /**
   * Crucible's extra block: the round cap, the verbatim rubric, and the one
   * protocol fact the panel's own parser is coupled to. Everything else about
   * the move stays in the skill — two copies of a protocol drift, and drift
   * here means the panel and the skill disagree about the judge contract the
   * parser gates on.
   */
  private crucibleBlock(
    move: TribunalMove,
    context: { roundCap: number | null; rubric: string | null },
    specFolder: string,
  ): readonly string[] {
    if (move !== 'crucible') return [];
    const cap = context.roundCap ?? DEFAULT_CRUCIBLE_ROUND_CAP;
    const lines = [
      '',
      `Round cap: ${cap} revise rounds. Stop at the cap and report open defects honestly.`,
    ];
    if (context.rubric) {
      lines.push(
        `Rubric — write this VERBATIM to ${specFolder}/${RUBRIC_FILE} before the first spawn, then freeze it after round 1:`,
        context.rubric,
      );
    }
    lines.push(
      '',
      `Each judge round writes ${specFolder}/${ROUND_JUDGE_NAME_PATTERN} under the ## VERDICT / ## SCORES / ## DEFECTS / ## MENTOR NOTE headings, with every defect carrying a file:line citation. The Tribunal panel reads those files to show progress.`,
    );
    return lines;
  }

  private laneLine(
    move: TribunalMove,
    lane: VendorLane,
    specFolder: string,
  ): string {
    const spawn = `ptah_agent_spawn({ ${this.spawnArgsFor(lane)} })`;
    const role = lane.role;
    if (!role) {
      return `  [tribunal:${lane.laneId}] ${lane.displayName} — ${spawn} with the objective below as the task.`;
    }
    const head = `  [tribunal:${lane.laneId}] (${role}) ${lane.displayName} — ${spawn}`;
    if (move === 'relay' && this.isRelayRole(role)) {
      return `${head}. Phase: ${role}. Deliverable: ${specFolder}/${RELAY_DELIVERABLE[role]}`;
    }
    return `${head} with the objective below as the task.`;
  }

  private isRelayRole(role: LaneRole): role is RelayRole {
    return (RELAY_ROLES as readonly string[]).includes(role);
  }

  private spawnArgsFor(lane: VendorLane): string {
    const modelArg = lane.model ? `, model: "${lane.model}"` : '';
    switch (lane.cli) {
      case 'codex':
        return `cli: "codex"${modelArg}`;
      case 'copilot':
        return `cli: "copilot"${modelArg}`;
      case 'cursor':
        return 'cli: "cursor"';
      case 'antigravity':
        // agy takes a model label (e.g. "Gemini 3.5 Flash (High)"); no effort
        // arg — reasoning effort is baked into the label. The adapter adds the
        // --print / --dangerously-skip-permissions flags on spawn.
        return `cli: "antigravity"${modelArg}`;
      case 'opencode':
        return `cli: "opencode"${modelArg}`;
      case 'pi':
        return `cli: "pi"${modelArg}`;
      case 'ptah-cli':
        return `ptahCliId: "${lane.ptahCliId ?? ''}"${modelArg}`;
    }
  }
}
