import type { HarnessConfig, HarnessProposal } from '@ptah-extension/shared';

/** Durable harness proposals keyed by the real SDK session id. */
export interface IHarnessProposalStore {
  save(
    sessionId: string,
    update: Partial<HarnessConfig>,
    complete: boolean,
  ): Promise<HarnessProposal>;

  get(sessionId: string): Promise<HarnessProposal | null>;
}
