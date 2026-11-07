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
  markDispatching(messageId: string): Promise<void>;
}

/**
 * DI token for {@link AgentMessageDispatchJournal}. Reuse this constant as
 * `CLI_AGENT_RUNTIME_TOKENS.AGENT_MESSAGE_DISPATCH_JOURNAL`; it is
 * `Symbol.for`, so every reference resolves the one registration.
 */
export const AGENT_MESSAGE_DISPATCH_JOURNAL = Symbol.for('AgentMessageDispatchJournal');
