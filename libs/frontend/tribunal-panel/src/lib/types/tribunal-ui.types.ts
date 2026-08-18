import type { CliType } from '@ptah-extension/shared';
import type { TileLayout } from '@ptah-extension/canvas';

export type TribunalMove = 'council' | 'forge' | 'race' | 'relay' | 'crucible';

/**
 * Relay's phases, in pipeline order (`references/relay.md:45-50`).
 *
 * Order is load-bearing: it is the order the phase rail renders and the order
 * the conductor relays the baton in. Do not sort it for display.
 */
export const RELAY_ROLES = [
  'plan',
  'architect',
  'implement',
  'review',
] as const;
export type RelayRole = (typeof RELAY_ROLES)[number];

/**
 * Crucible's deliberately unequal pair (`references/crucible.md:28-35`).
 * The executor writes code; the judge only reads and scores.
 */
export const CRUCIBLE_ROLES = ['executor', 'judge'] as const;
export type CrucibleRole = (typeof CRUCIBLE_ROLES)[number];

export type LaneRole = RelayRole | CrucibleRole;

export interface VendorLane {
  laneId: string;
  family: string;
  displayName: string;
  cli: CliType;
  model?: string;
  agentId?: string;
  providerId?: string;
  ptahCliId?: string;
  /**
   * Named role. Present for relay/crucible lanes; absent for the flat moves and
   * for lanes synthesized from a late-spawned agent, which have no role by
   * definition. The optionality is closed where it matters: `validateRoster`
   * blocks launch on an unfilled slot, and the framing builder asserts a role
   * before emitting a lane line for a role move.
   */
  role?: LaneRole;
}

/**
 * The roles a move's roster must fill, in slot order.
 *
 * Exhaustive `switch` with NO `default:` arm — widening {@link TribunalMove}
 * must break this on purpose so every roster-shaped site is found by the
 * compiler rather than by a user.
 */
export function rolesForMove(move: TribunalMove): readonly LaneRole[] {
  switch (move) {
    case 'relay':
      return RELAY_ROLES;
    case 'crucible':
      return CRUCIBLE_ROLES;
    case 'council':
    case 'forge':
    case 'race':
      return [];
  }
}

export function laneBaseKey(lane: {
  cli: CliType;
  providerId?: string;
}): string {
  return lane.cli === 'ptah-cli'
    ? `ptah-cli|${lane.providerId ?? ''}`
    : lane.cli;
}

export function makeLaneId(base: string, instanceIndex: number): string {
  return `${base}#${instanceIndex}`;
}

export type TribunalTileKind = 'vendor';

export interface TribunalTile {
  tileId: string;
  kind: TribunalTileKind;
  laneId?: string;
  position: TileLayout;
}

/**
 * A relay phase's own status.
 *
 * Deliberately has NO `'running'` member. "Which phase is live" is a single
 * nullable index on the container ({@link TribunalProgress} `runningIndex`), so
 * "two phases running at once" is not a state the UI can be asked to render.
 * That is AC-4.2 expressed in the type rather than defended by a guard someone
 * can later forget to write.
 */
export type RelayPhaseStatus = 'pending' | 'complete' | 'failed';

export interface RelayPhase {
  readonly role: RelayRole;
  /** Deliverable filename, composed from the shared spec contract — never a literal. */
  readonly deliverable: string;
  readonly laneId: string | null;
  readonly status: RelayPhaseStatus;
  /** Set when the live lane differs from the originally assigned one (AC-4.4). */
  readonly reassignedFromLaneId?: string;
}

/**
 * The judge's verdict for one Crucible round.
 *
 * `'unparsed'` is a first-class member, not an error case: a judge report that
 * exists but whose VERDICT section does not carry a lone verdict word renders
 * as "awaiting verdict". There is no `'pass'` default anywhere — an absent
 * report yields no {@link CrucibleRound} at all (AC-5.2).
 */
export type CrucibleVerdict = 'pass' | 'revise' | 'reject' | 'unparsed';

export interface CrucibleDefect {
  /** The judge's own numbering, e.g. `"D1"`. */
  readonly id: string;
  /**
   * `'unknown'` is a first-class member, for a judge that wrote something
   * outside the contract's `blocking|major|minor` — `[critical]`, `[high]`.
   *
   * An evidenced defect is NEVER dropped for its severity word, and an unknown
   * one is NEVER mapped onto `'major'`. Dropping it hides a real finding and
   * makes a REVISE look cleaner than the judge found it; remapping it
   * misreports the judge. Both are the same failure class as defaulting a
   * verdict to PASS. B5 renders `'unknown'` literally.
   */
  readonly severity: 'blocking' | 'major' | 'minor' | 'unknown';
  /**
   * `file:line` citation. REQUIRED — a defect without one is dropped by the
   * parser before it reaches the UI (AC-5.3, `crucible.md:145`).
   */
  readonly location: string;
  readonly what: string;
  readonly expected: string;
}

export interface CrucibleRound {
  /** 1-based, matching `roundJudgeFile(round)` from the shared spec contract. */
  readonly round: number;
  readonly verdict: CrucibleVerdict;
  readonly defects: readonly CrucibleDefect[];
  readonly mentorNote: string | null;
}

/**
 * Why a Crucible loop is where it is. `'in-progress'` is the only non-terminal
 * member; the other four are the four honest stopping conditions from
 * `crucible.md:147-160` and must stay distinguishable in the UI (AC-5.6).
 */
export type CrucibleTermination =
  | 'in-progress'
  | 'pass'
  | 'cap-reached-with-defects'
  | 'reject'
  | 'regression-stop';

/**
 * Derived run progress for the active Tribunal slice.
 *
 * `'none'` is the flat moves (council/forge/race), which have no phase or round
 * model. `'unavailable'` is the honest "we cannot tell" arm — reached when no
 * spec folder was allocated or the artifact read failed — and is NEVER
 * collapsed into `pending`, which means "we know it has not started" (AC-4.5).
 */
export type TribunalProgress =
  | { readonly kind: 'none' }
  | { readonly kind: 'unavailable'; readonly reason: string }
  | {
      readonly kind: 'relay';
      readonly phases: readonly RelayPhase[];
      /** At most ONE phase is live. `null` = nothing running. AC-4.2 by construction. */
      readonly runningIndex: number | null;
    }
  | {
      readonly kind: 'crucible';
      readonly roundCap: number;
      /**
       * The round in flight. May exceed `roundCap` when the conductor ran a
       * user-authorised extra round — render it, never clamp it (R3).
       */
      readonly currentRound: number;
      readonly rounds: readonly CrucibleRound[];
      readonly termination: CrucibleTermination;
    };

/** The progress value a slice with no run (or a flat move) carries. */
export const NO_PROGRESS: TribunalProgress = { kind: 'none' };
