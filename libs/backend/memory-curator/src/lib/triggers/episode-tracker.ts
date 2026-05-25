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

interface EpisodeState {
  turnCount: number;
  commits: number;
  assistantMessages: string[];
  failures: EpisodeFailure[];
  pendingFailedTools: Set<string>;
  recoveredTools: Set<string>;
}

function emptyState(): EpisodeState {
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
  private readonly sessions = new Map<string, EpisodeState>();

  private state(sessionId: string): EpisodeState {
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

  reset(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  clear(): void {
    this.sessions.clear();
  }
}
