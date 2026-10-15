import type { HarnessConfig } from './rpc-harness.types';

/** One saved tool invocation, before updates are folded into the legacy view. */
export interface HarnessProposalRevision {
  /** Stable across storage reads and live push delivery. */
  id: string;
  configUpdates: Partial<HarnessConfig>;
  isConfigComplete: boolean;
  updatedAt: string;
  /** SDK user turn start captured at invocation; absent when attribution is ambiguous. */
  turnStartedAt?: string;
}

/** A durable proposal scoped to the host workspace and a real SDK session. */
export interface HarnessProposal {
  version: 1;
  workspaceRoot: string;
  /** Real SDK session ID; never a UI tab or correlation ID. */
  sessionId: string;
  configUpdates: Partial<HarnessConfig>;
  isConfigComplete: boolean;
  updatedAt: string;
  /** Absent in legacy records; the parser supplies one unattributed revision. */
  revisions?: HarnessProposalRevision[];
}

export interface HarnessGetProposalParams {
  sessionId: string;
}

export interface HarnessGetProposalResult {
  proposal: HarnessProposal | null;
}
