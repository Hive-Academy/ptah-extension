import { Injectable, inject, signal } from '@angular/core';
import {
  AGENT_FEEDBACK_SENDER,
  type AgentFeedbackSendResult,
  type AgentFeedbackTarget,
  type IAgentFeedbackSender,
} from '@ptah-extension/core';

/**
 * Whose drafts these are. A change set opened from an agent turn carries the
 * session that made it; any other review falls back to the workspace, and its
 * drafts go to the active chat session.
 */
export interface ReviewDraftOwner {
  readonly workspaceRoot: string;
  readonly ownerSessionId?: string;
}

/** One drafted line comment. Line numbers are 1-based and inclusive. */
export interface ReviewCommentDraft {
  readonly id: string;
  /** Workspace-relative path. */
  readonly path: string;
  readonly startLine: number;
  readonly endLine: number;
  /** The commented lines, verbatim, without terminators. */
  readonly lines: readonly string[];
  /** What the reviewer wrote. May be empty: the quote alone is the comment. */
  readonly body: string;
}

export type ReviewCommentDraftInput = Omit<ReviewCommentDraft, 'id'>;

const EMPTY: readonly ReviewCommentDraft[] = [];

const NOTHING_TO_SEND_MESSAGE = 'There are no draft comments to send.';
const SENDER_UNAVAILABLE_MESSAGE =
  'Sending to the agent is not available here. Your drafts are kept.';
const SEND_FAILED_MESSAGE =
  'The comments could not be sent. Your drafts are kept.';

let nextDraftId = 0;

/** The Map key: the owning session when there is one, else the workspace. */
export function reviewDraftOwnerKey(owner: ReviewDraftOwner): string {
  return owner.ownerSessionId
    ? `session:${owner.ownerSessionId}`
    : `workspace:${owner.workspaceRoot}`;
}

function feedbackTarget(owner: ReviewDraftOwner): AgentFeedbackTarget {
  return owner.ownerSessionId ? { sessionId: owner.ownerSessionId } : 'active';
}

/**
 * A fence longer than any backtick run in the quoted lines, so a quote that
 * itself contains a fenced block cannot close ours early.
 */
function fenceFor(lines: readonly string[]): string {
  let longest = 0;
  for (const line of lines) {
    for (const run of line.match(/`+/g) ?? []) {
      longest = Math.max(longest, run.length);
    }
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

/**
 * One message for every draft (Requirement 6.7): per draft, the path and
 * `Lstart-Lend`, the quoted lines in a fenced block, then the comment.
 */
export function formatReviewCommentMessage(
  drafts: readonly ReviewCommentDraft[],
): string {
  const sections = drafts.map((draft) => {
    const fence = fenceFor(draft.lines);
    const parts = [
      `${draft.path} L${draft.startLine}-L${draft.endLine}`,
      fence,
      ...draft.lines,
      fence,
    ];
    const body = draft.body.trim();
    if (body) parts.push(body);
    return parts.join('\n');
  });
  const heading =
    drafts.length === 1
      ? 'Review comment on your changes:'
      : `Review comments on your changes (${drafts.length}):`;
  return [heading, ...sections].join('\n\n');
}

/**
 * ReviewCommentDraftStore — drafted line comments for the review canvas.
 *
 * In memory for the app session only (design-spec §6.3): a root service, so
 * drafts survive the canvas closing and reopening, and nothing is written to
 * disk. Keyed by `ownerSessionId ?? workspaceRoot` (implementation-plan
 * Component 24).
 *
 * {@link send} clears exactly the drafts it sent, and only on `sent: true`; a
 * failed send keeps every draft, and a draft added while a send is in flight
 * survives it.
 */
@Injectable({ providedIn: 'root' })
export class ReviewCommentDraftStore {
  /** Optional: no provider means sending is unavailable, not a crash. */
  private readonly sender = inject(AGENT_FEEDBACK_SENDER, { optional: true });

  private readonly _drafts = signal<
    ReadonlyMap<string, readonly ReviewCommentDraft[]>
  >(new Map());
  private readonly _sending = signal<ReadonlySet<string>>(new Set());
  /** Per owner key: the running send and the ids of the drafts it carries. */
  private readonly inFlight = new Map<
    string,
    {
      readonly run: Promise<AgentFeedbackSendResult>;
      readonly draftIds: ReadonlySet<string>;
    }
  >();

  /** The owner's drafts, oldest first. Reactive. */
  draftsFor(owner: ReviewDraftOwner): readonly ReviewCommentDraft[] {
    return this._drafts().get(reviewDraftOwnerKey(owner)) ?? EMPTY;
  }

  /** Whether a send for this owner is in flight. Reactive. */
  isSending(owner: ReviewDraftOwner): boolean {
    return this._sending().has(reviewDraftOwnerKey(owner));
  }

  /**
   * Add a draft. Returns `null`, adding nothing, for an input that cannot be
   * quoted: an empty path, a non-positive or inverted range, or a line count
   * that does not match the range.
   */
  add(
    owner: ReviewDraftOwner,
    input: ReviewCommentDraftInput,
  ): ReviewCommentDraft | null {
    const { path, startLine, endLine, lines } = input;
    if (
      path.trim() === '' ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      lines.length !== endLine - startLine + 1
    ) {
      return null;
    }
    const draft: ReviewCommentDraft = {
      id: `draft-${++nextDraftId}`,
      path,
      startLine,
      endLine,
      lines: [...lines],
      body: input.body,
    };
    const key = reviewDraftOwnerKey(owner);
    this.update(key, (drafts) => [...drafts, draft]);
    return draft;
  }

  remove(owner: ReviewDraftOwner, id: string): void {
    this.update(reviewDraftOwnerKey(owner), (drafts) =>
      drafts.filter((draft) => draft.id !== id),
    );
  }

  /**
   * Send every draft of this owner as one message to the owning session, or
   * to the active session when there is none.
   *
   * A second call while one is in flight joins it when that send already
   * carries every current draft (a double click). When drafts were added after
   * it started, the call waits for it and then sends what is left, so its
   * result always speaks for the drafts that existed when it was made.
   */
  send(owner: ReviewDraftOwner): Promise<AgentFeedbackSendResult> {
    const key = reviewDraftOwnerKey(owner);
    const pending = this.inFlight.get(key);
    if (pending) {
      const covered = this.draftsFor(owner).every((draft) =>
        pending.draftIds.has(draft.id),
      );
      if (covered) return pending.run;
      return pending.run.then((first) =>
        first.sent && this.draftsFor(owner).length > 0
          ? this.send(owner)
          : first,
      );
    }

    const drafts = this.draftsFor(owner);
    if (drafts.length === 0) {
      return Promise.resolve({ sent: false, error: NOTHING_TO_SEND_MESSAGE });
    }
    const sender = this.sender;
    if (!sender) {
      return Promise.resolve({ sent: false, error: SENDER_UNAVAILABLE_MESSAGE });
    }

    const run = this.deliver(key, owner, drafts, sender);
    this.inFlight.set(key, {
      run,
      draftIds: new Set(drafts.map((draft) => draft.id)),
    });
    this._sending.update((keys) => new Set(keys).add(key));
    return run;
  }

  private async deliver(
    key: string,
    owner: ReviewDraftOwner,
    drafts: readonly ReviewCommentDraft[],
    sender: IAgentFeedbackSender,
  ): Promise<AgentFeedbackSendResult> {
    try {
      const result = await sender.send(
        feedbackTarget(owner),
        formatReviewCommentMessage(drafts),
      );
      if (result.sent) {
        const sent = new Set(drafts.map((draft) => draft.id));
        this.update(key, (current) =>
          current.filter((draft) => !sent.has(draft.id)),
        );
        return { sent: true };
      }
      return { sent: false, error: result.error || SEND_FAILED_MESSAGE };
    } catch (error: unknown) {
      // The port promises to resolve, never reject; a throw is a defect in
      // the sender, and its text has not been written for a user.
      console.error('[ReviewCommentDraftStore] send threw', error);
      return { sent: false, error: SEND_FAILED_MESSAGE };
    } finally {
      this.inFlight.delete(key);
      this._sending.update((keys) => {
        const next = new Set(keys);
        next.delete(key);
        return next;
      });
    }
  }

  private update(
    key: string,
    change: (
      drafts: readonly ReviewCommentDraft[],
    ) => readonly ReviewCommentDraft[],
  ): void {
    this._drafts.update((map) => {
      const current = map.get(key) ?? EMPTY;
      const next = change(current);
      if (next === current || (next.length === 0 && current.length === 0)) {
        return map;
      }
      const copy = new Map(map);
      if (next.length === 0) copy.delete(key);
      else copy.set(key, next);
      return copy;
    });
  }
}
