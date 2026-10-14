/**
 * SubagentNoticeQueue — one pending host notice per running subagent.
 *
 * Keyed by the SDK `agent_id` of the subagent (the id its own hook inputs
 * carry). `PostToolUseHookHandler` drains a subagent's notice into the
 * `additionalContext` of that subagent's next tool result, so the notice
 * reaches only that subagent's context: never the main thread (its hooks
 * carry no `agent_id`) and never another subagent. The producer is the
 * subagent budget monitor (the near-budget warning).
 *
 * Bounds: one pending notice per subagent (a new post replaces it), cut to
 * {@link MAX_SUBAGENT_NOTICE_CHARS}. An entry exists only while a notice is
 * pending; `take` and `withdraw` delete it. No timers, no polling.
 */
import { injectable } from 'tsyringe';

/** Length cap for one notice, in UTF-16 code units. */
export const MAX_SUBAGENT_NOTICE_CHARS = 2_000;

@injectable()
export class SubagentNoticeQueue {
  private readonly pending = new Map<string, string>();

  /** Queue `text` for the subagent's next tool result. Blank input is ignored. */
  post(agentId: string, text: string): void {
    if (agentId.length === 0 || text.trim().length === 0) {
      return;
    }
    this.pending.set(agentId, text.slice(0, MAX_SUBAGENT_NOTICE_CHARS));
  }

  /** Remove and return the subagent's pending notice; `undefined` when none. */
  take(agentId: string): string | undefined {
    const notice = this.pending.get(agentId);
    this.pending.delete(agentId);
    return notice;
  }

  /** Drop the subagent's pending notice (it stopped or its session ended). */
  withdraw(agentId: string): void {
    this.pending.delete(agentId);
  }
}
