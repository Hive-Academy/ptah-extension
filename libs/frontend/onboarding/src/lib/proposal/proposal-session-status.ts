import {
  CircleCheck,
  CircleX,
  Loader,
  MessageSquareMore,
  Pause,
  Plug,
} from 'lucide-angular';
import type { HarnessSessionController } from '@ptah-extension/harness-builder';
import type { StatusCardTone } from '../shared/status-card.component';

export type ProposalSessionStatus =
  | 'loading'
  | 'working'
  | 'waiting'
  | 'ready'
  | 'failed'
  | 'stopping'
  | 'not-connected';

type SessionPhase = ReturnType<
  ReturnType<HarnessSessionController['session']>['phase']
>;

export interface ProposalSessionStatusInput {
  restoreState: string;
  hasRecord: boolean;
  phase: SessionPhase;
  reviewEligible: boolean;
}

export function proposalSessionStatus(
  input: ProposalSessionStatusInput,
): ProposalSessionStatus {
  if (input.restoreState === 'loading') return 'loading';
  if (!input.hasRecord) return 'not-connected';
  if (input.phase === 'failed') return 'failed';
  if (input.phase === 'cancelling') return 'stopping';
  if (input.phase === 'sending' || input.phase === 'busy') return 'working';
  if (input.reviewEligible) return 'ready';
  return 'waiting';
}

export const PROPOSAL_SESSION_PRESENTATION = {
  loading: {
    title: 'Loading proposal',
    subLine: 'Restoring your session and latest revision.',
    tone: 'idle',
    icon: Loader,
  },
  working: {
    title: 'Working',
    subLine: 'The agent is reading your brief and building the proposal.',
    tone: 'run',
    icon: Loader,
  },
  waiting: {
    title: 'Waiting for you',
    subLine: 'Agent replied. Your turn: answer or refine below.',
    tone: 'need',
    icon: MessageSquareMore,
  },
  ready: {
    title: 'Proposal ready',
    subLine: 'Revision N is complete. Review it, or keep refining.',
    tone: 'done',
    icon: CircleCheck,
  },
  failed: {
    title: 'Failed',
    subLine: 'The agent could not finish this turn.',
    tone: 'err',
    icon: CircleX,
  },
  stopping: {
    title: 'Stopping',
    subLine: 'Stopping the agent. This takes a moment.',
    tone: 'need',
    icon: Pause,
  },
  'not-connected': {
    title: 'Not connected',
    subLine: 'No session is attached to this proposal.',
    tone: 'idle',
    icon: Plug,
  },
} as const satisfies Record<ProposalSessionStatus, {
  title: string;
  subLine: string;
  tone: StatusCardTone;
  icon: typeof Loader;
}>;
