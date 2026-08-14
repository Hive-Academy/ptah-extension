import {
  CRUCIBLE_ROLES,
  RELAY_ROLES,
  type LaneRole,
  type TribunalMove,
  type VendorLane,
} from '../types/tribunal-ui.types';

export interface RosterIssue {
  /** `'block'` prevents launch outright; `'warn'` is advisory only. */
  readonly severity: 'block' | 'warn';
  readonly message: string;
}

/**
 * Validate a role roster for a move. Pure — no TestBed, no discovery, no DI.
 *
 * The flat moves (council/forge/race) have no role model, so they produce no
 * issues here; their only constraint (at least one lane) already lives in
 * `TribunalRunService.prepare()`.
 *
 * Exhaustive `switch` with no `default:` arm — a sixth move must be forced to
 * declare its own rules rather than inherit "anything goes" (AC-1.1).
 */
export function validateRoster(
  move: TribunalMove,
  lanes: readonly VendorLane[],
): readonly RosterIssue[] {
  switch (move) {
    case 'relay':
      return validateRelay(lanes);
    case 'crucible':
      return validateCrucible(lanes);
    case 'council':
    case 'forge':
    case 'race':
      return [];
  }
}

/** True when the roster carries no blocking issue, i.e. launch is permitted. */
export function rosterIsLaunchable(
  move: TribunalMove,
  lanes: readonly VendorLane[],
): boolean {
  return !validateRoster(move, lanes).some((i) => i.severity === 'block');
}

function validateRelay(lanes: readonly VendorLane[]): readonly RosterIssue[] {
  const issues: RosterIssue[] = [];

  const missing = RELAY_ROLES.filter((role) => !laneFor(lanes, role));
  if (missing.length > 0) {
    issues.push({
      severity: 'block',
      message: `Assign a lane to every phase. Still unfilled: ${missing.join(', ')}.`,
    });
  }

  const implement = laneFor(lanes, 'implement');
  const review = laneFor(lanes, 'review');
  if (implement && review) {
    if (
      implement.family === review.family &&
      normalizeModel(implement) === normalizeModel(review)
    ) {
      // relay.md:84 — same lane on the same model reviewing itself is not
      // review. This is Relay's one tribunal signal; blocking, no override.
      issues.push({
        severity: 'block',
        message:
          'The review lane cannot be the implement lane. Pick a different vendor — ideally a different family — so the review is genuinely independent.',
      });
    } else if (implement.family === review.family) {
      // relay.md:85 — permitted when asked for, but a weaker signal, so it is
      // stated rather than silently accepted.
      issues.push({
        severity: 'warn',
        message: `Implement and review are both ${implement.family} on different models. That is allowed, but a same-family review is a weaker signal than a cross-vendor one.`,
      });
    }
  }

  return issues;
}

function validateCrucible(
  lanes: readonly VendorLane[],
): readonly RosterIssue[] {
  const issues: RosterIssue[] = [];

  const missing = CRUCIBLE_ROLES.filter((role) => !laneFor(lanes, role));
  if (missing.length > 0) {
    issues.push({
      severity: 'block',
      message: `Assign a lane to every role. Still unfilled: ${missing.join(', ')}.`,
    });
  }

  const executor = laneFor(lanes, 'executor');
  const judge = laneFor(lanes, 'judge');
  if (executor && judge && executor.family === judge.family) {
    // crucible.md:37 and :53 — independence is the whole basis of the loop, and
    // on round 2 a same-family judge grades work it effectively authored. The
    // skill's escape hatch assumes a Conductor that can annotate the weakness in
    // its summary; the panel cannot, so this blocks with no override.
    issues.push({
      severity: 'block',
      message: `The judge must be a different vendor family from the executor. Both lanes are ${executor.family}; a lane grading its own output is not a signal.`,
    });
  }

  return issues;
}

function laneFor(
  lanes: readonly VendorLane[],
  role: LaneRole,
): VendorLane | undefined {
  return lanes.find((lane) => lane.role === role);
}

/** An unset model means "the provider's configured default" — one value, not none. */
function normalizeModel(lane: VendorLane): string {
  return lane.model ?? '';
}
