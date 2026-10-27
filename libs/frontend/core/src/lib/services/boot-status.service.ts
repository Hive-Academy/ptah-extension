/**
 * BootStatusService — the renderer's single source of truth for boot progress
 * (TASK_2026_380, component 12).
 *
 * Two inputs, one state:
 *
 *  - **Push** `boot:readinessChanged`, emitted edge-triggered by the Electron
 *    host's `BootCoordinator` on every readiness/phase transition.
 *  - **Pull** `boot:getReadiness`, issued once on construction and then every
 *    {@link DEFAULT_READINESS_RETRY_AFTER_MS} for as long as the state says
 *    `warming`. The pull is mandatory and does NOT duplicate the push: the host
 *    emits at `did-finish-load`, which fires before Angular installs its
 *    `message` listener, so the first transition is routinely lost. A renderer
 *    reload loses every transition.
 *
 * ## Why the re-pull is a watchdog and not a nicety
 *
 * The host's `setPhase` emit is wrapped so a broadcaster failure can never
 * throw into the boot path — which means a transition CAN be dropped, and the
 * message is edge-triggered, so nothing re-sends it. Without the watchdog a
 * single lost `database → harness` push strands the user behind the boot screen
 * forever with no in-app recovery. The loop runs only in Electron, while
 * `warming`, and then for a bounded window while a host boot step is still
 * unsettled (see {@link BootStatusService.hostSteps}); it stops once both are
 * settled.
 *
 * ## Why the initial value is `ready`
 *
 * The same bundle runs in the VS Code webview, where no `boot:readinessChanged`
 * will ever arrive and no `boot:` RPC is registered. A `warming` default would
 * hang that host behind a boot screen forever. Every degrade path here —
 * a failed pull, a malformed push, a host that never pushes — therefore leaves
 * the service reporting `ready`, i.e. never blocking.
 *
 * ## Host boot steps (TASK_2026_721, component 8)
 *
 * {@link BootStatusService.hostSteps} folds the Electron host's three
 * `boot:progress` steps (`verify`, `restore`, `agents`) from two sources: the
 * push, which the host replays on `did-finish-load`, and the `steps` field of
 * the same `boot:getReadiness` pull. The replay has the same race as the
 * readiness push (it can land before this listener exists) and a window
 * replaced after every step finished gets no replay at all, so the pull is the
 * fallback. Both go through one fold that never moves a step backwards, so
 * the order in which they arrive does not matter. A reload replays steps that
 * are long `done`; folding them again is a no-op.
 */

import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  BOOT_PHASE_VALUES,
  BOOT_PROGRESS_STEP_IDS,
  BootProgressPayloadSchema,
  DEFAULT_READINESS_RETRY_AFTER_MS,
  MESSAGE_TYPES,
  isBackendReadiness,
  isBootPhase,
  type BackendReadiness,
  type BootPhase,
  type BootProgressPayload,
  type BootProgressStepId,
  type BootProgressStepState,
  type BootReadinessChangedPayload,
} from '@ptah-extension/shared';

import { ClaudeRpcService } from './claude-rpc.service';
import type { MessageHandler } from './message-router.types';
import { VSCodeService } from './vscode.service';

/** Timeout for the one-shot readiness pull. Short: the answer is in-memory. */
const READINESS_PULL_TIMEOUT_MS = 5000;

/**
 * How long the re-pull keeps running for unsettled host steps once readiness
 * is terminal. Agent adapter initialization is detached and can finish after
 * the boot reports `ready`; a minute covers it without polling for the life of
 * the page when a step never settles.
 */
const HOST_STEP_PULL_WINDOW_MS = 60_000;

/**
 * The phases during which nothing in the shell is usable yet.
 *
 * The boot screen hands over at `harness` — persistence has settled by then, so
 * the shell can paint and the remaining work (harness reconcile, session
 * import, indexing) is watchable from inside it behind per-panel skeletons.
 */
const PRE_SHELL_PHASES: readonly BootPhase[] = ['starting', 'database'];

/** The state a host that never speaks leaves this service in, forever. */
const READY_DEFAULT: BootReadinessChangedPayload = {
  readiness: 'ready',
  phase: 'settled',
  startedAt: Date.now(),
};

/** A host boot step as the renderer shows it: `pending` until it starts. */
export type HostBootStepState = 'pending' | BootProgressStepState;

/** One of the host's three boot steps, folded from `boot:progress`. */
export interface HostBootStep {
  readonly stepId: BootProgressStepId;
  readonly state: HostBootStepState;
  /** Work done so far; present with {@link count} when the step counts. */
  readonly done?: number;
  readonly count?: number;
  /** Set once the step is `done` or `failed`. */
  readonly elapsedMs?: number;
  /** Epoch ms at which the step became active; absent while `pending`. */
  readonly startedAt?: number;
}

/** The fold's starting point: every step known, none started. */
const PENDING_HOST_STEPS: readonly HostBootStep[] = BOOT_PROGRESS_STEP_IDS.map(
  (stepId) => ({ stepId, state: 'pending' }),
);

@Injectable({ providedIn: 'root' })
export class BootStatusService implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.BOOT_READINESS_CHANGED,
    MESSAGE_TYPES.BOOT_PROGRESS,
  ] as const;

  private readonly _status = signal<BootReadinessChangedPayload>(READY_DEFAULT);

  private readonly _hostSteps = signal<readonly HostBootStep[] | null>(null);

  /**
   * The host's three boot steps in order, or `null` until the first valid
   * `boot:progress` arrives (always `null` outside Electron). A step never
   * moves backwards: `done` and `failed` stick, and an `active` update never
   * lowers a step's `done` count.
   */
  readonly hostSteps = this._hostSteps.asReadonly();

  /** The last well-formed snapshot, from either the push or the pull. */
  readonly status = this._status.asReadonly();

  readonly readiness = computed<BackendReadiness>(
    () => this._status().readiness,
  );
  readonly phase = computed<BootPhase>(() => this._status().phase);
  readonly detail = computed<string | undefined>(() => this._status().detail);

  /** True while the host's post-window boot is still running. */
  readonly isBooting = computed<boolean>(
    () => this._status().readiness === 'warming',
  );

  /** True when the boot rejected — routed to the app's error branch. */
  readonly hasFailed = computed<boolean>(
    () => this._status().readiness === 'failed',
  );

  /**
   * True only while the shell has nothing to paint. This, not
   * {@link isBooting}, gates the boot screen: everything from `harness` on is
   * background work the user can watch from inside the shell.
   */
  readonly isBlockingBoot = computed<boolean>(
    () =>
      this._status().readiness === 'warming' &&
      PRE_SHELL_PHASES.includes(this._status().phase),
  );

  /** Milliseconds since the host began booting, at the last transition. */
  readonly elapsedMs = computed<number>(() =>
    Math.max(0, Date.now() - this._status().startedAt),
  );

  /**
   * True once any snapshot has been accepted. Until then the ready default is
   * a placeholder, not a claim, so the first pull adopts whatever it is told —
   * including a `warming` state, which the monotonic rule below would
   * otherwise reject as a regression from `ready`.
   */
  private hasSnapshot = false;

  private watchdog: ReturnType<typeof setInterval> | null = null;

  /** Epoch ms after which unsettled host steps stop being re-pulled. */
  private stepPullDeadline: number | null = null;

  private readonly isElectron: boolean;

  constructor() {
    // Snapshot, not a reactive read — `VSCodeService.isElectron` is a plain
    // getter (vscode.service.ts:171), the same idiom as `app.ts:47`.
    this.isElectron = this.vscode.isElectron;
    this.destroyRef.onDestroy(() => this.stopWatchdog());
    if (!this.isElectron) return;
    void this.pullReadiness();
  }

  /**
   * `MessageHandler.handleMessage`. A payload that fails narrowing is dropped:
   * a malformed push must not be able to strand a host behind a boot screen.
   *
   * A push is always authoritative — it is the host telling us something
   * changed, so it may move the state backwards (a `failed` after a `warming`,
   * for instance). Only the pull is held to the monotonic rule.
   *
   * A `boot:progress` push is different: it is replayed and racing the pull,
   * so it goes through the no-regression step fold.
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
    if (message.type === MESSAGE_TYPES.BOOT_PROGRESS) {
      this.foldHostSteps([message.payload]);
      return;
    }
    if (message.type !== MESSAGE_TYPES.BOOT_READINESS_CHANGED) return;
    const snapshot = toReadinessSnapshot(message.payload);
    if (!snapshot) return;
    this.adopt(snapshot);
  }

  /**
   * One pull. Every failure path leaves the current state untouched, so a host
   * with no `boot:` namespace keeps the ready default forever.
   */
  private async pullReadiness(): Promise<void> {
    try {
      const result = await this.rpc.call(
        'boot:getReadiness',
        {},
        { timeout: READINESS_PULL_TIMEOUT_MS },
      );
      if (!result.isSuccess()) return;
      // The step snapshots fold independently of the readiness rule below:
      // the step fold is itself monotonic, so a stale pull cannot rewind it.
      this.foldHostSteps(readPulledSteps(result.data));
      const snapshot = toReadinessSnapshot(result.data);
      if (!snapshot) return;
      // A pull answers a question asked in the past. Adopt it only if it is at
      // least as advanced as what we already hold, so an in-flight pull cannot
      // rewind a push that landed while it was on the wire.
      if (this.hasSnapshot && !isAtLeastAsAdvanced(snapshot, this._status())) {
        return;
      }
      this.adopt(snapshot);
    } catch {
      // A host with no `boot:` namespace (VS Code) or a rejected call leaves
      // the ready default — deliberately indistinguishable from a settled boot.
    }
  }

  /**
   * Fold step payloads from a push or a pull. Each one is `safeParse`d with
   * the shared schema; an invalid one is dropped without touching the rest.
   * The signal is written once, and only when a step actually changed.
   */
  private foldHostSteps(payloads: readonly unknown[]): void {
    let next = this._hostSteps() ?? PENDING_HOST_STEPS;
    let changed = false;
    for (const value of payloads) {
      const parsed = BootProgressPayloadSchema.safeParse(value);
      if (!parsed.success) continue;
      const position = BOOT_PROGRESS_STEP_IDS.indexOf(parsed.data.stepId);
      const current = next[position];
      if (current === undefined) continue;
      const merged = mergeHostStep(current, parsed.data);
      if (merged === current) continue;
      next = next.map((step, i) => (i === position ? merged : step));
      changed = true;
    }
    if (!changed) return;
    this._hostSteps.set(next);
    this.syncWatchdog();
  }

  /** Accept a snapshot and re-arm or retire the watchdog to match it. */
  private adopt(snapshot: BootReadinessChangedPayload): void {
    this.hasSnapshot = true;
    this._status.set(snapshot);
    this.syncWatchdog();
  }

  /**
   * Run the re-pull while the boot is `warming`, and afterwards while a known
   * host step is still `pending` or `active`: a step can settle after
   * readiness does, and if that push was missed nothing else re-sends it. The
   * step-only phase is bounded by {@link HOST_STEP_PULL_WINDOW_MS} from the
   * moment readiness left `warming`.
   */
  private syncWatchdog(): void {
    if (this._status().readiness === 'warming') {
      this.stepPullDeadline = null;
      this.startWatchdog();
      return;
    }
    const steps = this._hostSteps();
    const unsettled =
      steps?.some((s) => s.state === 'pending' || s.state === 'active') ??
      false;
    if (!unsettled) {
      this.stopWatchdog();
      return;
    }
    this.stepPullDeadline ??= Date.now() + HOST_STEP_PULL_WINDOW_MS;
    if (Date.now() >= this.stepPullDeadline) {
      this.stopWatchdog();
      return;
    }
    this.startWatchdog();
  }

  private startWatchdog(): void {
    if (!this.isElectron || this.watchdog !== null) return;
    this.watchdog = setInterval(() => {
      this.syncWatchdog();
      if (this.watchdog !== null) void this.pullReadiness();
    }, DEFAULT_READINESS_RETRY_AFTER_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdog === null) return;
    clearInterval(this.watchdog);
    this.watchdog = null;
  }
}

/**
 * Apply one validated payload to a step, or return `current` unchanged.
 *
 * - A terminal step (`done`, `failed`) keeps its first terminal state, the same
 *   rule the host publisher applies.
 * - An `active` update never lowers the `done` count of an `active` step, so a
 *   pull that was on the wire while a newer tick landed cannot rewind it.
 */
function mergeHostStep(
  current: HostBootStep,
  payload: BootProgressPayload,
): HostBootStep {
  if (current.state === 'done' || current.state === 'failed') return current;
  if (
    current.state === 'active' &&
    payload.state === 'active' &&
    current.done !== undefined &&
    (payload.done === undefined || payload.done < current.done)
  ) {
    return current;
  }
  return {
    stepId: payload.stepId,
    state: payload.state,
    ...(payload.done === undefined || payload.count === undefined
      ? {}
      : { done: payload.done, count: payload.count }),
    ...(payload.elapsedMs === undefined ? {} : { elapsedMs: payload.elapsedMs }),
    startedAt: payload.startedAt,
  };
}

/** The `steps` of a pull result as unvalidated entries; `[]` when absent. */
function readPulledSteps(value: unknown): readonly unknown[] {
  if (typeof value !== 'object' || value === null || !('steps' in value)) {
    return [];
  }
  return Array.isArray(value.steps) ? value.steps : [];
}

/** Terminal states rank above `warming`; everything else compares by phase. */
function readinessRank(readiness: BackendReadiness): number {
  return readiness === 'warming' ? 0 : 1;
}

/**
 * True when `candidate` is at least as far along the boot as `current`.
 * Readiness first — a terminal state always wins over `warming` — then the
 * phase's position in `BOOT_PHASE_VALUES`.
 */
function isAtLeastAsAdvanced(
  candidate: BootReadinessChangedPayload,
  current: BootReadinessChangedPayload,
): boolean {
  const candidateRank = readinessRank(candidate.readiness);
  const currentRank = readinessRank(current.readiness);
  if (candidateRank !== currentRank) return candidateRank > currentRank;
  return (
    BOOT_PHASE_VALUES.indexOf(candidate.phase) >=
    BOOT_PHASE_VALUES.indexOf(current.phase)
  );
}

/** Narrow an unknown push/pull body to a readiness snapshot, or `null`. */
function toReadinessSnapshot(
  value: unknown,
): BootReadinessChangedPayload | null {
  if (typeof value !== 'object' || value === null) return null;
  const candidate = value as Partial<BootReadinessChangedPayload>;
  if (!isBackendReadiness(candidate.readiness)) return null;
  if (!isBootPhase(candidate.phase)) return null;
  if (
    typeof candidate.startedAt !== 'number' ||
    !Number.isFinite(candidate.startedAt)
  ) {
    return null;
  }
  if (candidate.detail !== undefined && typeof candidate.detail !== 'string') {
    return null;
  }
  return {
    readiness: candidate.readiness,
    phase: candidate.phase,
    startedAt: candidate.startedAt,
    ...(candidate.detail === undefined ? {} : { detail: candidate.detail }),
  };
}
