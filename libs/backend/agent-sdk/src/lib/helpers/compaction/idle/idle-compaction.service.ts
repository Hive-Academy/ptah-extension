import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  EMPTY,
  Subject,
  Subscription,
  defer,
  from,
  merge,
  timer,
  type Observable,
} from 'rxjs';
import {
  catchError,
  distinctUntilChanged,
  exhaustMap,
  filter,
  finalize,
  groupBy,
  ignoreElements,
  map,
  mergeMap,
  scan,
  share,
  switchMap,
  tap,
} from 'rxjs/operators';
import { SessionAdmissionRefusedError } from '../../../errors/session-admission-refused.error';
import type { CompactionCallbackRegistry } from '../../compaction-callback-registry';
import type { CompactionConfigProvider } from '../../compaction-config-provider';
import type { SdkAdapterEvents } from '../../sdk-adapter-events.service';
import type { SessionTurnStateRegistry } from '../../session-turn-state.registry';
import type { CompactionCoordinator } from '../compaction-coordinator';
import { evaluateFireGate } from './idle-fire-gate';
import {
  IdleSendVetoedError,
  initialState,
  readIdleSettings,
  resolveIdleSignal,
  sameTimer,
  type KeyedSignal,
} from './idle-compaction.helpers';
import { reduceIdleSession } from './idle-session.reducer';
import { createUnrefScheduler } from './unref-scheduler';
import type {
  IdleAttempt,
  IdleBoundaryNotice,
  IdleCompactSender,
  IdleCompactionSignals,
  IdleCompactionTiming,
  IdleEffect,
  IdleRateLimitStatus,
  IdleSessionState,
  IdleSignal,
  IdleSkipReason,
  IdleStep,
  LastRequestSnapshot,
} from './idle-compaction.types';

/** Multi-session idle compaction orchestrator. All producer calls are synchronous and safe. */
export class IdleCompactionService implements IdleCompactionSignals {
  private readonly signals$ = new Subject<KeyedSignal>();
  private readonly aliases = new Map<string, string>();
  private readonly keys = new Map<string, Set<string>>();
  private readonly currentIds = new Map<string, string>();
  private readonly notices = new Map<string, IdleBoundaryNotice>();
  private readonly queue: IdleSignal[] = [];
  private draining = false;
  private disposed = false;
  private readonly stream: Subscription;
  private readonly disposers: Array<() => void> = [];
  private readonly timing: IdleCompactionTiming;

  constructor(
    private readonly logger: Logger,
    private readonly coordinator: CompactionCoordinator,
    private readonly config: CompactionConfigProvider,
    private readonly turns: SessionTurnStateRegistry,
    private readonly sender: IdleCompactSender,
    callbacks?: CompactionCallbackRegistry | null,
    events?: SdkAdapterEvents | null,
    workspace?: IWorkspaceProvider | null,
    timing?: IdleCompactionTiming,
  ) {
    this.timing = timing ?? {
      scheduler: createUnrefScheduler(),
      now: () => Date.now(),
    };
    this.stream = this.signals$
      .pipe(
        groupBy((item) => item.key, {
          duration: (group) =>
            group.pipe(
              filter((item) => item.signal.type === 'session-released'),
            ),
        }),
        mergeMap((group) => this.sessionPipeline(group.key, group)),
      )
      .subscribe({ error: () => this.warn('pipeline-failed') });
    if (callbacks) {
      this.disposers.push(
        callbacks.register((data) =>
          this.enqueue({ type: 'pre-compact', sessionId: data.sessionId }),
        ),
      );
    }
    if (events) {
      this.disposers.push(
        events.onCompactionComplete((event) =>
          this.enqueue({ type: 'post-compact', sessionId: event.sessionId }),
        ),
      );
    }
    if (workspace) {
      const subscription = workspace.onDidChangeConfiguration((event) => {
        if (
          ![
            'ptah.compaction.enabled',
            'ptah.compaction.idleCompactionEnabled',
            'ptah.compaction.idleCompactionMinTokens',
          ].some((key) => event.affectsConfiguration(key))
        )
          return;
        for (const id of this.currentIds.values()) {
          this.enqueue({ type: 'settings-changed', sessionId: id });
        }
      });
      this.disposers.push(() => subscription.dispose());
    }
  }

  private sessionPipeline(
    key: string,
    group: Observable<KeyedSignal>,
  ): Observable<never> {
    // A released group can still have a pending send when the same key is rebound.
    const ownedAliases = new Set(this.keys.get(key) ?? [key]);
    this.keys.set(key, ownedAliases);
    let latest = initialState(key);
    let pending: Extract<IdleAttempt, { kind: 'pending' }> | null = null;
    let live = true;
    let lastSignalFailed = false;
    const steps$ = group.pipe(
      scan(
        (previous: IdleStep, item: KeyedSignal): IdleStep => {
          try {
            const step = reduceIdleSession(previous.state, item.signal, {
              now: this.timing.now(),
              settings: readIdleSettings(this.config),
            });
            if (item.signal.type !== 'session-released')
              lastSignalFailed = false;
            return step;
          } catch {
            lastSignalFailed = true;
            return {
              signal: item.signal,
              state: previous.state,
              effects: [
                { type: 'log', level: 'warn', reason: 'signal-failed' },
              ],
            };
          }
        },
        {
          signal: {
            type: 'session-bound',
            sessionId: key,
            runToken: '',
            codexProxy: false,
          },
          state: latest,
          effects: [],
        } as IdleStep,
      ),
      tap((step) => {
        latest = step.state;
        if (latest.attempt?.kind === 'pending') pending = latest.attempt;
        this.runEffects(step);
      }),
      share(),
    );
    const timers$ = steps$.pipe(
      map((step) => step.state.timer),
      distinctUntilChanged(sameTimer),
      switchMap((spec) =>
        spec
          ? timer(
              Math.max(0, spec.at - this.timing.now()),
              this.timing.scheduler,
            ).pipe(map(() => spec))
          : EMPTY,
      ),
      tap((spec) =>
        this.enqueue(
          spec.kind === 'due'
            ? {
                type: 'attempt-due',
                sessionId: latest.sessionId,
                attemptId: spec.attemptId,
              }
            : {
                type: 'deadline-elapsed',
                sessionId: latest.sessionId,
                attemptId: spec.attemptId,
                phase: spec.phase,
              },
        ),
      ),
      ignoreElements(),
    );
    const fires$ = steps$.pipe(
      mergeMap((step) =>
        step.effects.filter(
          (effect): effect is Extract<IdleEffect, { type: 'fire' }> =>
            effect.type === 'fire',
        ),
      ),
      exhaustMap((effect) =>
        this.fire(
          effect,
          () => latest,
          () => pending,
          () => live,
        ),
      ),
    );
    return merge(timers$, fires$).pipe(
      catchError(() => {
        this.warn('group-failed', latest.sessionId);
        return EMPTY;
      }),
      finalize(() => {
        live = false;
        if (lastSignalFailed) this.warn('group-failed', latest.sessionId);
        const attempt = latest.attempt;
        if (attempt?.kind === 'in-flight') {
          this.coordinator.releaseIdleClaim(latest.sessionId, attempt.claimId);
        }
        this.clearGroup(key, ownedAliases);
      }),
    );
  }

  private clearGroup(key: string, ownedAliases: Set<string>): void {
    if (this.keys.get(key) !== ownedAliases) return;
    for (const alias of ownedAliases) {
      this.aliases.delete(alias);
      this.notices.delete(alias);
    }
    this.keys.delete(key);
    this.currentIds.delete(key);
  }

  private runEffects(step: IdleStep): void {
    for (const effect of step.effects) {
      try {
        switch (effect.type) {
          case 'log':
            this.logger[effect.level]('[IdleCompactionService] transition', {
              sessionId: step.state.sessionId,
              attemptId: step.state.attempt?.attemptId,
              reason: effect.reason,
            });
            break;
          case 'release-claim':
            this.coordinator.releaseIdleClaim(effect.sessionId, effect.claimId);
            break;
          case 'set-notice':
            this.notices.set(effect.noticeKey, { preTokens: effect.preTokens });
            break;
          case 'clear-notice':
            for (const alias of this.keys.get(
              this.aliases.get(step.state.sessionId) ?? step.state.sessionId,
            ) ?? [step.state.sessionId]) {
              this.notices.delete(alias);
            }
            break;
          case 'fire':
            break;
        }
      } catch {
        this.warn('signal-failed', step.state.sessionId);
      }
    }
  }

  private fire(
    effect: Extract<IdleEffect, { type: 'fire' }>,
    state: () => IdleSessionState,
    getPending: () => Extract<IdleAttempt, { kind: 'pending' }> | null,
    isLive: () => boolean,
  ): Observable<never> {
    const current = state();
    const pending = getPending();
    let refusal: IdleSkipReason | null;
    try {
      refusal =
        !pending || pending.attemptId !== effect.attemptId
          ? 'compaction-state'
          : evaluateFireGate(current, pending, {
              now: this.timing.now(),
              settings: {
                idleCompactionEnabled:
                  this.config.getIdleCompactionConfig().enabled,
                autoCompactEnabled: this.config.getConfig().enabled,
                minTokens: this.config.getIdleCompactionConfig().minTokens,
              },
              coordinatorState: (id) => this.coordinator.getState(id),
              coordinatorClaim: (id) => this.coordinator.getIdleClaim(id),
              turnPhase: (id) => this.turns.get(id)?.phase,
            });
    } catch {
      refusal = 'lookup-failed';
    }
    if (refusal) {
      this.enqueue({
        type: 'fire-skipped',
        sessionId: current.sessionId,
        attemptId: effect.attemptId,
        reason: refusal,
      });
      return EMPTY;
    }
    const sessionId = current.sessionId;
    const beforeEnqueue = (): void => {
      const attempt = state().attempt;
      if (
        !isLive() ||
        !this.aliases.has(sessionId) ||
        state().sessionId !== sessionId ||
        attempt?.kind !== 'in-flight' ||
        attempt.phase !== 'sending' ||
        attempt.attemptId !== effect.attemptId
      ) {
        throw new IdleSendVetoedError('compaction-state');
      }
      const claimed = this.coordinator.claimIdle(
        state().sessionId,
        effect.claimId,
      );
      if (claimed !== 'claimed') {
        throw new IdleSendVetoedError(
          claimed === 'manual-reserved'
            ? 'manual-reserved'
            : 'compaction-state',
        );
      }
    };
    return defer(() =>
      from(this.sender.sendIdleCompact(sessionId, beforeEnqueue)),
    ).pipe(
      tap(() =>
        this.enqueue({
          type: 'fire-sent',
          sessionId: state().sessionId,
          attemptId: effect.attemptId,
        }),
      ),
      catchError((error) => {
        const feedbackId = state().sessionId;
        if (error instanceof SessionAdmissionRefusedError) {
          this.enqueue({
            type: 'fire-skipped',
            sessionId: feedbackId,
            attemptId: effect.attemptId,
            reason: 'not-idle-at-send',
          });
        } else if (error instanceof IdleSendVetoedError) {
          this.enqueue({
            type: 'fire-skipped',
            sessionId: feedbackId,
            attemptId: effect.attemptId,
            reason:
              error.reason === 'manual-reserved'
                ? 'manual-compact-reserved'
                : 'compaction-state',
          });
        } else {
          this.enqueue({
            type: 'fire-failed',
            sessionId: feedbackId,
            attemptId: effect.attemptId,
            reason: 'send-failed',
          });
        }
        return EMPTY;
      }),
      ignoreElements(),
    );
  }

  private warn(reason: string, sessionId?: string): void {
    this.logger.warn('[IdleCompactionService] failure', { reason, sessionId });
  }

  /** A trampoline gives producers, timers and send feedback one FIFO order. */
  private enqueue(signal: IdleSignal): void {
    if (this.disposed) return;
    this.queue.push(signal);
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        try {
          const item = resolveIdleSignal(
            next,
            this.aliases,
            this.keys,
            this.currentIds,
          );
          if (item) {
            const ownedAliases = this.keys.get(item.key);
            this.signals$.next(item);
            if (next.type === 'session-released' && ownedAliases) {
              this.clearGroup(item.key, ownedAliases);
            }
          }
        } catch {
          this.warn('signal-failed', next.sessionId);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  sessionBound(sessionId: string, runToken: string, codexProxy: boolean): void {
    this.enqueue({ type: 'session-bound', sessionId, runToken, codexProxy });
  }
  requestStarted(sessionId: string): void {
    this.enqueue({ type: 'request-started', sessionId });
  }
  turnEnded(
    sessionId: string,
    turnId: string,
    lastRequest: LastRequestSnapshot | null,
  ): void {
    this.enqueue({
      type: 'turn-ended',
      sessionId,
      turnId,
      endedAt: this.timing.now(),
      lastRequest,
    });
  }
  turnContext(
    sessionId: string,
    turnId: string,
    totalTokens: number | null,
  ): void {
    this.enqueue({ type: 'turn-context', sessionId, turnId, totalTokens });
  }
  input(sessionId: string): void {
    this.enqueue({ type: 'input', sessionId });
  }
  promptPrefixChanged(sessionId: string): void {
    this.enqueue({ type: 'prompt-prefix-changed', sessionId });
  }
  rateLimit(sessionId: string, status: IdleRateLimitStatus): void {
    this.enqueue({ type: 'rate-limit', sessionId, status });
  }
  compactBoundary(sessionId: string, preTokens: number | null): void {
    this.enqueue({ type: 'compact-boundary', sessionId, preTokens });
  }
  sessionReleased(sessionId: string): void {
    this.enqueue({ type: 'session-released', sessionId });
  }
  rekey(from: string, to: string): void {
    this.enqueue({ type: 'rekey', sessionId: from, toId: to });
  }
  boundaryNoticeFor(sessionId: string): IdleBoundaryNotice | undefined {
    return this.notices.get(sessionId);
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.signals$.complete();
    this.stream.unsubscribe();
    for (const dispose of this.disposers) dispose();
    this.queue.length = 0;
    this.aliases.clear();
    this.keys.clear();
    this.currentIds.clear();
    this.notices.clear();
  }
}
