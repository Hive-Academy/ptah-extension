import { SYSTEM_CLI_TYPES } from '@ptah-extension/shared';
import {
  CRUCIBLE_ROLES,
  MAX_CRUCIBLE_ROUND_CAP,
  RELAY_ROLES,
  TRIBUNAL_MOVES,
  rosterIsLaunchable,
} from '@ptah-extension/tribunal-panel/phase';
import { z } from 'zod';

const AT_LIMIT_STATE = 'AT LIMIT';
const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:#-]{0,79}$/);
const lane = z.object({
  laneId: token,
  family: token,
  displayName: z.string().trim().min(1).max(80),
  cli: z.enum([...SYSTEM_CLI_TYPES, 'ptah-cli']),
  model: token.optional(),
  role: z.enum([...RELAY_ROLES, ...CRUCIBLE_ROLES]).optional(),
});
const schema = z.object({
  proposalId: token,
  nonce: token,
  rootSessionId: token,
  move: z.enum(TRIBUNAL_MOVES),
  options: z.array(z.string()).min(1),
  objective: z.string().trim().min(1).max(1000),
  rounds: z.number().int().min(1).max(MAX_CRUCIBLE_ROUND_CAP),
  lanes: z.array(lane).min(1).max(12),
});
export type TribunalRosterProposal = z.infer<typeof schema>;

export interface AvailableLane {
  readonly laneId: string;
  readonly state: string;
  readonly family: string;
  readonly cli: string;
}
export interface ProposalAvailability {
  readonly lanes: readonly AvailableLane[];
  readonly disabledClis: readonly string[];
}

export function rankAvailableLanes(
  availability: ProposalAvailability,
  preferredAgentOrder: readonly string[],
): readonly AvailableLane[] {
  return availability.lanes
    .filter(
      (item) =>
        item.state !== AT_LIMIT_STATE &&
        !availability.disabledClis.includes(item.cli),
    )
    .sort((left, right) => {
      const leftRank = preferredAgentOrder.indexOf(left.family);
      const rightRank = preferredAgentOrder.indexOf(right.family);
      return (
        (leftRank < 0 ? preferredAgentOrder.length : leftRank) -
        (rightRank < 0 ? preferredAgentOrder.length : rightRank)
      );
    });
}

export function proposalShapeIsValid(
  proposal: TribunalRosterProposal,
): boolean {
  return (
    new Set(proposal.lanes.map((item) => item.laneId)).size ===
      proposal.lanes.length &&
    (proposal.move === 'relay' ||
      proposal.move === 'crucible' ||
      proposal.lanes.every((item) => item.role === undefined))
  );
}
export function proposalIsLaunchable(
  proposal: TribunalRosterProposal,
): boolean {
  return (
    proposalShapeIsValid(proposal) &&
    rosterIsLaunchable(proposal.move, proposal.lanes)
  );
}
export function rosterIsAvailable(
  proposal: TribunalRosterProposal,
  availability: ProposalAvailability,
): boolean {
  return proposal.lanes.every((item) =>
    availability.lanes.some(
      (candidate) =>
        candidate.laneId === item.laneId &&
        candidate.cli === item.cli &&
        candidate.state !== AT_LIMIT_STATE &&
        !availability.disabledClis.includes(candidate.cli),
    ),
  );
}

/** Accept only a complete delimited JSON block and current root/nonce. */
export function parseRosterProposal(
  payload: unknown,
  expectedRoot: string,
  expectedNonce: string,
  availability: ProposalAvailability,
): TribunalRosterProposal | null {
  if (typeof payload !== 'string') return null;
  const match =
    /^<TRIBUNAL_ROSTER_PROPOSAL>\s*([\s\S]*?)\s*<\/TRIBUNAL_ROSTER_PROPOSAL>$/.exec(
      payload.trim(),
    );
  if (!match || match[1].length > 8192) return null;
  let data: unknown;
  try {
    data = JSON.parse(match[1]);
  } catch {
    // degradation-audit: reported — invalid proposal JSON is rejected and answered Decline by the caller
    return null;
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) return null;
  const proposal = parsed.data;
  if (
    proposal.options[0] !== 'Decline' ||
    proposal.rootSessionId !== expectedRoot ||
    proposal.nonce !== expectedNonce ||
    (proposal.move !== 'crucible' && proposal.rounds !== 1)
  )
    return null;
  return proposalIsLaunchable(proposal) &&
    rosterIsAvailable(proposal, availability)
    ? proposal
    : null;
}
