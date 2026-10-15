import type { HarnessConfig } from './rpc-harness.types';

/** A durable proposal scoped to the host workspace and a real SDK session. */
export interface HarnessProposal {
  version: 1;
  workspaceRoot: string;
  /** Real SDK session ID; never a UI tab or correlation ID. */
  sessionId: string;
  configUpdates: Partial<HarnessConfig>;
  isConfigComplete: boolean;
  updatedAt: string;
}

export interface HarnessGetProposalParams {
  sessionId: string;
}

export interface HarnessGetProposalResult {
  proposal: HarnessProposal | null;
}
