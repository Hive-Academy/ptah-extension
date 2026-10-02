import { InjectionToken } from '@angular/core';

/**
 * Which chat session receives the feedback: a specific session by id, or the
 * session in the active tab.
 */
export type AgentFeedbackTarget = { readonly sessionId: string } | 'active';

/** Outcome of a send. `error` is a user-facing message when `sent` is false. */
export interface AgentFeedbackSendResult {
  readonly sent: boolean;
  readonly error?: string;
}

/**
 * Contract for sending review feedback (for example drafted diff comments) to
 * an agent's chat session.
 *
 * `send` resolves with `sent: false` and an `error` instead of rejecting, so a
 * caller keeps its drafts and shows the error when the message did not go out.
 *
 * The chat library implements it. This token breaks the dependency cycle the
 * same way `FILE_LINK_OPENER` does: core defines the port, feature libraries
 * such as git-ui consume it without importing chat, and the composition root
 * binds the implementation. There is no default provider.
 */
export interface IAgentFeedbackSender {
  send(
    target: AgentFeedbackTarget,
    text: string,
  ): Promise<AgentFeedbackSendResult>;
}

export const AGENT_FEEDBACK_SENDER = new InjectionToken<IAgentFeedbackSender>(
  'AGENT_FEEDBACK_SENDER',
);
