import type { HarnessConfig, HarnessProposal } from '@ptah-extension/shared';

/** Durable harness proposals keyed by the real SDK session id. */
export interface IHarnessProposalStore {
  /** Freeze an unambiguous SDK turn in the caller's pinned workspace. */
  captureProposingTurnStartedAt(
    sessionId: string,
    workspaceRoot?: string,
  ): {
    readonly turnStartedAt?: string;
    /** Release the retained invocation when its save settles. */
    release(): void;
  };

  save(
    sessionId: string,
    update: Partial<HarnessConfig>,
    complete: boolean,
    turnStartedAt?: string,
    workspaceRoot?: string,
  ): Promise<HarnessProposal>;

  get(
    sessionId: string,
    workspaceRoot?: string,
  ): Promise<HarnessProposal | null>;
}
