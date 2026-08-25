/**
 * EpisodeTracker — per-session buffer of salient signals captured from SDK
 * hooks (Stop, PostToolUseFailure, PostToolUse). An "episode" is a coherent
 * unit of work; when it closes (commit, error→recovery, turn threshold,
 * session end) the buffer is assembled into a transcript and handed to the
 * curator so it extracts memories from real content rather than a placeholder.
 *
 * The buffer is bounded: a runaway session cannot grow it without limit.
 */

const MAX_ASSISTANT_MESSAGES = 15;
const MAX_FAILURES = 30;
const MAX_MESSAGE_CHARS = 2000;

export interface EpisodeFailure {
  readonly tool: string;
  readonly error: string;
  readonly at: number;
}

export interface EpisodeSnapshot {
  readonly turnCount: number;
  readonly failures: readonly EpisodeFailure[];
  readonly recoveredTools: readonly string[];
  readonly commits: number;
  readonly assistantMessages: readonly string[];
  /** True when the episode contains both a failure and a later recovery. */
  readonly hasCriticalLearning: boolean;
  readonly isEmpty: boolean;
}

/**
 * A session's live episode buffer, handed out by {@link EpisodeTracker.detach}
 * and accepted back by {@link EpisodeTracker.reattach}.
 *
 * Opaque to callers: the trigger service holds one across an `await` and gives
 * it back unread. Exported only so it can be named in that signature.
 */
export interface EpisodeBuffer {
  turnCount: number;
  commits: number;
  assistantMessages: string[];
  failures: EpisodeFailure[];
  pendingFailedTools: Set<string>;
  recoveredTools: Set<string>;
}

function emptyState(): EpisodeBuffer {
  return {
    turnCount: 0,
    commits: 0,
    assistantMessages: [],
    failures: [],
    pendingFailedTools: new Set<string>(),
    recoveredTools: new Set<string>(),
  };
}

export class EpisodeTracker {
  private readonly sessions = new Map<string, EpisodeBuffer>();

  private state(sessionId: string): EpisodeBuffer {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = emptyState();
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /** Record a completed assistant turn. Returns the new turn count. */
  recordTurn(sessionId: string, assistantMessage: string | null): number {
    const s = this.state(sessionId);
    s.turnCount++;
    const text = assistantMessage?.trim();
    if (text) {
      s.assistantMessages.push(text.slice(0, MAX_MESSAGE_CHARS));
      if (s.assistantMessages.length > MAX_ASSISTANT_MESSAGES) {
        s.assistantMessages.shift();
      }
    }
    return s.turnCount;
  }

  recordFailure(sessionId: string, tool: string, error: string): void {
    const s = this.state(sessionId);
    s.failures.push({
      tool,
      error: error.slice(0, MAX_MESSAGE_CHARS),
      at: Date.now(),
    });
    if (s.failures.length > MAX_FAILURES) {
      s.failures.shift();
    }
    s.pendingFailedTools.add(tool);
  }

  /**
   * Record a successful tool use. Returns true when this success clears a
   * previously-failed tool — an error→recovery transition, the highest-value
   * "critical learning" signal.
   */
  recordToolSuccess(sessionId: string, tool: string): boolean {
    const s = this.state(sessionId);
    if (!s.pendingFailedTools.has(tool)) return false;
    s.pendingFailedTools.delete(tool);
    s.recoveredTools.add(tool);
    return true;
  }

  recordCommit(sessionId: string): void {
    this.state(sessionId).commits++;
  }

  snapshot(sessionId: string): EpisodeSnapshot {
    const s = this.sessions.get(sessionId);
    if (!s) {
      return {
        turnCount: 0,
        failures: [],
        recoveredTools: [],
        commits: 0,
        assistantMessages: [],
        hasCriticalLearning: false,
        isEmpty: true,
      };
    }
    const hasCriticalLearning =
      s.failures.length > 0 && s.recoveredTools.size > 0;
    const isEmpty =
      s.turnCount === 0 &&
      s.failures.length === 0 &&
      s.commits === 0 &&
      s.assistantMessages.length === 0;
    return {
      turnCount: s.turnCount,
      failures: [...s.failures],
      recoveredTools: [...s.recoveredTools],
      commits: s.commits,
      assistantMessages: [...s.assistantMessages],
      hasCriticalLearning,
      isEmpty,
    };
  }

  /**
   * Assemble the buffered episode into a transcript for the curator LLM.
   * Returns an empty string when there is nothing worth curating.
   *
   * @deprecated Episode transcript composition has moved to
   * `MemoryTriggerService.invokeCurate`, which composes a richer transcript
   * from a JSONL excerpt + drained `observation_queue` rows + episode
   * snapshot. This method is retained as a non-load-bearing utility for
   * episode debug dumps and is no longer called from the trigger path.
   */
  buildTranscript(sessionId: string): string {
    const snap = this.snapshot(sessionId);
    if (snap.isEmpty) return '';
    const parts: string[] = [];
    parts.push(`# Session episode — ${snap.turnCount} assistant turn(s)`);
    if (snap.assistantMessages.length > 0) {
      parts.push('\n## Assistant turn summaries');
      for (const m of snap.assistantMessages) {
        parts.push(`- ${m}`);
      }
    }
    if (snap.failures.length > 0) {
      parts.push('\n## Tool failures encountered');
      for (const f of snap.failures) {
        parts.push(`- ${f.tool}: ${f.error}`);
      }
    }
    if (snap.recoveredTools.length > 0) {
      parts.push(
        `\n## Recovered after failure: ${snap.recoveredTools.join(', ')}`,
      );
    }
    if (snap.commits > 0) {
      parts.push(`\n## Commits in this episode: ${snap.commits}`);
    }
    return parts.join('\n');
  }

  /**
   * Salience boost in [0, 0.3] reflecting how "critical" the episode is.
   * Error→recovery episodes and committed work score highest.
   */
  salienceBoost(sessionId: string): number {
    const snap = this.snapshot(sessionId);
    let boost = 0;
    if (snap.hasCriticalLearning) boost += 0.2;
    if (snap.commits > 0) boost += 0.1;
    return Math.min(0.3, boost);
  }

  /**
   * Move a session's episode buffer from `fromId` to `toId` when the SDK
   * resolves the canonical UUID for a buffer armed under the tabId.
   *
   * **Refuse-overwrite**, mirroring `SessionRegistry.bindRealSessionId`: when
   * `toId` already holds a buffer, that buffer WINS and the `fromId` entry is
   * discarded. A missed merge costs one un-curated episode and is recoverable;
   * clobbering a live buffer is not.
   *
   * @returns true when the buffer moved, false when there was nothing to move
   * or the destination was already occupied.
   */
  rekey(fromId: string, toId: string): boolean {
    const buffer = this.sessions.get(fromId);
    if (!buffer) return false;
    this.sessions.delete(fromId);
    if (this.sessions.has(toId)) return false;
    this.sessions.set(toId, buffer);
    return true;
  }

  /**
   * Clear the session's buffer AND hand it back, so the caller can put it
   * where it found it if the work it was closing the episode for never ran.
   *
   * Same effect as {@link reset} for a caller that drops the return value.
   * `MemoryTriggerService` uses it instead of `reset` on the curate path
   * because the reset fires BEFORE the curate resolves — it has to, or turns
   * arriving during the pass would be swallowed by a later reset — and a pass
   * the provider quota gate stops never consumed the episode it cleared
   * (TASK_2026_306 Batch 10, F1).
   *
   * @returns the detached buffer, or `null` when the session had none.
   */
  detach(sessionId: string): EpisodeBuffer | null {
    const buffer = this.sessions.get(sessionId);
    if (!buffer) return null;
    this.sessions.delete(sessionId);
    return buffer;
  }

  /**
   * Put a detached buffer back, MERGING it under anything captured since.
   *
   * A merge rather than a `set`, because the window between `detach` and
   * `reattach` spans an `await` and new turns land in a fresh buffer during it.
   * Overwriting would trade one lost episode for another. Restored events go
   * FIRST — they are older — and the same bounds `recordTurn` and
   * `recordFailure` enforce are re-applied, so a reattach cannot grow the
   * buffer past its cap.
   */
  reattach(sessionId: string, buffer: EpisodeBuffer): void {
    const current = this.sessions.get(sessionId);
    if (!current) {
      this.sessions.set(sessionId, buffer);
      return;
    }
    current.turnCount += buffer.turnCount;
    current.commits += buffer.commits;
    current.assistantMessages = [
      ...buffer.assistantMessages,
      ...current.assistantMessages,
    ].slice(-MAX_ASSISTANT_MESSAGES);
    current.failures = [...buffer.failures, ...current.failures].slice(
      -MAX_FAILURES,
    );
    for (const tool of buffer.pendingFailedTools) {
      // A tool the newer buffer already recovered stays recovered — a
      // restored "still failing" marker must not un-recover it.
      if (!current.recoveredTools.has(tool))
        current.pendingFailedTools.add(tool);
    }
    for (const tool of buffer.recoveredTools) {
      current.recoveredTools.add(tool);
      current.pendingFailedTools.delete(tool);
    }
  }

  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }
}
