import { inject, injectable } from 'tsyringe';
import { blankToUndefined } from '@ptah-extension/shared';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  IFileSystemProvider,
  IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import type { SqliteConnectionService } from '@ptah-extension/persistence-sqlite';
import {
  MEMORY_CONTRACT_TOKENS,
  type ITranscriptReader,
} from '@ptah-extension/memory-contracts';
import {
  SDK_TOKENS,
  type SessionActivityPayload,
  type SessionActivityRegistry,
  type SessionEndPayload,
  type SessionEndCallbackRegistry,
  type JsonlReaderService,
  type PostToolUseCallbackRegistry,
  type PostToolUsePayload,
  type SessionIdResolvedCallbackRegistry,
  type SessionStartCallbackRegistry,
  type SessionStartPayload,
  type UserPromptSubmitCallbackRegistry,
  type UserPromptSubmitPayload,
  type StopCallbackRegistry,
  type StopPayload,
  type SessionEndHookCallbackRegistry,
  type SessionEndHookPayload,
  type ToolFailureCallbackRegistry,
  type ToolFailurePayload,
  type CuratorRateLimitService,
} from '@ptah-extension/agent-sdk';
import { MEMORY_TOKENS } from '../di/tokens';
import {
  MemoryCuratorService,
  type CuratorRunStats,
} from '../memory-curator.service';
import {
  ObservationQueueStore,
  type ObservationDraftRow,
} from '../observation-queue.store';
import { deriveWorkspaceFingerprint } from '../workspace-fingerprint';
import { BootScanRunner } from './boot-scan-runner';
import { BootScanFailureLedger } from './boot-scan-failure-ledger';
import { BootScanScheduler } from './boot-scan-scheduler';
import { EpisodeTracker, type EpisodeBuffer } from './episode-tracker';
import {
  MEMORY_TRIGGER_DEFAULTS,
  MEMORY_TRIGGER_KEYS,
  MEMORY_TRIGGER_SECTION,
} from './memory-trigger-config';

const COMMIT_PATTERN = /^\s*git\s+commit(?:\s|$)/;
const RATE_LIMIT_KEY = 'memory.curate';
const MAX_CUE_PATTERN_LENGTH = 200;
const COALESCE_WINDOW_MS = 5000;
/** The curate rate limiter's window, as `CuratorRateLimitService` buckets it. */
const HOUR_MS = 60 * 60 * 1000;
const TOOL_FAILURE_SNIPPET = 140;
/**
 * Consecutive `'failed'` passes per session whose drained observations are
 * kept unprocessed for a retry (TASK_2026_621). The pass after the last retry
 * marks them processed with a warning: a transcript that fails the same way
 * every time must not be re-fed forever. Retries are paced by the triggers
 * themselves (next turn, idle, session end) and the hourly curate limiter.
 */
export const MAX_FAILED_PASS_RETRIES = 3;

type CurateSource =
  | 'idle'
  | 'turn'
  | 'turn-complete'
  | 'episode'
  | 'commit-detect'
  | 'session-end'
  | 'boot'
  | 'user-cue';

type CurateEventKind =
  | 'idle-trigger'
  | 'turn-trigger'
  | 'turn-complete-trigger'
  | 'episode-trigger'
  | 'commit-detect'
  | 'session-end-trigger';

interface SessionState {
  readonly workspaceRoot: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Wall-clock instant `idleTimer` is due to fire, or `null` when no timer is
   * armed. Recorded so `rekeySession` can re-arm under the new key with the
   * REMAINING delay — a `setTimeout` closure captures the id it was armed
   * with, so the timer has to be recreated, and recreating it with the full
   * idle window would silently extend it.
   */
  idleDueAt: number | null;
  turnCount: number;
}

@injectable()
export class MemoryTriggerService {
  private started = false;
  private activityDisposer: (() => void) | null = null;
  private sessionEndDisposer: (() => void) | null = null;
  private userPromptSubmitDisposer: (() => void) | null = null;
  private postToolUseDisposer: (() => void) | null = null;
  private stopDisposer: (() => void) | null = null;
  private toolFailureDisposer: (() => void) | null = null;
  private sessionEndHookDisposer: (() => void) | null = null;
  private sessionStartDisposer: (() => void) | null = null;
  private sessionIdResolvedDisposer: (() => void) | null = null;
  private readonly sessions = new Map<string, SessionState>();
  private readonly episodes = new EpisodeTracker();
  private readonly inFlightCurates = new Set<string>();
  private readonly lastCurateAt = new Map<string, number>();
  /** Consecutive failed passes per session; cleared by a pass that ran. */
  private readonly failedPasses = new Map<string, number>();
  /** End-pass identities follow a rekey until their detached pass settles. */
  private readonly endingSessions = new Map<string, { sessionId: string }>();
  private bootScanController: AbortController | null = null;
  /**
   * The arming gate in front of {@link runBootScan}. Created only on the path
   * that arms a scan; `stop()` cancels whatever it holds. See
   * {@link BootScanScheduler} for why the scan is armed rather than run.
   */
  private bootScanScheduler: BootScanScheduler | null = null;
  private bootScanOwed = false;
  private bootScanArmed = false;
  /** Identifies the armed scan whose completion is allowed to release it. */
  private bootScanGeneration = 0;
  private activeBootScanGeneration: number | null = null;
  private configurationDisposer: { dispose(): void } | null = null;
  /**
   * When the last chat turn was observed, or `null` when none has been in this
   * process. `null` — not `0` — because the boot-scan deferral reads "more
   * recent than the backoff means someone is working"; a fresh process with no
   * activity must not look busy, or the scan would never run on a host the user
   * launched and walked away from. Same reasoning as
   * `ForegroundActivityTracker.msSinceLastActivity` returning `Infinity`.
   */
  private lastActivityAt: number | null = null;
  /**
   * Compiled cue regexes, keyed by the JOINED cue list rather than the array's
   * identity.
   *
   * Identity was wrong by construction: `readUserPromptSubmitCueList` goes
   * through `IWorkspaceProvider.getConfiguration`, which returns a freshly
   * parsed array on a miss, so the cache never hit and every prompt submit
   * recompiled the whole cue list. The separator cannot
   * occur in a settings-file string, so `['ab','c']` and `['a','bc']` cannot
   * collide on one key. (NUL is the separator.)
   */
  private cueCache: {
    key: string;
    compiled: RegExp[];
  } | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(MEMORY_TOKENS.MEMORY_CURATOR)
    private readonly curator: MemoryCuratorService,
    @inject(SDK_TOKENS.SDK_SESSION_ACTIVITY_REGISTRY)
    private readonly activity: SessionActivityRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_END_CALLBACK_REGISTRY)
    private readonly sessionEnd: SessionEndCallbackRegistry,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
    @inject(PLATFORM_TOKENS.FILE_SYSTEM_PROVIDER)
    private readonly fs: IFileSystemProvider,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly sqlite: SqliteConnectionService,
    @inject(SDK_TOKENS.SDK_JSONL_READER)
    private readonly jsonl: JsonlReaderService,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_SUBMIT_CALLBACK_REGISTRY)
    private readonly userPromptSubmitRegistry: UserPromptSubmitCallbackRegistry,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly postToolUseRegistry: PostToolUseCallbackRegistry,
    @inject(SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY)
    private readonly stopRegistry: StopCallbackRegistry,
    @inject(SDK_TOKENS.SDK_TOOL_FAILURE_CALLBACK_REGISTRY)
    private readonly toolFailureRegistry: ToolFailureCallbackRegistry,
    @inject(SDK_TOKENS.SDK_SESSION_END_HOOK_CALLBACK_REGISTRY)
    private readonly sessionEndHookRegistry: SessionEndHookCallbackRegistry,
    @inject(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT)
    private readonly rateLimiter: CuratorRateLimitService,
    @inject(MEMORY_TOKENS.OBSERVATION_QUEUE_STORE)
    private readonly observationQueue: ObservationQueueStore,
    @inject(SDK_TOKENS.SDK_SESSION_START_CALLBACK_REGISTRY)
    private readonly sessionStartRegistry: SessionStartCallbackRegistry,
    @inject(MEMORY_CONTRACT_TOKENS.TRANSCRIPT_READER)
    private readonly transcriptReader: ITranscriptReader,
    @inject(SDK_TOKENS.SDK_SESSION_ID_RESOLVED_CALLBACK_REGISTRY)
    private readonly sessionIdResolvedRegistry: SessionIdResolvedCallbackRegistry,
  ) {}

  start(): void {
    if (this.started) return;
    this.started = true;

    this.activityDisposer = this.activity.register((payload) => {
      this.onActivity(payload);
    });
    this.sessionEndDisposer = this.sessionEnd.register((payload) => {
      this.onSessionEnd(payload);
    });
    this.userPromptSubmitDisposer = this.userPromptSubmitRegistry.register(
      (payload) => {
        this.onUserPromptSubmit(payload);
      },
    );
    this.postToolUseDisposer = this.postToolUseRegistry.register((payload) => {
      this.onPostToolUse(payload);
    });
    this.stopDisposer = this.stopRegistry.register((payload) => {
      this.onStop(payload);
    });
    this.toolFailureDisposer = this.toolFailureRegistry.register((payload) => {
      this.onToolFailure(payload);
    });
    this.sessionEndHookDisposer = this.sessionEndHookRegistry.register(
      (payload) => {
        this.onSessionEndHook(payload);
      },
    );
    this.sessionStartDisposer = this.sessionStartRegistry.register(
      (payload) => {
        this.onSessionStart(payload);
      },
    );
    // Deliberately a synchronous arrow with no `await` anywhere beneath it —
    // see the ordering contract on `rekeySession`.
    this.sessionIdResolvedDisposer = this.sessionIdResolvedRegistry.register(
      (payload) => {
        if (payload.tabId === undefined) return;
        this.rekeySession(payload.tabId, payload.realSessionId);
      },
    );

    this.bootScanOwed = this.readBootScanFlag();
    this.configurationDisposer = this.workspace.onDidChangeConfiguration(
      (event) => {
        if (!event.affectsConfiguration('ptah.memory.enabled')) return;
        if (this.readMemoryEnabled()) {
          this.rearmIdleTimers();
          this.maybeRearmBootScan();
          return;
        }
        this.clearIdleTimers();
        this.cancelBootScan(true);
      },
    );
    this.maybeRearmBootScan();

    this.logger.info('[memory-curator] trigger service started');
  }

  stop(): void {
    if (!this.started) return;
    this.activityDisposer?.();
    this.sessionEndDisposer?.();
    this.userPromptSubmitDisposer?.();
    this.postToolUseDisposer?.();
    this.stopDisposer?.();
    this.toolFailureDisposer?.();
    this.sessionEndHookDisposer?.();
    this.sessionStartDisposer?.();
    this.sessionIdResolvedDisposer?.();
    this.configurationDisposer?.dispose();
    this.activityDisposer = null;
    this.sessionEndDisposer = null;
    this.userPromptSubmitDisposer = null;
    this.postToolUseDisposer = null;
    this.stopDisposer = null;
    this.toolFailureDisposer = null;
    this.sessionEndHookDisposer = null;
    this.sessionStartDisposer = null;
    this.sessionIdResolvedDisposer = null;
    this.configurationDisposer = null;
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
    }
    this.sessions.clear();
    this.episodes.clear();
    this.inFlightCurates.clear();
    this.lastCurateAt.clear();
    this.failedPasses.clear();
    this.clearIdleTimers();
    this.cancelBootScan(false);
    this.bootScanOwed = false;
    this.lastActivityAt = null;
    // Writes are batched now, so a stop with observations still pending would
    // lose them. The store is a shared singleton (`MemorySearchService` reads
    // it too), so flush it rather than dispose it.
    this.observationQueue.flush();
    this.started = false;
    this.logger.info('[memory-curator] trigger service stopped');
  }

  /**
   * Session activity drives the idle timer only. The authoritative
   * "turn complete" signal is the SDK `Stop` hook ({@link onStop}); the
   * legacy activity-based turn counter has been retired in favour of it.
   *
   * The empty-id check is the same one every other handler here makes, and it
   * matters MORE on this path than on the ones that only read: `sessions` is
   * keyed by session id and holds one idle timer per key, so two sessions both
   * reporting `''` share a single slot — the second `onActivity` clears the
   * first's timer, and only one of them is ever curated.
   */
  private onActivity(payload: SessionActivityPayload): void {
    this.maybeRearmBootScan();
    if (!this.readMemoryEnabled()) return;
    this.rearmIdleTimers();
    if (blankToUndefined(payload.sessionId) === undefined) return;

    // Stamped ABOVE the `idleMs` guard, because this is the only foreground
    // signal the boot-scan deferral has and it must not be silenced by an
    // unrelated setting. `idleMs <= 0` disables the per-session idle TIMER; it
    // does not mean the user stopped typing.
    this.lastActivityAt = Date.now();

    const idleMs = this.readIdleMs();
    if (idleMs <= 0) return;

    let state = this.sessions.get(payload.sessionId);
    if (!state) {
      state = {
        workspaceRoot: payload.workspaceRoot,
        idleTimer: null,
        idleDueAt: null,
        turnCount: 0,
      };
      this.sessions.set(payload.sessionId, state);
    }

    if (state.idleTimer) clearTimeout(state.idleTimer);
    state.idleDueAt = Date.now() + idleMs;
    state.idleTimer = setTimeout(() => {
      this.fireIdle(payload.sessionId);
    }, idleMs);
  }

  /**
   * Migrate every piece of state keyed by `fromId` onto `toId`.
   *
   * Fired from the SDK's `SessionIdResolvedCallbackRegistry` when a session's
   * canonical UUID becomes known. Before that instant a residual hook path —
   * one whose payload genuinely lacks `session_id` and falls back to the
   * closure — reports the **tabId**, so state gets armed under the tabId while
   * `SessionEnd` always canonicalises to `realSessionId ?? tabId`
   * (`session-control.service.ts:126`) and arrives under the UUID. That split
   * is what strands an idle timer. TASK_2026_296 item 6, Part B.
   *
   * A tabId is itself a UUID v4, so nothing here inspects an id's SHAPE: both
   * ids are supplied by the adapter and are shape-indistinguishable.
   *
   * ## Three rules, all load-bearing
   *
   * 1. **Synchronous, start to finish.** There is no `await` anywhere in this
   *    method or in anything it calls, so nothing can interleave between
   *    reading the old key and writing the new one. The curate-suppression
   *    state (`inFlightCurates`, `lastCurateAt`, and the curator's own
   *    `inFlight` map) is migrated FIRST, before `sessions` — so at no instant
   *    is a curate un-suppressed under either key.
   * 2. **Refuse-overwrite.** Where `toId` already holds an entry, that entry is
   *    KEPT and the `fromId` entry is discarded, its timer cleared. Never
   *    clobber: a missed merge costs one un-curated episode and is recoverable,
   *    a wrong overwrite destroys a live session's state and is not. Mirrors
   *    `SessionRegistry.bindRealSessionId`'s set-once discipline.
   * 3. **Timers are re-armed, never carried.** A `setTimeout` closure captures
   *    the id it was armed with, so a carried-over timer would fire
   *    `fireIdle(tabId)` against a map that no longer has that key. The timer
   *    is cleared and recreated under `toId` with the REMAINING delay taken
   *    from `idleDueAt`.
   */
  rekeySession(fromId: string, toId: string): void {
    const from = blankToUndefined(fromId);
    const to = blankToUndefined(toId);
    if (from === undefined || to === undefined || from === to) return;

    // 1 — curate suppression first (R-Q3). `inFlightCurates` is a Set, so
    // "keep toId" and "add toId" are the same operation.
    if (this.inFlightCurates.delete(from)) this.inFlightCurates.add(to);
    const lastCurate = this.lastCurateAt.get(from);
    this.lastCurateAt.delete(from);
    if (lastCurate !== undefined && !this.lastCurateAt.has(to)) {
      this.lastCurateAt.set(to, lastCurate);
    }
    const failed = this.failedPasses.get(from);
    this.failedPasses.delete(from);
    if (failed !== undefined && !this.failedPasses.has(to)) {
      this.failedPasses.set(to, failed);
    }
    const ending = this.endingSessions.get(from);
    if (ending) {
      this.endingSessions.delete(from);
      ending.sessionId = to;
      this.endingSessions.set(to, ending);
    }
    this.curator.rekeySession(from, to);

    // 2 — the episode buffer (refuse-overwrite lives in the tracker).
    this.episodes.rekey(from, to);

    // 3 — the idle timer.
    const state = this.sessions.get(from);
    if (state) {
      this.sessions.delete(from);
      if (state.idleTimer) clearTimeout(state.idleTimer);
      if (this.sessions.has(to)) {
        state.idleTimer = null;
        state.idleDueAt = null;
      } else {
        const remaining =
          state.idleDueAt === null ? null : state.idleDueAt - Date.now();
        state.idleTimer =
          remaining === null
            ? null
            : setTimeout(
                () => {
                  this.fireIdle(to);
                },
                Math.max(0, remaining),
              );
        this.sessions.set(to, state);
      }
    }

    // 4 — the durable half. Rows captured under the tabId are un-drainable by
    // the UUID-keyed drain until they are re-pointed.
    this.observationQueue.backfillSessionId(from, to);
  }

  /**
   * In-process session-end signal from `SessionControl.endSession`. Fires
   * reliably even when the SDK `SessionEnd` hook cannot be delivered (the input
   * stream closes on abort before the CLI dispatches it).
   */
  private onSessionEnd(payload: SessionEndPayload): void {
    this.flushSessionEnd(payload.sessionId, payload.workspaceRoot);
  }

  /** Real SDK `Stop` hook — the authoritative "assistant turn complete" signal. */
  private onStop(payload: StopPayload): void {
    if (!this.readMemoryEnabled()) return;
    if (blankToUndefined(payload.sessionId) === undefined) return;
    this.observationQueue.enqueue({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'assistant-turn',
      assistantMessage: payload.lastAssistantMessage ?? null,
    });
    const turnCount = this.episodes.recordTurn(
      payload.sessionId,
      payload.lastAssistantMessage,
    );
    if (!this.readTurnCompleteEnabled()) return;
    if (payload.hasBackgroundWork) return;
    const threshold = this.readTurnThreshold();
    if (threshold > 0 && turnCount >= threshold) {
      this.dispatchEpisodeCurate(
        payload.sessionId,
        payload.workspaceRoot,
        'turn-complete',
        'turn-complete-trigger',
      );
    }
  }

  /** Real SDK `PostToolUseFailure` hook — buffer the failure for episode context. */
  private onToolFailure(payload: ToolFailurePayload): void {
    if (!this.readMemoryEnabled()) return;
    if (blankToUndefined(payload.sessionId) === undefined) return;
    if (payload.isInterrupt) return;
    this.observationQueue.enqueue({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'tool-failure',
      toolName: payload.toolName,
      toolResponseText: payload.error,
    });
    this.episodes.recordFailure(
      payload.sessionId,
      payload.toolName,
      payload.error,
    );
    this.curator.pushEvent({
      kind: 'tool-failure',
      timestamp: payload.timestamp,
      sessionId: payload.sessionId,
      stats: {
        tool: payload.toolName,
        error: snippetOneLine(payload.error, TOOL_FAILURE_SNIPPET),
      },
    });
  }

  /** Real SDK `SessionEnd` hook — flush whatever the episode buffer holds. */
  private onSessionEndHook(payload: SessionEndHookPayload): void {
    this.flushSessionEnd(payload.sessionId, payload.workspaceRoot);
  }

  /**
   * Curate the buffered episode (when enabled), reset the buffer, and tear down
   * idle state. Reached from both the SDK `SessionEnd` hook and the in-process
   * registry; idempotent because `tryEpisodeCurate` coalesces and no-ops on an
   * already-flushed buffer, so a double-fire is harmless.
   */
  private flushSessionEnd(sessionId: string, workspaceRoot: string): void {
    if (blankToUndefined(sessionId) === undefined) return;
    // Deliberately NOT gated on `readMemoryEnabled()` as a whole: the teardown
    // below must still run for state armed while memory was enabled. Only the
    // curate is gated.
    if (this.readMemoryEnabled() && this.readSessionEndEnabled()) {
      const ending = { sessionId };
      const pass = this.tryEpisodeCurate(
        sessionId,
        workspaceRoot,
        'session-end',
        'session-end-trigger',
        ending,
      );
      if (pass) {
        void pass.then(
          () => this.clearEndedSessionFailures(sessionId, ending),
          () => this.clearEndedSessionFailures(sessionId, ending),
        );
      }
    }
    this.episodes.reset(sessionId);
    const state = this.sessions.get(sessionId);
    if (state?.idleTimer) clearTimeout(state.idleTimer);
    this.sessions.delete(sessionId);
    this.curator.forgetSession(sessionId);
  }

  private onUserPromptSubmit(payload: UserPromptSubmitPayload): void {
    if (!this.readMemoryEnabled()) return;
    if (blankToUndefined(payload.sessionId) !== undefined) {
      this.observationQueue.enqueue({
        sessionId: payload.sessionId,
        workspaceRoot: payload.workspaceRoot,
        kind: 'user-prompt',
        userPrompt: payload.prompt,
      });
    }
    if (!this.readUserPromptSubmitEnabled()) return;
    if (blankToUndefined(payload.sessionId) === undefined) {
      this.logger.warn(
        '[memory-curator] empty sessionId in onUserPromptSubmit, skipping',
        { workspaceRoot: payload.workspaceRoot },
      );
      return;
    }
    const minLength = this.readUserPromptSubmitMinPromptLength();
    if (payload.prompt.length < minLength) return;

    const source = this.readUserPromptSubmitCueList();
    const compiled = this.getCompiledCues(source);
    let matchedCue: string | null = null;
    for (let i = 0; i < compiled.length; i++) {
      if (compiled[i].test(payload.prompt)) {
        matchedCue = source[i] ?? null;
        break;
      }
    }
    if (!matchedCue) return;
    if (this.heldByNetworkBackoff(payload.sessionId, 'user-cue')) return;

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxCuratesPerHour(),
    );
    if (!decision.allowed) {
      this.curator.pushEvent({
        kind: 'rate-limited',
        timestamp: payload.timestamp,
        sessionId: payload.sessionId,
        stats: {
          source: 'user-cue',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return;
    }

    this.curator.pushEvent({
      kind: 'user-cue-trigger',
      timestamp: payload.timestamp,
      sessionId: payload.sessionId,
      stats: { cue: matchedCue },
    });
    void this.invokeCurate(
      payload.sessionId,
      payload.workspaceRoot,
      'user-cue',
    );
  }

  private onPostToolUse(payload: PostToolUsePayload): void {
    // First, before the two `safeStringify` calls below — this is the hottest
    // of the six capture sites (once per tool call per session), and with
    // memory off the serialisation is pure waste.
    if (!this.readMemoryEnabled()) return;
    if (blankToUndefined(payload.sessionId) === undefined) return;
    // Serialised exactly once here; the store owns the byte caps
    // (`OBSERVATION_TOOL_INPUT_MAX_BYTES` / `_TOOL_RESPONSE_MAX_BYTES`) so no
    // second pass over the text happens on the way to SQLite.
    this.observationQueue.enqueue({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'tool-use',
      toolName: payload.toolName,
      toolInputJson: safeStringify(payload.toolInput),
      toolResponseText:
        typeof payload.toolOutput === 'string'
          ? payload.toolOutput
          : safeStringify(payload.toolOutput),
    });

    if (payload.toolName === 'Read') {
      this.observationQueue.enqueue({
        sessionId: payload.sessionId,
        workspaceRoot: payload.workspaceRoot,
        kind: 'file-read',
        filePath: extractFilePath(payload.toolInput),
      });
    }

    if (payload.success) {
      const recovered = this.episodes.recordToolSuccess(
        payload.sessionId,
        payload.toolName,
      );
      if (recovered && this.readEpisodeEnabled()) {
        const snap = this.episodes.snapshot(payload.sessionId);
        if (snap.hasCriticalLearning && snap.turnCount > 0) {
          this.dispatchEpisodeCurate(
            payload.sessionId,
            payload.workspaceRoot,
            'episode',
            'episode-trigger',
          );
        }
        return;
      }
    }

    // Commit detection — a committed work unit closes an episode.
    if (payload.toolName !== 'Bash') return;
    if (!payload.success || payload.exitCode !== 0) return;
    const command = this.extractBashCommand(payload.toolInput);
    if (!command || !COMMIT_PATTERN.test(command)) return;
    if (!this.readPostToolUseEnabled()) return;

    this.observationQueue.enqueue({
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      kind: 'commit',
    });
    this.episodes.recordCommit(payload.sessionId);
    this.dispatchEpisodeCurate(
      payload.sessionId,
      payload.workspaceRoot,
      'commit-detect',
      'commit-detect',
    );
  }

  private onSessionStart(_payload: SessionStartPayload): void {
    this.maybeRearmBootScan();
    if (this.readMemoryEnabled()) this.rearmIdleTimers();
  }

  private extractBashCommand(toolInput: unknown): string | null {
    if (
      typeof toolInput === 'object' &&
      toolInput !== null &&
      'command' in toolInput
    ) {
      const c = (toolInput as { command?: unknown }).command;
      return typeof c === 'string' ? c : null;
    }
    return null;
  }

  private getCompiledCues(source: readonly string[]): RegExp[] {
    const key = source.join('\u0000');
    if (this.cueCache && this.cueCache.key === key) {
      return this.cueCache.compiled;
    }
    const compiled: RegExp[] = [];
    for (const pattern of source) {
      if (pattern.length > MAX_CUE_PATTERN_LENGTH) {
        this.logger.warn('[memory-curator] cue pattern too long, skipping', {
          len: pattern.length,
        });
        compiled.push(/(?!x)x/);
        continue;
      }
      try {
        compiled.push(new RegExp(pattern, 'i'));
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn('[memory-curator] invalid cue regex, skipping', {
          pattern,
          error: message,
        });
        compiled.push(/(?!x)x/);
      }
    }
    this.cueCache = { key, compiled };
    return compiled;
  }

  private fireIdle(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.idleTimer = null;
    state.idleDueAt = null;
    this.dispatchEpisodeCurate(
      sessionId,
      state.workspaceRoot,
      'idle',
      'idle-trigger',
    );
  }

  /**
   * Close the current episode for a session: rate-limit, assemble the buffered
   * transcript, curate with a salience boost, and reset the buffer. When the
   * episode is empty there is nothing to curate. When rate-limited the buffer
   * is preserved so the next boundary can retry.
   */
  private tryEpisodeCurate(
    sessionId: string,
    workspaceRoot: string,
    source: CurateSource,
    eventKind: CurateEventKind,
    ending?: { sessionId: string },
  ): Promise<void> | null {
    if (!this.readMemoryEnabled()) return null;
    if (this.shouldCoalesce(sessionId)) {
      this.logger.debug(
        '[memory-curator] curate trigger coalesced (in-flight or recent)',
        { sessionId, source },
      );
      return null;
    }

    const snap = this.episodes.snapshot(sessionId);
    if (snap.isEmpty) {
      this.episodes.reset(sessionId);
      return null;
    }
    // Before the slot is spent and before the buffer is detached: the episode
    // stays where it is and the next boundary tries again.
    if (this.heldByNetworkBackoff(sessionId, source)) return null;

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxCuratesPerHour(),
    );
    if (!decision.allowed) {
      this.curator.pushEvent({
        kind: 'rate-limited',
        timestamp: Date.now(),
        sessionId,
        stats: {
          source,
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return null;
    }

    const salienceBoost = this.episodes.salienceBoost(sessionId);
    this.curator.pushEvent({
      kind: eventKind,
      timestamp: Date.now(),
      sessionId,
      stats: {
        turns: snap.turnCount,
        failures: snap.failures.length,
        recovered: snap.recoveredTools.length,
        commits: snap.commits,
        critical: snap.hasCriticalLearning,
      },
    });
    const episodeSnap: EpisodeSummaryInput = {
      turnCount: snap.turnCount,
      failures: snap.failures.length,
      recovered: snap.recoveredTools.length,
      commits: snap.commits,
      hasCriticalLearning: snap.hasCriticalLearning,
    };
    // `detach`, not `reset`. Same effect when the pass runs — the buffer is
    // cleared here and the returned handle dropped — but a pass the provider
    // quota gate stalls never consumed this episode, and `invokeCurate` puts it
    // back. The clear still happens BEFORE the curate, so turns arriving during
    // the pass keep landing in a fresh buffer (TASK_2026_306 Batch 10, F1).
    const detached = this.episodes.detach(sessionId);
    this.inFlightCurates.add(sessionId);
    this.lastCurateAt.set(sessionId, Date.now());
    if (ending) this.endingSessions.set(sessionId, ending);
    return this.invokeCurate(
      sessionId,
      workspaceRoot,
      source,
      salienceBoost,
      episodeSnap,
      detached,
    );
  }

  /**
   * Start a background pass from an event callback without letting an
   * unexpected rejection become an unhandled promise rejection. The trigger
   * must remain synchronous: awaiting here would delay the SDK event path.
   */
  private dispatchEpisodeCurate(
    sessionId: string,
    workspaceRoot: string,
    source: CurateSource,
    eventKind: CurateEventKind,
  ): void {
    const pass = this.tryEpisodeCurate(
      sessionId,
      workspaceRoot,
      source,
      eventKind,
    );
    if (!pass) return;
    void pass.catch((error: unknown): void => {
      this.logger.error('[memory-curator] asynchronous curate trigger failed', {
        sessionId,
        source,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }

  private clearEndedSessionFailures(
    sessionId: string,
    ending: { sessionId: string },
  ): void {
    this.failedPasses.delete(sessionId);
    this.failedPasses.delete(ending.sessionId);
    if (this.endingSessions.get(ending.sessionId) === ending) {
      this.endingSessions.delete(ending.sessionId);
    }
  }

  /**
   * Whether the curator's network back-off would defer a background pass right
   * now. Checked BEFORE `tryAcquire` on every trigger path (TASK_2026_437 C14
   * f): a deferred pass makes no upstream call, so spending one of
   * `maxCuratesPerHour` on it would starve real curation for the rest of the
   * hour once the provider is back. A window that opens between this check
   * and dispatch (a pass queued behind the one that failed) is covered by the
   * refund on a `network-backoff` deferral instead.
   */
  private heldByNetworkBackoff(sessionId: string, source: string): boolean {
    const remainingMs = this.curator.networkDeferralMs();
    if (remainingMs <= 0) return false;
    this.logger.debug(
      '[memory-curator] curate trigger held by the network back-off; no hourly slot spent',
      { sessionId, source, remainingMs },
    );
    return true;
  }

  /**
   * Curate slots left in the current hourly window; `Infinity` when the limit
   * is off (`maxCuratesPerHour <= 0`, which `tryAcquire` treats as allow-all).
   */
  private curateSlotsLeft(): number {
    const limit = this.readMaxCuratesPerHour();
    if (!Number.isFinite(limit) || limit <= 0) return Number.POSITIVE_INFINITY;
    const snap = this.rateLimiter.snapshot(RATE_LIMIT_KEY);
    const windowStart = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
    const used = snap?.windowStartMs === windowStart ? snap.count : 0;
    return Math.max(0, limit - used);
  }

  /** Give back the hourly slot of a pass the network back-off deferred at dispatch. */
  private refundIfNetworkDeferred(stats: CuratorRunStats): void {
    if (stats.deferral === 'network-backoff') {
      this.rateLimiter.refund(RATE_LIMIT_KEY);
    }
  }

  private shouldCoalesce(sessionId: string): boolean {
    if (this.inFlightCurates.has(sessionId)) return true;
    const last = this.lastCurateAt.get(sessionId);
    if (last === undefined) return false;
    return Date.now() - last < COALESCE_WINDOW_MS;
  }

  /**
   * Compose the transcript, run the curator, and advance the state the pass
   * consumed — but only if it consumed anything.
   *
   * ## The three pieces of state, enumerated (TASK_2026_306 Batch 10, F1)
   *
   * F1 happened because only the first of these was ever considered.
   *
   *  1. **`observation_queue.processed_at`.** `drainForSession` is a pure
   *     SELECT filtered on `processed_at IS NULL`, so *not* calling
   *     `markProcessed` is the entire mechanism by which the rows survive: they
   *     are still NULL and the next drain returns them.
   *  2. **The episode buffer.** Cleared by `tryEpisodeCurate` before this
   *     method is even entered, so it can only be restored, not deferred —
   *     `detached` is that restore, and it merges rather than overwrites.
   *  3. **The boot-scan watermark.** Not reachable from here; the boot scan
   *     calls `curator.curate` directly. Handled in `runBootScan`, which maps
   *     the same outcome onto `BootScanItemOutcome` so `BootScanRunner` leaves
   *     the watermark where it is.
   *
   * A pass that RAN and found nothing keeps its old behaviour exactly: rows
   * marked, buffer gone. Turning "found nothing" into a retry would be F1
   * inverted — an episode that can never be curated, re-fed forever.
   *
   * A pass that FAILED curated nothing, so its rows and episode are kept like a
   * stall's — but only for {@link MAX_FAILED_PASS_RETRIES} consecutive failures
   * of the session; the next one marks them processed with a warning, for the
   * same never-re-fed-forever reason (TASK_2026_621).
   */
  private async invokeCurate(
    sessionId: string,
    workspaceRoot: string,
    source: CurateSource,
    salienceBoost?: number,
    episodeSnap?: EpisodeSummaryInput,
    detachedEpisode?: EpisodeBuffer | null,
  ): Promise<void> {
    const limit = this.readMaxObservationsPerCurate();
    let jsonlText: string;
    try {
      jsonlText = await this.transcriptReader.read(sessionId, workspaceRoot, {
        tailBytes: TRANSCRIPT_TAIL_BYTES,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn('[memory-curator] transcript read failed', {
        sessionId,
        source,
        error: message,
      });
      jsonlText = '';
    }
    try {
      const drainedRows = this.observationQueue.drainForSession(
        sessionId,
        limit,
      );
      const transcript = composeTranscript(jsonlText, drainedRows, episodeSnap);
      const stats = await this.curator.curate({
        sessionId,
        workspaceRoot,
        transcript,
        salienceBoost,
      });
      if (stats.outcome === 'stalled') {
        this.refundIfNetworkDeferred(stats);
        if (detachedEpisode && source !== 'session-end') {
          this.episodes.reattach(sessionId, detachedEpisode);
        }
        this.logger.info(
          '[memory-curator] curation pass stalled; observations kept for the next pass',
          { sessionId, source, observations: drainedRows.length },
        );
        return;
      }
      if (stats.outcome === 'failed') {
        const failures = (this.failedPasses.get(sessionId) ?? 0) + 1;
        if (failures <= MAX_FAILED_PASS_RETRIES) {
          this.failedPasses.set(sessionId, failures);
          if (detachedEpisode && source !== 'session-end') {
            this.episodes.reattach(sessionId, detachedEpisode);
          }
          this.logger.warn(
            '[memory-curator] curation pass failed; observations kept for a retry',
            {
              sessionId,
              source,
              observations: drainedRows.length,
              failures,
              maxRetries: MAX_FAILED_PASS_RETRIES,
            },
          );
          return;
        }
        this.logger.warn(
          '[memory-curator] curation pass failed after every retry; observations marked processed uncurated',
          {
            sessionId,
            source,
            observations: drainedRows.length,
            failures,
          },
        );
      }
      this.failedPasses.delete(sessionId);
      const ids = drainedRows.map((r) => r.id);
      if (ids.length > 0) this.observationQueue.markProcessed(ids);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.curator.pushEvent({
        kind: 'error',
        timestamp: Date.now(),
        sessionId,
        error: message,
      });
      this.logger.warn('[memory-curator] trigger curate failed', {
        source,
        sessionId,
        error: message,
      });
    } finally {
      this.inFlightCurates.delete(sessionId);
    }
  }

  /**
   * Wire this pipeline's settings keys and log channel onto the shared
   * {@link BootScanScheduler}.
   *
   * The scan is armed rather than run from `start()` because its callback calls
   * `curator.curate` INLINE — one LLM round trip per eligible session, bounded
   * only by a 200 ms throttle and the hourly limiter. Firing that from `start()`
   * put every one of those calls in the first seconds after launch, competing
   * with window creation, the SDK boot and the skill-synthesis drains that ran
   * 122 s and 156 s on the same boot (`tmp/logs/log.log:676,678,1095,1453`).
   * The delay/backoff reasoning lives on the scheduler.
   */
  private createBootScanScheduler(generation: number): BootScanScheduler {
    return new BootScanScheduler({
      logPrefix: '[memory-curator]',
      logger: this.logger,
      workspace: this.workspace,
      section: MEMORY_TRIGGER_SECTION,
      delayMsKey: MEMORY_TRIGGER_KEYS.bootScanDelayMs,
      delayMsDefault: MEMORY_TRIGGER_DEFAULTS.bootScanDelayMs,
      idleBackoffMsKey: MEMORY_TRIGGER_KEYS.bootScanIdleBackoffMs,
      idleBackoffMsDefault: MEMORY_TRIGGER_DEFAULTS.bootScanIdleBackoffMs,
      lastActivityAt: () => this.lastActivityAt,
      run: (signal) => {
        void this.runBootScan(signal, generation);
      },
    });
  }

  private async runBootScan(
    signal: AbortSignal,
    generation: number,
  ): Promise<void> {
    const root = this.workspace.getWorkspaceRoot();
    if (!root) return;
    try {
      const { fp } = await deriveWorkspaceFingerprint(root, this.fs);
      const sessionsDir = await this.jsonl.findSessionsDirectory(root);
      const runner = new BootScanRunner();
      const result = await runner.run({
        pipeline: 'memory',
        workspaceRoot: root,
        workspaceFingerprint: fp,
        sessionsDirectory: sessionsDir,
        sqlite: this.sqlite,
        logger: this.logger,
        signal,
        failures: new BootScanFailureLedger(this.sqlite, this.logger),
        // A ledger retry may spend a slot only if one is still left for the
        // normal scan afterwards (TASK_2026_621).
        retryAllowed: () => this.curateSlotsLeft() >= 2,
        run: async (scanSessionId, scanWorkspaceRoot, runSignal) => {
          if (!this.readMemoryEnabled()) {
            this.bootScanOwed = true;
            return 'stalled';
          }
          // The boot scan draws from the SAME hourly budget as the cue path
          // (`onUserPromptSubmit`) and the episode path (`tryEpisodeCurate`).
          // It did not until TASK_2026_319: this callback calls
          // `curator.curate` directly, and `curate` holds no limiter of its own
          // — its only internal gate is the provider QUOTA gate — so
          // `maxCuratesPerHour` simply did not apply here. A cold boot could
          // issue one LLM call per session with nothing but a 200 ms throttle
          // in the way.
          //
          // Refusal returns `'stalled'`, never `'ran'`, and that is the whole
          // point: `BootScanRunner` stops the scan, leaves the watermark below
          // this session, and the next boot retries it. `'ran'` would record a
          // session that was never read and lose it at the next
          // `mtime > watermark` filter.
          //
          // The SKILLS boot scan deliberately does not do this. Its callback
          // enqueues a local SQLite row and spends nothing upstream, so
          // charging it to the curate budget would starve real curation to pay
          // for free work — see `skill-trigger.service.ts`'s `runBootScan`.
          // The network back-off would defer this pass: stop the scan with
          // the watermark in place and spend no slot (C14 f).
          if (this.heldByNetworkBackoff(scanSessionId, 'boot')) {
            return 'stalled';
          }
          const decision = this.rateLimiter.tryAcquire(
            RATE_LIMIT_KEY,
            this.readMaxCuratesPerHour(),
          );
          if (!decision.allowed) {
            this.curator.pushEvent({
              kind: 'rate-limited',
              timestamp: Date.now(),
              sessionId: scanSessionId,
              stats: {
                source: 'boot',
                limit: decision.limit,
                resetAt: decision.resetAt,
                usedThisWindow: decision.usedThisWindow,
              },
            });
            return 'stalled';
          }

          let transcript = '';
          try {
            // `tailBytes` is not optional here, whatever the parameter's
            // optionality suggests. Omitting it read and formatted the WHOLE
            // session file, and this callback also skips `composeTranscript` —
            // the only other clamp on this path — so a 268-turn session became
            // the 170 655-character prompt at `tmp/logs/log.log:1017`. The
            // window matches the live trigger path (`invokeCurate`) exactly;
            // `MemoryCuratorService` clamps the FORMATTED result to
            // `CURATOR_TRANSCRIPT_MAX_CHARS` after this returns, so the two
            // bounds compose the same way they do there.
            transcript = await this.transcriptReader.read(
              scanSessionId,
              scanWorkspaceRoot,
              { tailBytes: TRANSCRIPT_TAIL_BYTES },
            );
          } catch (err: unknown) {
            this.logger.warn(
              '[memory-curator] boot-scan transcript read failed',
              {
                sessionId: scanSessionId,
                error: err instanceof Error ? err.message : String(err),
              },
            );
          }
          const stats = await this.curator.curate({
            sessionId: scanSessionId,
            workspaceRoot: scanWorkspaceRoot,
            transcript,
            signal: runSignal,
          });
          // The watermark's only input. A stalled pass read this session and
          // curated nothing from it, so recording it as scanned would lose it
          // the moment the next boot filters on `mtime > watermark`.
          if (stats.outcome === 'stalled') {
            this.refundIfNetworkDeferred(stats);
            return 'stalled';
          }
          // A failed pass curated nothing either; the runner records it in
          // the failure ledger and retries it on later boots (TASK_2026_621).
          return stats.outcome;
        },
      });
      this.curator.pushEvent({
        kind: 'boot-scan',
        timestamp: Date.now(),
        stats: {
          scanned: result.scanned,
          succeeded: result.succeeded,
          skipped: result.skipped,
          stalled: result.stalled,
          failed: result.failed,
          retried: result.retried,
          recovered: result.recovered,
          givenUp: result.givenUp,
          retriesDeferred: result.retriesDeferred,
        },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.curator.pushEvent({
        kind: 'error',
        timestamp: Date.now(),
        error: message,
      });
      this.logger.warn('[memory-curator] boot-scan failed', { error: message });
    } finally {
      // A cancelled older scan can settle after a resumed scan has armed. Its
      // completion must not release the newer scan's ownership gate.
      if (this.activeBootScanGeneration === generation) {
        this.bootScanArmed = false;
        this.activeBootScanGeneration = null;
        this.bootScanScheduler = null;
        this.bootScanController = null;
      }
    }
  }

  /**
   * The master switch. `ptah.memory.enabled`, default true.
   *
   * Checked FIRST in every hook handler, before any serialisation or SQLite
   * work. Before TASK_2026_323 nothing gated the capture path at all: the six
   * enqueue sites fired on every tool call, every assistant turn and every
   * prompt submit of every session whether or not the user wanted memory, and
   * the per-trigger `*.enabled` flags were all consulted AFTER the write.
   */
  private readMemoryEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.enabled,
      MEMORY_TRIGGER_DEFAULTS.enabled,
    );
    return typeof v === 'boolean' ? v : MEMORY_TRIGGER_DEFAULTS.enabled;
  }

  private clearIdleTimers(): void {
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      state.idleTimer = null;
      state.idleDueAt = null;
    }
  }

  /** Recreate idle boundaries whose buffered episode survived a master pause. */
  private rearmIdleTimers(): void {
    const idleMs = this.readIdleMs();
    if (idleMs <= 0) return;
    for (const [sessionId, state] of this.sessions) {
      if (state.idleTimer || this.episodes.snapshot(sessionId).isEmpty)
        continue;
      state.idleDueAt = Date.now() + idleMs;
      state.idleTimer = setTimeout(() => {
        this.fireIdle(sessionId);
      }, idleMs);
    }
  }

  private cancelBootScan(owed: boolean): void {
    ++this.bootScanGeneration;
    this.bootScanScheduler?.cancel();
    this.bootScanScheduler = null;
    this.bootScanController?.abort();
    this.bootScanController = null;
    this.bootScanArmed = false;
    this.activeBootScanGeneration = null;
    this.bootScanOwed ||= owed;
  }

  private maybeRearmBootScan(): void {
    if (
      !this.started ||
      !this.bootScanOwed ||
      this.bootScanArmed ||
      !this.readMemoryEnabled() ||
      !this.readBootScanFlag()
    )
      return;
    const generation = ++this.bootScanGeneration;
    this.bootScanArmed = true;
    this.activeBootScanGeneration = generation;
    this.bootScanOwed = false;
    this.bootScanController = new AbortController();
    this.bootScanScheduler = this.createBootScanScheduler(generation);
    this.bootScanScheduler.schedule(this.bootScanController.signal);
  }

  private readIdleMs(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.idleMs,
      MEMORY_TRIGGER_DEFAULTS.idleMs,
    );
    return typeof v === 'number' ? v : MEMORY_TRIGGER_DEFAULTS.idleMs;
  }

  private readTurnThreshold(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.turnThreshold,
      MEMORY_TRIGGER_DEFAULTS.turnThreshold,
    );
    return typeof v === 'number' ? v : MEMORY_TRIGGER_DEFAULTS.turnThreshold;
  }

  private readBootScanFlag(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.bootScan,
      MEMORY_TRIGGER_DEFAULTS.bootScan,
    );
    return typeof v === 'boolean' ? v : MEMORY_TRIGGER_DEFAULTS.bootScan;
  }

  private readUserPromptSubmitEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.userPromptSubmit.enabled,
      MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.enabled;
  }

  private readUserPromptSubmitCueList(): readonly string[] {
    const v = this.workspace.getConfiguration<readonly string[]>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.userPromptSubmit.cueList,
      MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList,
    );
    return Array.isArray(v)
      ? v
      : MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.cueList;
  }

  private readUserPromptSubmitMinPromptLength(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.userPromptSubmit.minPromptLength,
      MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength,
    );
    return typeof v === 'number'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.userPromptSubmit.minPromptLength;
  }

  private readPostToolUseEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.postToolUse.enabled,
      MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.postToolUse.enabled;
  }

  private readTurnCompleteEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.turnComplete.enabled,
      MEMORY_TRIGGER_DEFAULTS.turnComplete.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.turnComplete.enabled;
  }

  private readEpisodeEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.episode.enabled,
      MEMORY_TRIGGER_DEFAULTS.episode.enabled,
    );
    return typeof v === 'boolean' ? v : MEMORY_TRIGGER_DEFAULTS.episode.enabled;
  }

  private readSessionEndEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.sessionEnd.enabled,
      MEMORY_TRIGGER_DEFAULTS.sessionEnd.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.sessionEnd.enabled;
  }

  private readMaxCuratesPerHour(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.maxCuratesPerHour,
      MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour,
    );
    return typeof v === 'number'
      ? v
      : MEMORY_TRIGGER_DEFAULTS.maxCuratesPerHour;
  }

  private readMaxObservationsPerCurate(): number {
    const v = this.workspace.getConfiguration<number>(
      MEMORY_TRIGGER_SECTION,
      MEMORY_TRIGGER_KEYS.maxObservationsPerCurate,
      MEMORY_TRIGGER_DEFAULTS.maxObservationsPerCurate,
    );
    return typeof v === 'number' && Number.isFinite(v) && v > 0
      ? Math.floor(v)
      : MEMORY_TRIGGER_DEFAULTS.maxObservationsPerCurate;
  }
}

const MAX_JSONL_BYTES = 32 * 1024;

/**
 * Raw JSONL window read from the END of the transcript. Bounds RAW bytes
 * (uuids, timestamps, usage); `MAX_JSONL_BYTES` bounds the FORMATTED excerpt
 * `composeTranscript` keeps. 16x leaves margin for that ratio.
 */
const TRANSCRIPT_TAIL_BYTES = MAX_JSONL_BYTES * 16; // 512 KB
const TOOL_INPUT_PREVIEW = 1000;
const TOOL_RESPONSE_PREVIEW = 2500;
const ASSISTANT_PREVIEW = 2000;
const USER_PROMPT_PREVIEW = 1000;

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function snippetOneLine(text: string | null | undefined, max: number): string {
  if (!text) return '';
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

function safeStringify(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function extractFilePath(toolInput: unknown): string | null {
  if (typeof toolInput !== 'object' || toolInput === null) return null;
  const input = toolInput as { file_path?: unknown; path?: unknown };
  if (typeof input.file_path === 'string' && input.file_path.length > 0) {
    return input.file_path;
  }
  if (typeof input.path === 'string' && input.path.length > 0) {
    return input.path;
  }
  return null;
}

function formatObservationRow(row: ObservationDraftRow): string {
  switch (row.kind) {
    case 'tool-use':
      return `- [tool] ${row.toolName ?? '?'} input=${truncate(
        row.toolInputJson,
        TOOL_INPUT_PREVIEW,
      )} response=${truncate(row.toolResponseText, TOOL_RESPONSE_PREVIEW)}`;
    case 'tool-failure':
      return `- [failure] ${row.toolName ?? '?'}: ${truncate(
        row.toolResponseText,
        TOOL_RESPONSE_PREVIEW,
      )}`;
    case 'assistant-turn':
      return `- [assistant] ${truncate(row.assistantMessage, ASSISTANT_PREVIEW)}`;
    case 'user-prompt':
      return `- [user] ${truncate(row.userPrompt, USER_PROMPT_PREVIEW)}`;
    case 'file-read':
      return `- [read] ${row.filePath ?? '?'}`;
    case 'commit':
      return '- [commit]';
    default:
      return `- [${row.kind as string}]`;
  }
}

interface EpisodeSummaryInput {
  readonly turnCount: number;
  readonly failures: number;
  readonly recovered: number;
  readonly commits: number;
  readonly hasCriticalLearning: boolean;
}

function composeTranscript(
  jsonlText: string,
  rows: readonly ObservationDraftRow[],
  snap: EpisodeSummaryInput | undefined,
): string {
  const sections: string[] = [];
  if (jsonlText && jsonlText.length > 0) {
    const trimmed =
      jsonlText.length > MAX_JSONL_BYTES
        ? jsonlText.slice(jsonlText.length - MAX_JSONL_BYTES)
        : jsonlText;
    sections.push(`# Session JSONL excerpt\n\n${trimmed}`);
  }
  if (rows.length > 0) {
    const bullets = rows.map(formatObservationRow).join('\n');
    sections.push(`# Structured observations from hooks\n\n${bullets}`);
  }
  if (snap && (snap.turnCount > 0 || snap.commits > 0 || snap.failures > 0)) {
    sections.push(
      `# Episode summary\n\nturns=${snap.turnCount} failures=${snap.failures} recovered=${snap.recovered} commits=${snap.commits} critical=${snap.hasCriticalLearning}`,
    );
  }
  return sections.join('\n\n');
}
