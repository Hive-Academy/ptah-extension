import type { HarnessConfig, HarnessProposal } from '@ptah-extension/shared';

/** Durable harness proposals keyed by the real SDK session id. */
export interface IHarnessProposalStore {
  /** Freeze an unambiguous SDK turn before the proposing tool awaits storage. */
  captureProposingTurnStartedAt(sessionId: string): {
    readonly turnStartedAt?: string;
    /** Release the retained invocation when its save settles. */
    release(): void;
  };

  save(
    sessionId: string,
    update: Partial<HarnessConfig>,
    complete: boolean,
    turnStartedAt?: string,
  ): Promise<HarnessProposal>;

  get(sessionId: string): Promise<HarnessProposal | null>;
}
