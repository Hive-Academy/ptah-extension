import { inject, injectable } from 'tsyringe';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SessionVerdictStore } from '../archaeology/session-verdict.store';
import { hasSessionWorkEvidence } from '../eligibility/session-work-evidence';
import { ForegroundActivityTracker } from '../queue/foreground-activity.tracker';
import { SkillQueueStore } from '../queue/skill-queue.store';
import {
  SKILL_DRAIN_DEFAULTS,
  SKILL_DRAIN_KEYS,
  SKILL_DRAIN_SECTION,
} from '../queue/skill-drain.service';
import {
  MIN_ROLE_TURNS_FLOOR,
  TrajectoryExtractor,
} from '../trajectory-extractor';
import { SkillBacklogCleanupStore } from './skill-backlog-cleanup.store';
import {
  SessionTranscriptLocator,
  type SessionTranscriptRunLookup,
} from './session-transcript-locator';
import {
  SKILL_BACKLOG_CLEANUP_VERSION,
  type BacklogCleanupCandidate,
  type BacklogCleanupCounters,
  type BacklogCleanupReport,
  type BacklogCleanupRunCounters,
  type BacklogCleanupRunOptions,
  type BacklogCleanupRunReport,
  type BacklogCleanupState,
  type BacklogCleanupStopReason,
} from './skill-backlog-cleanup.types';

const CANDIDATE_PAGE_SIZE = 100;
const MAX_CANDIDATES_PER_RUN = 200;
const WALL_BUDGET_MS = 60_000;
const INVOCATION_DELETE_PAGE_SIZE = 500;
const REJECT_NO_EVIDENCE = 'backlog-cleanup: no code evidence and no verdict';
const REJECT_UNREADABLE =
  'backlog-cleanup: transcript unreadable and no verdict';
const REJECT_NO_TRANSCRIPT =
  'backlog-cleanup: no transcript found for any session';

interface CleanupConfig {
  enabled: boolean;
  bootDeferralMs: number;
  pauseOnBattery: boolean;
  foregroundBackoffMs: number;
  prefilterMinEdits: number;
  prefilterMinToolUses: number;
}

type CandidateDisposition =
  | 'kept-evidence'
  | 'kept-verdict'
  | 'kept-degraded-verdict'
  | 'kept-root-unknown'
  | 'deferred-error'
  | 'reject-no-evidence'
  | 'reject-unreadable'
  | 'reject-no-transcript';

interface RunProgress {
  state: BacklogCleanupState | null;
  keptRootUnknown: number;
  rejectedNoTranscript: number;
  deferredOnError: number;
}

@injectable()
export class SkillBacklogCleanupService {
  private readonly startedAt = Date.now();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    private readonly store: SkillBacklogCleanupStore,
    private readonly verdicts: SessionVerdictStore,
    private readonly queue: SkillQueueStore,
    private readonly extractor: TrajectoryExtractor,
    private readonly transcriptLocator: SessionTranscriptLocator,
    private readonly foreground: ForegroundActivityTracker,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspace: IWorkspaceProvider,
  ) {}

  async run(options: BacklogCleanupRunOptions): Promise<BacklogCleanupReport> {
    const now = options.now ?? Date.now;
    const runStartedAt = now();
    const progress: RunProgress = {
      state: null,
      keptRootUnknown: 0,
      rejectedNoTranscript: 0,
      deferredOnError: 0,
    };
    try {
      const config = this.readConfig();
      if (!config.enabled) return { status: 'skipped', reason: 'disabled' };

      let state = this.store.readState();
      progress.state = state;
      if (
        state?.version === SKILL_BACKLOG_CLEANUP_VERSION &&
        state.finishedAt !== null
      ) {
        return { status: 'skipped', reason: 'complete' };
      }
      if (
        config.bootDeferralMs > 0 &&
        runStartedAt - this.startedAt < config.bootDeferralMs
      ) {
        return { status: 'skipped', reason: 'boot-deferred' };
      }
      if (config.pauseOnBattery && options.isOnBattery()) {
        return { status: 'skipped', reason: 'on-battery' };
      }
      this.foreground.start();
      if (
        config.foregroundBackoffMs > 0 &&
        this.foreground.msSinceLastActivity(runStartedAt) <
          config.foregroundBackoffMs
      ) {
        return { status: 'skipped', reason: 'foreground-active' };
      }
      if (options.signal.aborted) {
        return { status: 'skipped', reason: 'aborted' };
      }

      if (!state || state.version !== SKILL_BACKLOG_CLEANUP_VERSION) {
        state = this.store.initialize(
          SKILL_BACKLOG_CLEANUP_VERSION,
          runStartedAt,
        );
        progress.state = state;
      }
      return await this.execute(
        options,
        config,
        state,
        now,
        runStartedAt,
        progress,
      );
    } catch (error: unknown) {
      // degradation-audit: reported - the cleanup reports a failed outcome and
      // logs a sanitized diagnostic instead of rejecting its cron invocation.
      const message = this.errorText(error);
      this.logger.warn('[skill-synthesis] backlog cleanup failed', {
        error: message,
      });
      return {
        status: 'failed',
        reason: 'unexpected-error',
        ...this.runCounters(progress),
        durationMs: Math.max(0, now() - runStartedAt),
        error: message,
      };
    }
  }

  private async execute(
    options: BacklogCleanupRunOptions,
    config: CleanupConfig,
    initial: BacklogCleanupState,
    now: () => number,
    runStartedAt: number,
    progress: RunProgress,
  ): Promise<BacklogCleanupRunReport> {
    let state = initial;
    let examinedThisRun = 0;
    const transcriptLookup = this.transcriptLocator.createRunLookup();

    try {
      while (examinedThisRun < MAX_CANDIDATES_PER_RUN) {
        const stop = this.stopReason(options.signal, now, runStartedAt);
        if (stop) {
          return this.finishPartial(state, stop, now, runStartedAt, progress);
        }

        const page = this.store.pageCandidates(
          state.cutoffCreatedAt,
          state.cursorCreatedAt,
          state.cursorId,
          Math.min(
            CANDIDATE_PAGE_SIZE,
            MAX_CANDIDATES_PER_RUN - examinedThisRun,
          ),
        );
        if (page.length === 0) {
          return this.deleteInvocationsAndComplete(
            state,
            options.signal,
            now,
            runStartedAt,
            progress,
          );
        }

        const rejections: Array<{ id: string; reason: string }> = [];
        const increments = this.emptyCounters();
        let processed = 0;
        for (const candidate of page) {
          const betweenCandidates = this.stopReason(
            options.signal,
            now,
            runStartedAt,
          );
          if (betweenCandidates) break;
          let disposition: CandidateDisposition;
          try {
            disposition = await this.evaluateCandidate(
              candidate,
              config,
              transcriptLookup,
            );
          } catch (error: unknown) {
            // degradation-audit: reported - the candidate is deferred, counted
            // in the run report, and the failure is recorded in this warning.
            disposition = 'deferred-error';
            progress.deferredOnError++;
            this.logger.warn(
              '[skill-synthesis] backlog candidate evaluation failed',
              { candidateId: candidate.id, error: this.errorText(error) },
            );
          }
          if (disposition === 'kept-root-unknown') {
            progress.keptRootUnknown++;
          }
          if (disposition === 'reject-no-transcript') {
            progress.rejectedNoTranscript++;
          }
          this.countDisposition(increments, disposition);
          if (disposition === 'reject-no-evidence') {
            rejections.push({ id: candidate.id, reason: REJECT_NO_EVIDENCE });
          } else if (disposition === 'reject-unreadable') {
            rejections.push({ id: candidate.id, reason: REJECT_UNREADABLE });
          } else if (disposition === 'reject-no-transcript') {
            rejections.push({ id: candidate.id, reason: REJECT_NO_TRANSCRIPT });
          }
          increments.examined++;
          processed++;
        }

        if (processed === 0) {
          const reason = this.stopReason(options.signal, now, runStartedAt);
          return this.finishPartial(
            state,
            reason ?? 'time-budget',
            now,
            runStartedAt,
            progress,
          );
        }

        this.store.rejectBatch(rejections, now());
        const last = page[processed - 1];
        state = this.store.writeProgress({
          cursorCreatedAt: last.createdAt,
          cursorId: last.id,
          finishedAt: null,
          lastRunAt: now(),
          lastOutcome: 'partial',
          lastReason: null,
          counters: this.addCounters(state, increments),
        });
        progress.state = state;
        examinedThisRun += processed;

        if (processed < page.length) {
          const reason = this.stopReason(options.signal, now, runStartedAt);
          return this.finishPartial(
            state,
            reason ?? 'time-budget',
            now,
            runStartedAt,
            progress,
          );
        }
      }
      return this.finishPartial(
        state,
        'row-budget',
        now,
        runStartedAt,
        progress,
      );
    } finally {
      this.logger.info(
        '[skill-synthesis] backlog transcript lookup',
        transcriptLookup.stats(),
      );
    }
  }

  private async evaluateCandidate(
    candidate: BacklogCleanupCandidate,
    config: CleanupConfig,
    transcriptLookup: SessionTranscriptRunLookup,
  ): Promise<CandidateDisposition> {
    if (candidate.sourceSessionIds.length === 0) {
      this.logger.warn(
        '[skill-synthesis] backlog candidate has no usable source sessions',
        { candidateId: candidate.id },
      );
    }
    for (const sessionId of candidate.sourceSessionIds) {
      const verdict = this.verdicts.findBySession(sessionId);
      if (verdict) {
        return verdict.degradedReason === null
          ? 'kept-verdict'
          : 'kept-degraded-verdict';
      }
    }

    let rootReadable = false;
    let attempted = false;
    for (const sessionId of candidate.sourceSessionIds) {
      const queued = this.queue.findBySessionStage(sessionId, 'prefilter');
      const workspaceRoot = candidate.workspaceRoot
        ? candidate.workspaceRoot
        : queued?.workspaceRoot;
      if (!workspaceRoot) continue;
      attempted = true;
      const trajectory = await this.extractor.extract(
        sessionId,
        workspaceRoot,
        MIN_ROLE_TURNS_FLOOR,
        queued?.transcriptPath ?? undefined,
      );
      if (!trajectory) continue;
      rootReadable = true;
      if (
        hasSessionWorkEvidence(trajectory, {
          prefilterMinEdits: config.prefilterMinEdits,
          prefilterMinToolUses: config.prefilterMinToolUses,
        })
      ) {
        return 'kept-evidence';
      }
    }
    if (attempted) {
      return rootReadable ? 'reject-no-evidence' : 'reject-unreadable';
    }
    if (candidate.sourceSessionIds.length === 0) {
      return 'kept-root-unknown';
    }

    let found = false;
    let lookupReadable = false;
    let unavailable = false;
    for (const sessionId of candidate.sourceSessionIds) {
      const location = await transcriptLookup.locate(sessionId);
      if (location.kind === 'unavailable') {
        unavailable = true;
        continue;
      }
      if (location.kind === 'absent') continue;
      found = true;
      const trajectory = await this.extractor.extract(
        sessionId,
        '',
        MIN_ROLE_TURNS_FLOOR,
        location.path,
      );
      if (!trajectory) continue;
      lookupReadable = true;
      if (
        hasSessionWorkEvidence(trajectory, {
          prefilterMinEdits: config.prefilterMinEdits,
          prefilterMinToolUses: config.prefilterMinToolUses,
        })
      ) {
        return 'kept-evidence';
      }
    }
    if (lookupReadable) return 'reject-no-evidence';
    if (found) return 'reject-unreadable';
    return unavailable ? 'kept-root-unknown' : 'reject-no-transcript';
  }

  private deleteInvocationsAndComplete(
    state: BacklogCleanupState,
    signal: AbortSignal,
    now: () => number,
    runStartedAt: number,
    progress: RunProgress,
  ): BacklogCleanupRunReport {
    for (;;) {
      const stop = this.stopReason(signal, now, runStartedAt);
      if (stop) {
        return this.finishPartial(state, stop, now, runStartedAt, progress);
      }
      const changes = this.store.deleteFakeInvocations(
        INVOCATION_DELETE_PAGE_SIZE,
      );
      if (changes > 0) {
        state = this.store.writeProgress({
          cursorCreatedAt: state.cursorCreatedAt,
          cursorId: state.cursorId,
          finishedAt: null,
          lastRunAt: now(),
          lastOutcome: 'partial',
          lastReason: null,
          counters: this.addCounters(state, {
            ...this.emptyCounters(),
            invocationsDeleted: changes,
          }),
        });
        progress.state = state;
      }
      if (changes < INVOCATION_DELETE_PAGE_SIZE) break;
    }
    const completedAt = now();
    const counters = this.countersFrom(state);
    const completed = this.store.writeProgress({
      cursorCreatedAt: state.cursorCreatedAt,
      cursorId: state.cursorId,
      finishedAt: completedAt,
      lastRunAt: completedAt,
      lastOutcome: 'completed',
      lastReason: null,
      counters,
    });
    progress.state = completed;
    this.logger.info('[skill-synthesis] backlog cleanup complete', counters);
    return {
      status: 'completed',
      reason: null,
      ...this.runCounters(progress, completed),
      durationMs: Math.max(0, completedAt - runStartedAt),
      error: null,
    };
  }

  private finishPartial(
    state: BacklogCleanupState,
    reason: BacklogCleanupStopReason,
    now: () => number,
    runStartedAt: number,
    progress: RunProgress,
  ): BacklogCleanupRunReport {
    const stoppedAt = now();
    const updated = this.store.writeProgress({
      cursorCreatedAt: state.cursorCreatedAt,
      cursorId: state.cursorId,
      finishedAt: null,
      lastRunAt: stoppedAt,
      lastOutcome: 'partial',
      lastReason: reason,
      counters: this.countersFrom(state),
    });
    progress.state = updated;
    return {
      status: 'partial',
      reason,
      ...this.runCounters(progress, updated),
      durationMs: Math.max(0, stoppedAt - runStartedAt),
      error: null,
    };
  }

  private stopReason(
    signal: AbortSignal,
    now: () => number,
    startedAt: number,
  ): BacklogCleanupStopReason | null {
    if (signal.aborted) return 'aborted';
    if (now() - startedAt >= WALL_BUDGET_MS) return 'time-budget';
    return null;
  }

  private countDisposition(
    counters: BacklogCleanupCounters,
    disposition: CandidateDisposition,
  ): void {
    if (disposition === 'kept-evidence') counters.keptEvidence++;
    if (disposition === 'kept-verdict') counters.keptVerdict++;
    if (disposition === 'kept-degraded-verdict') {
      counters.keptDegradedVerdict++;
    }
    if (disposition === 'reject-no-evidence') counters.rejectedNoEvidence++;
    if (
      disposition === 'reject-unreadable' ||
      disposition === 'reject-no-transcript'
    ) {
      counters.rejectedTranscriptUnreadable++;
    }
  }

  private runCounters(
    progress: RunProgress,
    state: BacklogCleanupCounters | null = progress.state,
  ): BacklogCleanupRunCounters {
    return {
      ...(state ? this.countersFrom(state) : this.emptyCounters()),
      keptRootUnknown: progress.keptRootUnknown,
      rejectedNoTranscript: progress.rejectedNoTranscript,
      deferredOnError: progress.deferredOnError,
    };
  }

  private readConfig(): CleanupConfig {
    const get = <T>(key: string, fallback: T): T => {
      const value = this.workspace.getConfiguration<T>(
        SKILL_DRAIN_SECTION,
        key,
        fallback,
      );
      return value === undefined || value === null ? fallback : value;
    };
    return {
      enabled: get(SKILL_DRAIN_KEYS.enabled, SKILL_DRAIN_DEFAULTS.enabled),
      bootDeferralMs: get(
        SKILL_DRAIN_KEYS.bootDeferralMs,
        SKILL_DRAIN_DEFAULTS.bootDeferralMs,
      ),
      pauseOnBattery: get(
        SKILL_DRAIN_KEYS.pauseOnBattery,
        SKILL_DRAIN_DEFAULTS.pauseOnBattery,
      ),
      foregroundBackoffMs: get(
        SKILL_DRAIN_KEYS.foregroundBackoffMs,
        SKILL_DRAIN_DEFAULTS.foregroundBackoffMs,
      ),
      prefilterMinEdits: get('skillSynthesis.prefilterMinEdits', 1),
      prefilterMinToolUses: get('skillSynthesis.prefilterMinToolUses', 2),
    };
  }

  private addCounters(
    base: BacklogCleanupCounters,
    delta: BacklogCleanupCounters,
  ): BacklogCleanupCounters {
    return {
      examined: base.examined + delta.examined,
      keptEvidence: base.keptEvidence + delta.keptEvidence,
      keptVerdict: base.keptVerdict + delta.keptVerdict,
      keptDegradedVerdict: base.keptDegradedVerdict + delta.keptDegradedVerdict,
      rejectedNoEvidence: base.rejectedNoEvidence + delta.rejectedNoEvidence,
      rejectedTranscriptUnreadable:
        base.rejectedTranscriptUnreadable + delta.rejectedTranscriptUnreadable,
      invocationsDeleted: base.invocationsDeleted + delta.invocationsDeleted,
    };
  }

  private countersFrom(state: BacklogCleanupCounters): BacklogCleanupCounters {
    return {
      examined: state.examined,
      keptEvidence: state.keptEvidence,
      keptVerdict: state.keptVerdict,
      keptDegradedVerdict: state.keptDegradedVerdict,
      rejectedNoEvidence: state.rejectedNoEvidence,
      rejectedTranscriptUnreadable: state.rejectedTranscriptUnreadable,
      invocationsDeleted: state.invocationsDeleted,
    };
  }

  private emptyCounters(): BacklogCleanupCounters {
    return {
      examined: 0,
      keptEvidence: 0,
      keptVerdict: 0,
      keptDegradedVerdict: 0,
      rejectedNoEvidence: 0,
      rejectedTranscriptUnreadable: 0,
      invocationsDeleted: 0,
    };
  }

  private errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
