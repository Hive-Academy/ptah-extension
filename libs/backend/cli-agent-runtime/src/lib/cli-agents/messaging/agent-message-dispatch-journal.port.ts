/**
 * Durable record that a queued lane message is about to reach its adapter
 * (Component 7, finding 1). `AgentMessageRouter.flushPending` awaits
 * `markDispatching` before `continueConversation`; a rejection means the
 * message is not dispatched.
 *
 * Implemented over the envelope store as a write of `dispatching` + a new
 * `attemptId` + `everDispatched: true`.
 */
export interface AgentMessageDispatchJournal {
  /**
   * Rejects with {@link AgentMessageDispatchWithdrawnError} when the message
   * was decided elsewhere (cancelled, re-routed, already dispatching); any
   * other rejection is a storage failure.
   */
  markDispatching(messageId: string): Promise<void>;
}

/**
 * The envelope is no longer dispatchable: a cancel or retry persisted its
 * decision first. The router drops the parked entry instead of re-queueing it.
 */
export class AgentMessageDispatchWithdrawnError extends Error {
  constructor(readonly messageId: string, readonly state: string) {
    super(`Message ${messageId} is no longer dispatchable (${state}).`);
    this.name = 'AgentMessageDispatchWithdrawnError';
  }
}

/**
 * DI token for {@link AgentMessageDispatchJournal}. Reuse this constant as
 * `CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_DISPATCH_JOURNAL`; it is
 * `Symbol.for`, so every reference resolves the one registration.
 */
export const AGENT_MESSAGE_DISPATCH_JOURNAL = Symbol.for('AgentMessageDispatchJournal');
