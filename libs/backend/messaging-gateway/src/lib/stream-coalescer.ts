/**
 * StreamCoalescer — merges high-frequency assistant token chunks into a
 * small number of outbound message edits per conversation.
 *
 * Per architecture §9 Track 4 requirement 3:
 *   - Per `(platform, externalChatId)` p-queue with `concurrency=1, intervalCap=1, interval=1000ms`.
 *   - Flush at 800ms idle OR 200 tokens.
 *   - Concatenate, never drop.
 *
 * We intentionally do NOT depend on `p-queue` directly here (the runtime
 * dependency is added via `apps/ptah-electron/package.json`). Instead the
 * coalescer is a pure timer/buffer state machine that the GatewayService
 * drives — keeping it trivially unit-testable with `jest.useFakeTimers()`.
 *
 * The flush callback is responsible for the actual platform-side edit (or
 * first-time send when `isFirstFlush === true`). We surface that flag so
 * the adapter can choose `sendMessage` vs `editMessage`.
 */
import type { ConversationKey } from './types';

export interface CoalescerOptions {
  /** Idle window — flush this long after the last chunk. Default 800ms. */
  idleMs?: number;
  /** Token-count flush threshold (approx — we count chars / 4). Default 200. */
  maxTokens?: number;
  /** Hard ceiling so a perma-streaming agent still emits edits. Default 5000ms. */
  maxAgeMs?: number;
}

export interface FlushPayload {
  readonly conversationKey: ConversationKey;
  readonly body: string;
  readonly isFirstFlush: boolean;
}

export type FlushCallback = (payload: FlushPayload) => Promise<void> | void;

interface BufferState {
  /**
   * Cumulative body for the current stream — grows as chunks arrive and is
   * passed to the flush callback in full each time. Adapters that support
   * `editMessage` use this to replace the message body with the latest
   * cumulative text; first-flush adapters use it as the initial send.
   * Reset only on `discard()` (stream end) so `editMessage` always replaces
   * with the full assistant output, never a delta.
   */
  body: string;
  /** Pending unflushed chunk content — used to drive the maxTokens trigger. */
  pendingDelta: string;
  startedAt: number;
  idleTimer: NodeJS.Timeout | null;
  ageTimer: NodeJS.Timeout | null;
  flushed: boolean;
  /** Reentrancy guard so a slow flush callback doesn't re-enter itself. */
  flushing: boolean;
}

/** Default options derived from architecture §9. */
const DEFAULTS: Required<CoalescerOptions> = {
  idleMs: 800,
  maxTokens: 200,
  maxAgeMs: 5_000,
};

/** Approx token count — 4 chars/token is a Claude/GPT industry rule of thumb. */
function approxTokens(s: string): number {
  return Math.ceil(s.length / 4);
}

export class StreamCoalescer {
  private readonly buffers = new Map<ConversationKey, BufferState>();
  private readonly opts: Required<CoalescerOptions>;

  constructor(
    private readonly flush: FlushCallback,
    opts?: CoalescerOptions,
  ) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Append a new chunk. Resets the idle timer. May trigger an immediate
   * flush if the buffer crossed `maxTokens`.
   */
  append(conversationKey: ConversationKey, chunk: string): void {
    if (!chunk) return;
    let state = this.buffers.get(conversationKey);
    if (!state) {
      state = {
        body: '',
        pendingDelta: '',
        startedAt: Date.now(),
        idleTimer: null,
        ageTimer: null,
        flushed: false,
        flushing: false,
      };
      this.buffers.set(conversationKey, state);
      // Hard ceiling timer — only set once per buffer lifetime.
      state.ageTimer = setTimeout(
        () => void this.doFlush(conversationKey),
        this.opts.maxAgeMs,
      );
    }
    state.body += chunk;
    state.pendingDelta += chunk;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleTimer = setTimeout(
      () => void this.doFlush(conversationKey),
      this.opts.idleMs,
    );

    // Trigger an immediate flush when the *delta* since the last flush crosses
    // the token threshold — so a long-running stream emits at most one edit
    // per maxTokens worth of new content.
    if (approxTokens(state.pendingDelta) >= this.opts.maxTokens) {
      void this.doFlush(conversationKey);
    }
  }

  /** Force-flush a conversation (e.g. on stream end). */
  async drain(conversationKey: ConversationKey): Promise<void> {
    await this.doFlush(conversationKey);
  }

  /** Drop pending buffer without flushing — used on adapter shutdown. */
  discard(conversationKey: ConversationKey): void {
    const state = this.buffers.get(conversationKey);
    if (!state) return;
    if (state.idleTimer) clearTimeout(state.idleTimer);
    if (state.ageTimer) clearTimeout(state.ageTimer);
    this.buffers.delete(conversationKey);
  }

  /**
   * Drain all pending buffers, then discard. Call this on graceful shutdown
   * so partially-assembled messages reach the platform before the adapters stop.
   */
  async drainAll(): Promise<void> {
    await Promise.all([...this.buffers.keys()].map((k) => this.drain(k)));
    this.discardAll();
  }

  /** Discard every pending buffer WITHOUT flushing — use only after `drainAll`. */
  discardAll(): void {
    for (const key of [...this.buffers.keys()]) this.discard(key);
  }

  private async doFlush(conversationKey: ConversationKey): Promise<void> {
    const state = this.buffers.get(conversationKey);
    if (!state) return;
    if (state.flushing) return; // reentrancy guard
    if (!state.pendingDelta) {
      // Nothing new to send — clear timers but keep entry so subsequent
      // appends do not reset `flushed`/`isFirstFlush`.
      if (state.idleTimer) {
        clearTimeout(state.idleTimer);
        state.idleTimer = null;
      }
      return;
    }

    state.flushing = true;
    const isFirstFlush = !state.flushed;
    // Send the *cumulative* body so editMessage callers replace the message
    // with the full assistant output (architecture §8.5: "concatenated
    // within the window then sent as a single message edit").
    const body = state.body;
    state.pendingDelta = '';
    state.flushed = true;
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
    try {
      await this.flush({ conversationKey, body, isFirstFlush });
    } finally {
      state.flushing = false;
      // If new chunks arrived during flush, schedule another idle flush.
      if (state.pendingDelta) {
        state.idleTimer = setTimeout(
          () => void this.doFlush(conversationKey),
          this.opts.idleMs,
        );
      }
    }
  }
}
