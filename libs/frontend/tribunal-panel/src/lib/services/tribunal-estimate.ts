import { RELAY_ROLES, type TribunalMove } from '../types/tribunal-ui.types';

/**
 * Rough paid-turn estimate for a run, shown in the wizard before launch.
 *
 * Exhaustive `switch`, no `default:` arm and no `??` escape hatch: widening
 * {@link TribunalMove} must break this function so a new move cannot silently
 * inherit some other move's cost curve (AC-1.1).
 *
 * The trailing `+ 1` is the conductor's own turn, preserving the convention the
 * flat picker already displayed. The council/forge/race arms reproduce the
 * previous per-vendor multipliers (2, 3, 3) exactly, so the displayed estimate
 * for the three existing moves is byte-identical to what it was.
 *
 * @param laneCount Panelist lanes. Only the flat moves scale with it.
 * @param roundCap  Crucible's revise-round cap. Ignored by every other move.
 */
export function estimateTurns(
  move: TribunalMove,
  laneCount: number,
  roundCap: number,
): number {
  switch (move) {
    case 'council':
      return laneCount * 2 + 1;
    case 'forge':
      return laneCount * 3 + 1;
    case 'race':
      return laneCount * 3 + 1;
    case 'relay':
      // One paid call per PHASE, not per lane — a relay lane runs once
      // (`relay.md:116`). Adding lanes past the four roles buys nothing.
      return RELAY_ROLES.length + 1;
    case 'crucible':
      // 2 paid calls per round — executor then judge (`crucible.md:74`,
      // `:117`) — across the initial round plus `roundCap` revise rounds.
      return 2 * (1 + roundCap) + 1;
  }
}
