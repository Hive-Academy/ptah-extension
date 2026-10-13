/**
 * MainThreadNoticeQueue (TASK_2026_627 Component 2).
 *
 * Holds short host-authored notices for a session's main agent until its next
 * main-thread tool result, where `PostToolUseHookHandler` drains them into
 * `additionalContext`. The producer is the subagent budget monitor (handoff
 * notice); the session budget clears a session's pending notices at turn end.
 *
 * Notice text must be authored by the host. It never carries tool output or
 * transcript text: hook context reaches the model with host framing.
 *
 * Bounds: at most {@link MAX_PENDING_NOTICES_PER_SESSION} pending notices per
 * session (the oldest is dropped, one DEBUG line per drop), each cut to
 * {@link MAX_NOTICE_CHARS} characters. A map entry exists only while a notice
 * is pending; `take` and `clear` delete it. No timers, no polling.
 */
import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';

/** Pending notices kept per session; posting past this drops the oldest. */
export const MAX_PENDING_NOTICES_PER_SESSION = 4;

/** Length cap for one notice, in UTF-16 code units. */
export const MAX_NOTICE_CHARS = 2_000;

/** Separator between notices drained in one `take`. */
const NOTICE_SEPARATOR = '\n\n';

/** Cut `text` to the cap without leaving half of a surrogate pair at the end. */
function capNotice(text: string): string {
  if (text.length <= MAX_NOTICE_CHARS) {
    return text;
  }
  const cut = text.slice(0, MAX_NOTICE_CHARS);
  const last = cut.charCodeAt(cut.length - 1);
  const endsOnHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return endsOnHighSurrogate ? cut.slice(0, -1) : cut;
}

@injectable()
export class MainThreadNoticeQueue {
  /** Pending notices, oldest first; only sessions with a pending notice. */
  private readonly pending = new Map<string, string[]>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Queue a notice for the session's next main-thread tool result. A blank
   * session id or blank text is ignored.
   */
  post(sessionId: string, text: string): void {
    if (sessionId.length === 0 || text.trim().length === 0) {
      return;
    }
    const notices = this.pending.get(sessionId) ?? [];
    notices.push(capNotice(text));
    if (notices.length > MAX_PENDING_NOTICES_PER_SESSION) {
      notices.shift();
      this.logger.debug(
        '[MainThreadNoticeQueue] pending notice limit reached, dropped the oldest',
        { sessionId, limit: MAX_PENDING_NOTICES_PER_SESSION },
      );
    }
    this.pending.set(sessionId, notices);
  }

  /**
   * Remove and return every pending notice for the session, oldest first,
   * joined by a blank line; `undefined` when none is pending. Never throws.
   */
  take(sessionId: string): string | undefined {
    const notices = this.pending.get(sessionId);
    if (!notices) {
      return undefined;
    }
    this.pending.delete(sessionId);
    return notices.length > 0 ? notices.join(NOTICE_SEPARATOR) : undefined;
  }

  /** Drop every pending notice for the session (session ended or released). */
  clear(sessionId: string): void {
    this.pending.delete(sessionId);
  }
}
