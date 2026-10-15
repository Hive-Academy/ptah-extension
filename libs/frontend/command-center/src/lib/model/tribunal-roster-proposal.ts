import { z } from 'zod';

const token = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:#-]{0,79}$/);
const lane = z.object({
  laneId: token,
  family: token,
  displayName: z.string().trim().min(1).max(80),
  cli: z.enum(['codex', 'copilot', 'cursor', 'antigravity', 'opencode', 'pi', 'grok', 'ptah-cli']),
  model: token.optional(),
  role: z.enum(['plan', 'architect', 'implement', 'review', 'executor', 'judge']).optional(),
});
const schema = z.object({
  proposalId: token,
  nonce: token,
  rootSessionId: token,
  move: z.enum(['council', 'forge', 'race', 'relay', 'crucible']),
  options: z.array(z.string()).min(1),
  objective: z.string().trim().min(1).max(1000),
  rounds: z.number().int().min(1).max(2),
  lanes: z.array(lane).min(1).max(12),
});
export type TribunalRosterProposal = z.infer<typeof schema>;

export interface AvailableLane { readonly laneId: string; readonly state: string; readonly family: string }

/** Discovery candidates exclude exhausted capacity and keep the user's saved family order. */
export function rankAvailableLanes(lanes: readonly AvailableLane[], preferredAgentOrder: readonly string[]): readonly AvailableLane[] {
  return lanes.filter((item) => item.state !== 'AT LIMIT').sort((left, right) => {
    const leftRank = preferredAgentOrder.indexOf(left.family);
    const rightRank = preferredAgentOrder.indexOf(right.family);
    return (leftRank < 0 ? preferredAgentOrder.length : leftRank) - (rightRank < 0 ? preferredAgentOrder.length : rightRank);
  });
}

/** Mirrors the blocking rules in tribunal-roster-rules.ts:42-47,53-106; the phase alias does not export rosterIsLaunchable. */
export function rosterIsLaunchableLocally(proposal: TribunalRosterProposal): boolean {
  const lanes = proposal.lanes;
  if (new Set(lanes.map((item) => item.laneId)).size !== lanes.length) return false;
  if (proposal.move === 'relay') {
    if (!(['plan', 'architect', 'implement', 'review'] as const).every((role) => lanes.some((item) => item.role === role))) return false;
    const implement = lanes.find((item) => item.role === 'implement');
    const review = lanes.find((item) => item.role === 'review');
    return !implement || !review || implement.family !== review.family || (implement.model ?? '') !== (review.model ?? '');
  }
  if (proposal.move === 'crucible') {
    const executor = lanes.find((item) => item.role === 'executor');
    const judge = lanes.find((item) => item.role === 'judge');
    return !!executor && !!judge && executor.family !== judge.family;
  }
  return lanes.every((item) => item.role === undefined);
}

/** Accept only a complete delimited JSON block and current root/nonce. */
export function parseRosterProposal(payload: unknown, expectedRoot: string, expectedNonce: string, availableLanes?: readonly AvailableLane[]): TribunalRosterProposal | null {
  if (typeof payload !== 'string') return null;
  const match = /^<TRIBUNAL_ROSTER_PROPOSAL>\s*([\s\S]*?)\s*<\/TRIBUNAL_ROSTER_PROPOSAL>$/.exec(payload.trim());
  if (!match || match[1].length > 8192) return null;
  let data: unknown;
  try { data = JSON.parse(match[1]); } catch {
    // degradation-audit: reported — invalid proposal JSON is rejected and answered Decline by the caller
    return null;
  }
  const parsed = schema.safeParse(data);
  if (!parsed.success) return null;
  const proposal = parsed.data;
  if (proposal.options[0] !== 'Decline' || proposal.rootSessionId !== expectedRoot || proposal.nonce !== expectedNonce) return null;
  if (availableLanes && proposal.lanes.some((item) => !availableLanes.some((candidate) => candidate.laneId === item.laneId && candidate.state !== 'AT LIMIT'))) return null;
  if (proposal.move !== 'crucible' && proposal.rounds !== 1) return null;
  return rosterIsLaunchableLocally(proposal) ? proposal : null;
}
