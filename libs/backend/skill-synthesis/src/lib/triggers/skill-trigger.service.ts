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
  SDK_TOKENS,
  type SessionActivityPayload,
  type SessionActivityRegistry,
  type SessionEndPayload,
  type SessionEndCallbackRegistry,
  type JsonlReaderService,
  type SubagentStopCallbackRegistry,
  type SubagentStopPayload,
  type PostToolUseCallbackRegistry,
  type PostToolUsePayload,
  type CuratorRateLimitService,
  type UserPromptExpansionCallbackRegistry,
  type UserPromptExpansionPayload,
  type StopCallbackRegistry,
  type StopPayload,
  type SessionIdResolvedCallbackRegistry,
} from '@ptah-extension/agent-sdk';
import {
  BootScanRunner,
  BootScanScheduler,
  deriveWorkspaceFingerprint,
} from '@ptah-extension/memory-curator';
import { SKILL_SYNTHESIS_TOKENS } from '../di/tokens';
import { SkillSynthesisService } from '../skill-synthesis.service';
import { SkillInvocationRecorder } from '../skill-invocation-recorder';
import { SpecHarvesterService } from '../spec-harvester.service';
import type {
  SubagentMetricsExtractor,
  ExtractedSubagentRun,
} from '../subagent-metrics-extractor';
import type { SubagentRunMetrics } from '../types';
import {
  SKILL_TRIGGER_DEFAULTS,
  SKILL_TRIGGER_KEYS,
  SKILL_TRIGGER_SECTION,
} from './skill-trigger-config';

const TEST_PATTERN = /\b(npm|pnpm|yarn|jest|vitest|nx)\s+(test|run\s+test)\b/;
const EDIT_TOOL_NAMES = new Set(['Edit', 'Write', 'MultiEdit']);
const EDIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_KEY = 'skill.analyze';
const TURN_COMPLETE_DEBOUNCE_MS = 90 * 1000;

interface SessionState {
  readonly workspaceRoot: string;
  idleTimer: ReturnType<typeof setTimeout> | null;
  /**
   * Wall-clock instant `idleTimer` is due to fire, or `null` when none is
   * armed. Recorded so `rekeySession` can re-arm under the new key with the
   * REMAINING delay: a `setTimeout` closure captures the id it was armed with,
   * so the timer must be recreated, and recreating it with the full window
   * would silently extend it.
   */
  idleDueAt: number | null;
}

interface TurnCompleteState {
  readonly workspaceRoot: string;
  timer: ReturnType<typeof setTimeout> | null;
  /** See {@link SessionState.idleDueAt} — same contract, debounce timer. */
  dueAt: number | null;
}

interface EditTestState {
  readonly workspaceRoot: string;
  editCount: number;
  lastEditAt: number;
  windowStartAt: number;
}

@injectable()
export class SkillTriggerService {
  private started = false;
  private activityDisposer: (() => void) | null = null;
  private sessionEndDisposer: (() => void) | null = null;
  private subagentStopDisposer: (() => void) | null = null;
  private postToolUseDisposer: (() => void) | null = null;
  private userPromptExpansionDisposer: (() => void) | null = null;
  private stopDisposer: (() => void) | null = null;
  private sessionIdResolvedDisposer: (() => void) | null = null;
  private readonly sessions = new Map<string, SessionState>();
  private readonly editTestStates = new Map<string, EditTestState>();
  private readonly turnCompleteStates = new Map<string, TurnCompleteState>();
  private bootScanController: AbortController | null = null;
  /**
   * The arming gate in front of {@link runBootScan}. Created only on the path
   * that arms a scan; `stop()` cancels whatever it holds. See
   * {@link BootScanScheduler} for why the scan is armed rather than run.
   */
  private bootScanScheduler: BootScanScheduler | null = null;
  /**
   * Whether a boot scan is still OWED (TASK_2026_620 B-P, S3). Set when
   * `start()` found the boot-scan flag on but the master switch off, and when
   * a scan stalled on the switch. Cleared only by {@link maybeRearmBootScan}
   * arming one. The resume paths (the config-change event, and the lazy
   * `onActivity` re-arm for an external edit that fires no event) read it, so
   * a pause never advances the watermark past a session it never queued and
   * resume needs no restart.
   */
  private bootScanOwed = false;
  /**
   * Whether {@link bootScanScheduler} is currently holding an armed (not yet
   * spent) scan. The guard that keeps {@link maybeRearmBootScan} from
   * double-arming. Reset when the armed run completes — a mid-scan stall on an
   * EXTERNAL pause fires no event, so nothing would ever clear it otherwise
   * and the owed sessions could never re-arm.
   */
  private bootScanArmed = false;
  /**
   * Which armed scan {@link bootScanArmed} describes (review finding 9).
   * Bumped by {@link maybeRearmBootScan} on every arm, so a pause→resume that
   * arms scan B while a CANCELED scan A is still unwinding leaves A's
   * completion unable to clear B's arm: only the scan whose generation is
   * still current may reset the flag. Without it, A's `finally` would clear
   * B's arm and the flag would lie about a live scan.
   */
  private bootScanGeneration = 0;
  /**
   * Disposer of the `skillSynthesis.enabled` config listener, registered in
   * `start()` and disposed in `stop()`.
   */
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

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_SYNTHESIS_SERVICE)
    private readonly synthesis: SkillSynthesisService,
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
    @inject(SDK_TOKENS.SDK_SUBAGENT_STOP_CALLBACK_REGISTRY)
    private readonly subagentStopRegistry: SubagentStopCallbackRegistry,
    @inject(SDK_TOKENS.SDK_POST_TOOL_USE_CALLBACK_REGISTRY)
    private readonly postToolUseRegistry: PostToolUseCallbackRegistry,
    @inject(SDK_TOKENS.SDK_CURATOR_RATE_LIMIT)
    private readonly rateLimiter: CuratorRateLimitService,
    @inject(SDK_TOKENS.SDK_USER_PROMPT_EXPANSION_REGISTRY)
    private readonly userPromptExpansionRegistry: UserPromptExpansionCallbackRegistry,
    @inject(SKILL_SYNTHESIS_TOKENS.SKILL_INVOCATION_RECORDER)
    private readonly recorder: SkillInvocationRecorder,
    @inject(SDK_TOKENS.SDK_STOP_CALLBACK_REGISTRY)
    private readonly stopRegistry: StopCallbackRegistry,
    @inject(SKILL_SYNTHESIS_TOKENS.SPEC_HARVESTER_SERVICE)
    private readonly harvester: SpecHarvesterService,
    @inject(SKILL_SYNTHESIS_TOKENS.SUBAGENT_METRICS_EXTRACTOR)
    private readonly metricsExtractor: SubagentMetricsExtractor,
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
    this.subagentStopDisposer = this.subagentStopRegistry.register(
      (payload) => {
        this.onSubagentStop(payload);
      },
    );
    this.postToolUseDisposer = this.postToolUseRegistry.register((payload) => {
      this.onPostToolUse(payload);
    });
    this.userPromptExpansionDisposer =
      this.userPromptExpansionRegistry.register((payload) => {
        this.onUserPromptExpansion(payload);
      });
    this.stopDisposer = this.stopRegistry.register((payload) => {
      this.onStop(payload);
    });
    // Deliberately a synchronous arrow with no `await` anywhere beneath it —
    // see the ordering contract on `rekeySession`.
    this.sessionIdResolvedDisposer = this.sessionIdResolvedRegistry.register(
      (payload) => {
        if (payload.tabId === undefined) return;
        this.rekeySession(payload.tabId, payload.realSessionId);
      },
    );

    // The boot scan is owed whenever its OWN flag is on, and armed only when
    // the master switch is on too (TASK_2026_620 B-P, S3). A host that booted
    // paused keeps the debt; the resume paths below arm it.
    this.bootScanOwed = this.readBootScanFlag();
    this.configurationDisposer = this.workspace.onDidChangeConfiguration(
      (event) => {
        if (!event.affectsConfiguration('ptah.skillSynthesis.enabled')) return;
        if (this.readMasterEnabled()) {
          this.maybeRearmBootScan();
          return;
        }
        // Pause: drop the armed (not yet spent) scan — it stays owed, and the
        // resume paths re-arm it. The per-session idle/turn-complete timers are
        // deliberately NOT cleared here: their work is `enqueueAnalyze`, which
        // re-reads the switch live and no-ops while paused.
        this.cancelBootScan(true);
      },
    );
    this.maybeRearmBootScan();

    this.logger.info('[skill-synthesis] trigger service started');
  }

  stop(): void {
    if (!this.started) return;
    this.activityDisposer?.();
    this.sessionEndDisposer?.();
    this.subagentStopDisposer?.();
    this.postToolUseDisposer?.();
    this.userPromptExpansionDisposer?.();
    this.stopDisposer?.();
    this.sessionIdResolvedDisposer?.();
    this.activityDisposer = null;
    this.sessionEndDisposer = null;
    this.subagentStopDisposer = null;
    this.postToolUseDisposer = null;
    this.userPromptExpansionDisposer = null;
    this.stopDisposer = null;
    this.sessionIdResolvedDisposer = null;
    for (const state of this.sessions.values()) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
    }
    for (const state of this.turnCompleteStates.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.sessions.clear();
    this.editTestStates.clear();
    this.turnCompleteStates.clear();
    this.configurationDisposer?.dispose();
    this.configurationDisposer = null;
    this.cancelBootScan(false);
    this.bootScanOwed = false;
    this.lastActivityAt = null;
    this.started = false;
    this.logger.info('[skill-synthesis] trigger service stopped');
  }

  /**
   * Arm the idle timer for a session.
   *
   * The empty-id check matches `onStop` and `onPostToolUse`, and this path is
   * where it bites hardest: `sessions` is keyed by session id and holds ONE
   * idle timer per key, so two sessions both reporting `''` share a single
   * slot — the second call clears the first's timer, and only one of the two is
   * ever analysed.
   */
  private onActivity(payload: SessionActivityPayload): void {
    // The lazy resume path for the boot scan (B-P, S3). First statement: an
    // external edit of `~/.ptah/settings.json` that flips the switch back on
    // fires no config event, so the next chat activity is the only signal
    // left that can re-arm an owed scan.
    this.maybeRearmBootScan();
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
   * closure — reports the **tabId**, while `SessionEnd` always canonicalises to
   * `realSessionId ?? tabId` (`session-control.service.ts:126`) and arrives
   * under the UUID. That split leaves both timers here orphaned: nothing ever
   * clears them, and when they fire they analyze under an id whose transcript
   * cannot be read. TASK_2026_296 item 6, Part B.
   *
   * A tabId is itself a UUID v4, so nothing here inspects an id's SHAPE.
   *
   * ## Three rules, all load-bearing
   *
   * 1. **Synchronous, start to finish.** No `await` here or in anything it
   *    calls, including `SkillSynthesisService.rekeySession` and the queue
   *    backfill — so nothing interleaves between reading the old key and
   *    writing the new one. The suppression-bearing state (the turn-count
   *    high-water mark in `analyzedSessions`, and the durable
   *    `UNIQUE(session_id, stage)` rows behind it) is migrated FIRST.
   * 2. **Refuse-overwrite.** Where `toId` already holds an entry, that entry is
   *    KEPT and the `fromId` entry discarded with its timer cleared. Never
   *    clobber; mirrors `SessionRegistry.bindRealSessionId`.
   * 3. **Timers are re-armed, never carried.** A `setTimeout` closure captures
   *    the id it was armed with, so a carried timer would call
   *    `fireIdle(tabId)` / `fireTurnComplete(tabId)` against a map that no
   *    longer has that key — a silent no-op that loses the trigger entirely.
   *    Each is cleared and recreated under `toId` with the REMAINING delay.
   */
  rekeySession(fromId: string, toId: string): void {
    const from = blankToUndefined(fromId);
    const to = blankToUndefined(toId);
    if (from === undefined || to === undefined || from === to) return;

    // 1 — the turn-count high-water mark and the durable queue rows.
    this.synthesis.rekeySession(from, to);

    // 2 — the edit-then-test window (no timer of its own).
    const editState = this.editTestStates.get(from);
    if (editState) {
      this.editTestStates.delete(from);
      if (!this.editTestStates.has(to)) this.editTestStates.set(to, editState);
    }

    // 3 — the idle timer.
    const sessionState = this.sessions.get(from);
    if (sessionState) {
      this.sessions.delete(from);
      if (sessionState.idleTimer) clearTimeout(sessionState.idleTimer);
      if (this.sessions.has(to)) {
        sessionState.idleTimer = null;
        sessionState.idleDueAt = null;
      } else {
        const remaining =
          sessionState.idleDueAt === null
            ? null
            : sessionState.idleDueAt - Date.now();
        sessionState.idleTimer =
          remaining === null
            ? null
            : setTimeout(
                () => {
                  this.fireIdle(to);
                },
                Math.max(0, remaining),
              );
        this.sessions.set(to, sessionState);
      }
    }

    // 4 — the turn-complete debounce timer.
    const turnState = this.turnCompleteStates.get(from);
    if (turnState) {
      this.turnCompleteStates.delete(from);
      if (turnState.timer) clearTimeout(turnState.timer);
      if (this.turnCompleteStates.has(to)) {
        turnState.timer = null;
        turnState.dueAt = null;
      } else {
        const remaining =
          turnState.dueAt === null ? null : turnState.dueAt - Date.now();
        turnState.timer =
          remaining === null
            ? null
            : setTimeout(
                () => {
                  this.fireTurnComplete(to);
                },
                Math.max(0, remaining),
              );
        this.turnCompleteStates.set(to, turnState);
      }
    }
  }

  private onSessionEnd(payload: SessionEndPayload): void {
    const state = this.sessions.get(payload.sessionId);
    if (state) {
      if (state.idleTimer) clearTimeout(state.idleTimer);
      this.sessions.delete(payload.sessionId);
    }
    this.editTestStates.delete(payload.sessionId);
    const turnState = this.turnCompleteStates.get(payload.sessionId);
    if (turnState) {
      if (turnState.timer) clearTimeout(turnState.timer);
      this.turnCompleteStates.delete(payload.sessionId);
    }
  }

  private onStop(payload: StopPayload): void {
    if (!this.readTurnCompleteEnabled()) return;
    if (blankToUndefined(payload.sessionId) === undefined) return;
    if (payload.hasBackgroundWork) return;

    let state = this.turnCompleteStates.get(payload.sessionId);
    if (!state) {
      state = {
        workspaceRoot: payload.workspaceRoot,
        timer: null,
        dueAt: null,
      };
      this.turnCompleteStates.set(payload.sessionId, state);
    }
    if (state.timer) clearTimeout(state.timer);
    state.dueAt = Date.now() + TURN_COMPLETE_DEBOUNCE_MS;
    state.timer = setTimeout(() => {
      this.fireTurnComplete(payload.sessionId);
    }, TURN_COMPLETE_DEBOUNCE_MS);
  }

  private fireTurnComplete(sessionId: string): void {
    const state = this.turnCompleteStates.get(sessionId);
    if (!state) return;
    state.timer = null;
    state.dueAt = null;
    this.turnCompleteStates.delete(sessionId);

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxAnalyzesPerHour(),
    );
    if (!decision.allowed) {
      this.synthesis.pushEvent({
        kind: 'rate-limited',
        timestamp: Date.now(),
        sessionId,
        stats: {
          source: 'turn-complete',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return;
    }

    void this.enqueueAnalyze(sessionId, state.workspaceRoot, 'turn-complete');
    void this.fireHarvest(state.workspaceRoot);
  }

  private async fireHarvest(workspaceRoot: string): Promise<void> {
    // B-P (S4): the spec harvest is background capture, gated by the master
    // switch like every other write. Invocation telemetry (S5) is deliberately
    // NOT gated — pausing usage recording while the user keeps using skills
    // would retire them after `dormantAfterDays` once resumed.
    if (!this.readMasterEnabled()) return;
    try {
      await this.harvester.harvest(workspaceRoot);
    } catch (error: unknown) {
      this.logger.debug('[skill-synthesis] spec harvest failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private onSubagentStop(payload: SubagentStopPayload): void {
    // Record agent-invocation telemetry first, independent of the subagent-stop
    // *analyze* trigger below. A subagent completing IS an agent invocation, and
    // this is the only reliable seam to observe it: a subagent's Task tool-use
    // runs in its own nested SDK session and never surfaces back to the parent
    // session's PostToolUse hook, so onPostToolUse's `Task` branch never fires
    // for agent runs. Without this, every authored agent shows 0 invocations in
    // the Library tab no matter how many times it runs. Keyed on `agentType`
    // (the agent slug); the recorder's slug|session|2s-bucket dedup makes this
    // idempotent if a Task PostToolUse ever does fire for the same run.
    if (
      this.readSkillInvocationTelemetryEnabled() &&
      payload.agentType &&
      payload.subagentSessionId
    ) {
      void this.recordInvocation({
        slug: payload.agentType,
        sessionId: payload.parentSessionId || payload.subagentSessionId,
        workspaceRoot: payload.workspaceRoot,
        succeeded: true,
        invokedAt: payload.timestamp,
        source: 'subagent',
        transcriptPath: payload.transcriptPath,
      });
    }

    if (!this.readSubagentStopEnabled()) return;
    if (blankToUndefined(payload.subagentSessionId) === undefined) {
      this.logger.warn(
        '[skill-synthesis] empty sessionId in onSubagentStop, skipping',
        { workspaceRoot: payload.workspaceRoot },
      );
      return;
    }

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxAnalyzesPerHour(),
    );
    if (!decision.allowed) {
      this.synthesis.pushEvent({
        kind: 'rate-limited',
        timestamp: payload.timestamp,
        sessionId: payload.subagentSessionId,
        stats: {
          source: 'subagent-stop',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      return;
    }

    this.synthesis.pushEvent({
      kind: 'subagent-stop',
      timestamp: payload.timestamp,
      sessionId: payload.subagentSessionId,
    });
    void this.enqueueAnalyze(
      payload.subagentSessionId,
      payload.workspaceRoot,
      'subagent-stop',
      payload.transcriptPath,
    );
  }

  private onPostToolUse(payload: PostToolUsePayload): void {
    if (!this.readPostToolUseEnabled()) return;
    if (blankToUndefined(payload.sessionId) === undefined) {
      this.logger.warn(
        '[skill-synthesis] empty sessionId in onPostToolUse, skipping',
        { workspaceRoot: payload.workspaceRoot },
      );
      return;
    }
    const minEditCount = this.readPostToolUseMinEditCount();
    const now = payload.timestamp;

    if (payload.toolName === 'Skill') {
      if (this.readSkillInvocationTelemetryEnabled()) {
        const slug = this.extractSkillSlug(payload.toolInput);
        if (slug) {
          void this.recordInvocation({
            slug,
            sessionId: payload.sessionId,
            workspaceRoot: payload.workspaceRoot,
            succeeded: payload.success,
            invokedAt: payload.timestamp,
            source: 'tool-use',
          });
        }
      }
      return;
    }

    if (payload.toolName === 'Task') {
      if (this.readSkillInvocationTelemetryEnabled()) {
        const slug = this.extractSubagentType(payload.toolInput);
        if (slug) {
          void this.recordInvocation({
            slug,
            sessionId: payload.sessionId,
            workspaceRoot: payload.workspaceRoot,
            succeeded: payload.success,
            invokedAt: payload.timestamp,
            source: 'subagent',
          });
        }
      }
      return;
    }

    if (EDIT_TOOL_NAMES.has(payload.toolName)) {
      let state = this.editTestStates.get(payload.sessionId);
      if (!state || now - state.windowStartAt > EDIT_WINDOW_MS) {
        state = {
          workspaceRoot: payload.workspaceRoot,
          editCount: 0,
          lastEditAt: now,
          windowStartAt: now,
        };
        this.editTestStates.set(payload.sessionId, state);
      }
      state.editCount++;
      state.lastEditAt = now;
      return;
    }

    if (payload.toolName !== 'Bash') return;
    if (!payload.success || payload.exitCode !== 0) return;
    const cmd = this.extractBashCommand(payload.toolInput);
    if (!cmd || !TEST_PATTERN.test(cmd)) return;

    const state = this.editTestStates.get(payload.sessionId);
    if (!state) return;
    if (now - state.windowStartAt > EDIT_WINDOW_MS) {
      this.editTestStates.delete(payload.sessionId);
      return;
    }
    if (state.editCount < minEditCount) return;

    const decision = this.rateLimiter.tryAcquire(
      RATE_LIMIT_KEY,
      this.readMaxAnalyzesPerHour(),
    );
    if (!decision.allowed) {
      this.synthesis.pushEvent({
        kind: 'rate-limited',
        timestamp: now,
        sessionId: payload.sessionId,
        stats: {
          source: 'edit-then-test',
          limit: decision.limit,
          resetAt: decision.resetAt,
          usedThisWindow: decision.usedThisWindow,
        },
      });
      this.editTestStates.delete(payload.sessionId);
      return;
    }

    this.synthesis.pushEvent({
      kind: 'edit-then-test',
      timestamp: now,
      sessionId: payload.sessionId,
      stats: { editCount: state.editCount },
    });
    void this.enqueueAnalyze(
      payload.sessionId,
      state.workspaceRoot,
      'edit-then-test',
    );
    this.editTestStates.delete(payload.sessionId);
  }

  private onUserPromptExpansion(payload: UserPromptExpansionPayload): void {
    if (!this.readSkillInvocationTelemetryEnabled()) return;
    if (!payload.skillSlug || payload.skillSlug.length === 0) return;
    if (blankToUndefined(payload.sessionId) === undefined) return;
    void this.recordInvocation({
      slug: payload.skillSlug,
      sessionId: payload.sessionId,
      workspaceRoot: payload.workspaceRoot,
      succeeded: true,
      invokedAt: payload.timestamp,
      source: 'prompt-expansion',
    });
  }

  private async recordInvocation(input: {
    slug: string;
    sessionId: string;
    workspaceRoot: string;
    succeeded: boolean;
    invokedAt: number;
    source: 'tool-use' | 'prompt-expansion' | 'subagent';
    /**
     * Subagent transcript path (SubagentStop only). When present, per-invocation
     * metrics + exact task_id are derived here — off the hot path. Extraction
     * failure never aborts the invocation record (metrics stay all-null).
     */
    transcriptPath?: string;
  }): Promise<void> {
    try {
      let contextId: string | null = null;
      try {
        const { fp } = await deriveWorkspaceFingerprint(
          input.workspaceRoot,
          this.fs,
        );
        contextId = fp;
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          '[skill-synthesis] fingerprint failed for skill event',
          { source: input.source, error: message },
        );
      }

      let metrics: SubagentRunMetrics | null = null;
      let taskId: string | null = null;
      if (input.transcriptPath) {
        try {
          const extracted: ExtractedSubagentRun =
            await this.metricsExtractor.extract(input.transcriptPath);
          metrics = extracted.metrics;
          taskId = extracted.taskId;
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          this.logger.warn(
            '[skill-synthesis] subagent metrics extraction failed',
            { source: input.source, error: message },
          );
        }
      }

      this.recorder.recordSkillEvent({
        slug: input.slug,
        sessionId: input.sessionId,
        workspaceRoot: input.workspaceRoot,
        contextId,
        succeeded: input.succeeded,
        invokedAt: input.invokedAt,
        source: input.source,
        metrics,
        taskId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn('[skill-synthesis] recordInvocation failed', {
        source: input.source,
        error: message,
      });
    }
  }

  private extractSkillSlug(toolInput: unknown): string | null {
    if (
      typeof toolInput !== 'object' ||
      toolInput === null ||
      !('command' in toolInput)
    ) {
      return null;
    }
    const command = (toolInput as { command?: unknown }).command;
    if (typeof command !== 'string') return null;
    const first = command.trim().split(/\s+/)[0] ?? '';
    const slug = first.startsWith('/') ? first.slice(1) : first;
    return slug.length > 0 ? slug : null;
  }

  private extractSubagentType(toolInput: unknown): string | null {
    if (
      typeof toolInput !== 'object' ||
      toolInput === null ||
      !('subagent_type' in toolInput)
    ) {
      return null;
    }
    const raw = (toolInput as { subagent_type?: unknown }).subagent_type;
    if (typeof raw !== 'string') return null;
    const slug = raw.trim();
    return slug.length > 0 ? slug : null;
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

  private fireIdle(sessionId: string): void {
    const state = this.sessions.get(sessionId);
    if (!state) return;
    state.idleTimer = null;
    state.idleDueAt = null;
    const timestamp = Date.now();
    this.synthesis.pushEvent({
      kind: 'idle-trigger',
      timestamp,
      sessionId,
    });
    void this.enqueueAnalyze(sessionId, state.workspaceRoot, 'idle');
  }

  /**
   * Every trigger's one exit. It ENQUEUES a `prefilter` row; it never analyzes.
   *
   * Before B0.9 this called `SkillSynthesisService.analyzeSession` inline,
   * which meant Phase 0 had two live pipelines at once: session end went
   * through the queue while idle / subagent-stop / edit-then-test /
   * turn-complete kept spending on the foreground quota exactly as before.
   *
   * `enqueueAnalyze` is the shared entry point rather than a local
   * `queue.enqueue` call for one specific reason: the row's `turn_count` must
   * be the FRESHLY OBSERVED trajectory turn count. `SkillQueueStore.enqueue`
   * re-opens a finished row only `WHERE turn_count < ?`, so enqueuing `0` —
   * which compiles and passes any test that only counts calls — would wedge
   * every finished row permanently. That extraction is pure local JSONL plus
   * regex and costs no tokens, and it lives in one place so it can only be got
   * wrong once.
   */
  private async enqueueAnalyze(
    sessionId: string,
    workspaceRoot: string,
    source:
      'idle' | 'boot' | 'subagent-stop' | 'edit-then-test' | 'turn-complete',
    transcriptPath?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await this.synthesis.enqueueAnalyze(sessionId, workspaceRoot, {
        source,
        transcriptPath,
        signal,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.synthesis.pushEvent({
        kind: 'error',
        timestamp: Date.now(),
        sessionId,
        error: message,
      });
      this.logger.warn('[skill-synthesis] trigger enqueue failed', {
        source,
        sessionId,
        error: message,
      });
    }
  }

  /**
   * Wire this pipeline's settings keys and log channel onto the shared
   * {@link BootScanScheduler}.
   *
   * The scan is armed rather than run from `start()` because `runBootScan`
   * enqueues one `prefilter` row per session newer than the watermark. Each row
   * is cheap, but the WALK is not: `start()` fired it synchronously, so a
   * backlog of ~45 sessions was enqueued in the first seconds after launch and
   * the drain — whose boot-row filter holds those rows for
   * `skillSynthesis.drain.bootDeferralMs` but does not hold the SCAN — competed
   * with window creation and the SDK boot for the main thread. The
   * delay/backoff reasoning lives on the scheduler.
   */
  private createBootScanScheduler(generation: number): BootScanScheduler {
    return new BootScanScheduler({
      logPrefix: '[skill-synthesis]',
      logger: this.logger,
      workspace: this.workspace,
      section: SKILL_TRIGGER_SECTION,
      delayMsKey: SKILL_TRIGGER_KEYS.bootScanDelayMs,
      delayMsDefault: SKILL_TRIGGER_DEFAULTS.bootScanDelayMs,
      idleBackoffMsKey: SKILL_TRIGGER_KEYS.bootScanIdleBackoffMs,
      idleBackoffMsDefault: SKILL_TRIGGER_DEFAULTS.bootScanIdleBackoffMs,
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
    try {
      // Inside the `try` so the `finally` below releases this run's arm when
      // no workspace is open (B-P review N4). Returning before the `try` left
      // `bootScanArmed` set for the current generation, so `maybeRearmBootScan`
      // could never arm a scan again in this process.
      const root = this.workspace.getWorkspaceRoot();
      if (!root) return;
      const { fp } = await deriveWorkspaceFingerprint(root, this.fs);
      const sessionsDir = await this.jsonl.findSessionsDirectory(root);
      const runner = new BootScanRunner();
      const result = await runner.run({
        pipeline: 'skills',
        workspaceRoot: root,
        workspaceFingerprint: fp,
        sessionsDirectory: sessionsDir,
        sqlite: this.sqlite,
        logger: this.logger,
        signal,
        // Enqueue, do not analyze. The boot scan finds every session newer
        // than the watermark at once, so the inline version was the single
        // largest burst of unbudgeted LLM work in the product. Queuing them
        // puts that burst behind the drain's gates and its `maxItemsPerRun`
        // instead of behind a 200 ms sleep. `source: 'boot'` rides the row, so
        // the stage handler still reaches `analyzeSession` with the boot
        // source and its template-only, no-LLM behaviour is preserved.
        //
        // B-P (S3): paused → `'stalled'`, never `'ran'`. The enqueue itself is
        // a local INSERT, but marking a session `'ran'` while the switch is
        // off would advance the watermark past a session that was never
        // queued, and the next boot's `mtime > watermark` filter would lose it
        // permanently. `BootScanRunner` stops the scan and keeps the watermark
        // below the stalled session; the owed flag above re-arms the scan on
        // resume, so the skipped sessions are queued then.
        //
        // For the same reason there is NO rate-limiter call here, and the
        // asymmetry with the memory pipeline is deliberate. TASK_2026_319 put
        // `MemoryTriggerService.runBootScan` behind `maxCuratesPerHour`
        // because it spends a curate per session; making this callback consume
        // that same budget would starve real curation to pay for a SQLite
        // insert. What this row costs is gated later, by the drain's own token
        // budget and tier caps.
        run: async (sessionId, workspaceRoot, runSignal) => {
          if (!this.readMasterEnabled()) {
            this.bootScanOwed = true;
            return 'stalled';
          }
          await this.synthesis.enqueueAnalyze(sessionId, workspaceRoot, {
            source: 'boot',
            signal: runSignal,
          });
          return 'ran';
        },
      });
      this.synthesis.pushEvent({
        kind: 'boot-scan',
        timestamp: Date.now(),
        stats: {
          scanned: result.scanned,
          succeeded: result.succeeded,
          skipped: result.skipped,
          stalled: result.stalled,
        },
      });
      await this.fireHarvest(root);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.synthesis.pushEvent({
        kind: 'error',
        timestamp: Date.now(),
        error: message,
      });
      this.logger.warn('[skill-synthesis] boot-scan failed', {
        error: message,
      });
    } finally {
      // The arm is spent once the run completes, whatever the outcome — but
      // only if THIS run is still the armed one (review finding 9). A pause
      // event cancels a scan whose async body is still unwinding; the resume
      // arms a NEWER scan while that happens, and the older run's `finally`
      // must not clear the newer arm. A mid-scan stall on an EXTERNAL pause
      // fires no config event, so `cancelBootScan` never runs on that path —
      // without the generational check that path (or a stale one) would leave
      // `bootScanArmed` true forever, or clear an arm it does not own.
      if (this.bootScanGeneration === generation) {
        this.bootScanArmed = false;
      }
    }
  }

  private readIdleMs(): number {
    const v = this.workspace.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.idleMs,
      SKILL_TRIGGER_DEFAULTS.idleMs,
    );
    return typeof v === 'number' ? v : SKILL_TRIGGER_DEFAULTS.idleMs;
  }

  private readBootScanFlag(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.bootScan,
      SKILL_TRIGGER_DEFAULTS.bootScan,
    );
    return typeof v === 'boolean' ? v : SKILL_TRIGGER_DEFAULTS.bootScan;
  }

  /**
   * The skills master switch (`skillSynthesis.enabled`, B-P), live per read.
   *
   * Gates the boot scan (arming and the per-session callback) and the spec
   * harvest. It does NOT gate invocation telemetry (S5) — see
   * {@link fireHarvest}.
   */
  private readMasterEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.enabled,
      SKILL_TRIGGER_DEFAULTS.enabled,
    );
    return typeof v === 'boolean' ? v : SKILL_TRIGGER_DEFAULTS.enabled;
  }

  /** Drop an armed or in-flight boot scan. `owed` keeps the debt for a re-arm. */
  private cancelBootScan(owed: boolean): void {
    this.bootScanScheduler?.cancel();
    this.bootScanScheduler = null;
    this.bootScanController?.abort();
    this.bootScanController = null;
    this.bootScanArmed = false;
    this.bootScanOwed ||= owed;
  }

  /**
   * Arm the boot scan when one is owed and every gate allows it: started,
   * owed, not already armed, master switch on, boot-scan flag on.
   *
   * Called from the `skillSynthesis.enabled` config-change event (in-process
   * writes) and lazily from `onActivity` — which runs on every session event —
   * so an external-edit resume re-arms on the next chat activity without a
   * restart.
   */
  private maybeRearmBootScan(): void {
    if (
      !this.started ||
      !this.bootScanOwed ||
      this.bootScanArmed ||
      !this.readMasterEnabled() ||
      !this.readBootScanFlag()
    )
      return;
    this.bootScanArmed = true;
    this.bootScanOwed = false;
    // The generation the armed run carries, so only the CURRENT scan's
    // completion may clear `bootScanArmed` (review finding 9).
    const generation = ++this.bootScanGeneration;
    this.bootScanController = new AbortController();
    this.bootScanScheduler = this.createBootScanScheduler(generation);
    this.bootScanScheduler.schedule(this.bootScanController.signal);
  }

  private readTurnCompleteEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.turnComplete.enabled,
      SKILL_TRIGGER_DEFAULTS.turnComplete.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : SKILL_TRIGGER_DEFAULTS.turnComplete.enabled;
  }

  private readSubagentStopEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.subagentStop.enabled,
      SKILL_TRIGGER_DEFAULTS.subagentStop.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : SKILL_TRIGGER_DEFAULTS.subagentStop.enabled;
  }

  private readPostToolUseEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.postToolUse.enabled,
      SKILL_TRIGGER_DEFAULTS.postToolUse.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : SKILL_TRIGGER_DEFAULTS.postToolUse.enabled;
  }

  private readSkillInvocationTelemetryEnabled(): boolean {
    const v = this.workspace.getConfiguration<boolean>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.skillInvocationTelemetry.enabled,
      SKILL_TRIGGER_DEFAULTS.skillInvocationTelemetry.enabled,
    );
    return typeof v === 'boolean'
      ? v
      : SKILL_TRIGGER_DEFAULTS.skillInvocationTelemetry.enabled;
  }

  private readPostToolUseMinEditCount(): number {
    const v = this.workspace.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.postToolUse.minEditCount,
      SKILL_TRIGGER_DEFAULTS.postToolUse.minEditCount,
    );
    return typeof v === 'number'
      ? v
      : SKILL_TRIGGER_DEFAULTS.postToolUse.minEditCount;
  }

  private readMaxAnalyzesPerHour(): number {
    const v = this.workspace.getConfiguration<number>(
      SKILL_TRIGGER_SECTION,
      SKILL_TRIGGER_KEYS.maxAnalyzesPerHour,
      SKILL_TRIGGER_DEFAULTS.maxAnalyzesPerHour,
    );
    return typeof v === 'number'
      ? v
      : SKILL_TRIGGER_DEFAULTS.maxAnalyzesPerHour;
  }
}
