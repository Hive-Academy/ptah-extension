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
 * is pending; `take`, `clear` and a `withdraw` of the last notice delete it.
 * No timers, no polling.
 *
 * Drops: a notice posted with `onDropped` gets that callback when it leaves
 * the queue undelivered, i.e. dropped past the bound or by `clear` (turn end,
 * session end). `take` (delivered) and `withdraw` (taken back) never call it.
 * The subagent budget monitor uses it so a handoff is never lost silently.
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

/** One pending notice, as `post` stored it. */
interface PendingNotice {
  readonly text: string;
  readonly onDropped?: () => void;
}

@injectable()
export class MainThreadNoticeQueue {
  /** Pending notices, oldest first; only sessions with a pending notice. */
  private readonly pending = new Map<string, PendingNotice[]>();

  constructor(@inject(TOKENS.LOGGER) private readonly logger: Logger) {}

  /**
   * Queue a notice for the session's next main-thread tool result. A blank
   * session id or blank text is ignored. `onDropped` runs if the notice later
   * leaves the queue undelivered (see the file header).
   */
  post(sessionId: string, text: string, onDropped?: () => void): void {
    if (sessionId.length === 0 || text.trim().length === 0) {
      return;
    }
    const notices = this.pending.get(sessionId) ?? [];
    notices.push({ text: capNotice(text), onDropped });
    this.pending.set(sessionId, notices);
    if (notices.length > MAX_PENDING_NOTICES_PER_SESSION) {
      const dropped = notices.shift();
      this.logger.debug(
        '[MainThreadNoticeQueue] pending notice limit reached, dropped the oldest',
        { sessionId, limit: MAX_PENDING_NOTICES_PER_SESSION },
      );
      this.notifyDropped(dropped ? [dropped] : []);
    }
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
    return notices.length > 0
      ? notices.map((notice) => notice.text).join(NOTICE_SEPARATOR)
      : undefined;
  }

  /**
   * Remove one pending notice equal to `text` (as `post` stored it) and
   * report whether it was still pending. The subagent budget monitor uses it
   * to take back a handoff no tool result drained, so it can deliver it
   * another way exactly once.
   */
  withdraw(sessionId: string, text: string): boolean {
    const notices = this.pending.get(sessionId);
    const capped = capNotice(text);
    const index = notices?.findIndex((notice) => notice.text === capped) ?? -1;
    if (!notices || index < 0) {
      return false;
    }
    notices.splice(index, 1);
    if (notices.length === 0) {
      this.pending.delete(sessionId);
    }
    return true;
  }

  /** Drop every pending notice for the session (turn end, session end). */
  clear(sessionId: string): void {
    const notices = this.pending.get(sessionId);
    this.pending.delete(sessionId);
    this.notifyDropped(notices ?? []);
  }

  /** Tell each dropped notice's producer; a throwing callback never breaks the queue. */
  private notifyDropped(notices: readonly PendingNotice[]): void {
    for (const notice of notices) {
      try {
        notice.onDropped?.();
      } catch (error: unknown) {
        // degradation-audit: reported - logged below; the other notices and
        // the caller (post, or the turn-end/session-end clear) go on.
        this.logger.debug('[MainThreadNoticeQueue] onDropped callback failed', {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      }
    }
  }
}
