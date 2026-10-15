/**
 * Command Center reads Tribunal's pure phase and roster rules through this entry.
 * Keep the Angular panel out of eager consumers (Decision D6).
 * This entry must stay pure: no Angular, DI, TribunalStateService, or component.
 * Do not add an eager importer to the panel through this file.
 */
export {
  buildTribunalFraming,
  buildApprovedRootFraming,
  roundCapFor,
  laneTag,
  DEFAULT_CRUCIBLE_ROUND_CAP,
  MAX_CRUCIBLE_ROUND_CAP,
} from './lib/services/tribunal-run-framing';
export type { TribunalFramingContext } from './lib/services/tribunal-run-framing';
export { derivePhase } from './lib/services/tribunal-phase-derivation';
export type {
  PhaseDerivationInput,
  PhaseAgent,
} from './lib/services/tribunal-phase-derivation';
export { rosterIsLaunchable } from './lib/services/tribunal-roster-rules';
export {
  RELAY_ROLES,
  CRUCIBLE_ROLES,
  TRIBUNAL_MOVES,
} from './lib/types/tribunal-ui.types';
export type {
  TribunalMove,
  LaneRole,
  VendorLane,
} from './lib/types/tribunal-ui.types';
