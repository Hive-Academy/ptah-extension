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
 * forever with no in-app recovery. The loop runs only while `warming`, only in
 * Electron, and stops the instant readiness becomes terminal.
 *
 * ## Why the initial value is `ready`
 *
 * The same bundle runs in the VS Code webview, where no `boot:readinessChanged`
 * will ever arrive and no `boot:` RPC is registered. A `warming` default would
 * hang that host behind a boot screen forever. Every degrade path here —
 * a failed pull, a malformed push, a host that never pushes — therefore leaves
 * the service reporting `ready`, i.e. never blocking.
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
  DEFAULT_READINESS_RETRY_AFTER_MS,
  MESSAGE_TYPES,
  isBackendReadiness,
  isBootPhase,
  type BackendReadiness,
  type BootPhase,
  type BootReadinessChangedPayload,
} from '@ptah-extension/shared';

import { ClaudeRpcService } from './claude-rpc.service';
import type { MessageHandler } from './message-router.types';
import { VSCodeService } from './vscode.service';

/** Timeout for the one-shot readiness pull. Short: the answer is in-memory. */
const READINESS_PULL_TIMEOUT_MS = 5000;

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

@Injectable({ providedIn: 'root' })
export class BootStatusService implements MessageHandler {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly destroyRef = inject(DestroyRef);

  readonly handledMessageTypes = [
    MESSAGE_TYPES.BOOT_READINESS_CHANGED,
  ] as const;

  private readonly _status = signal<BootReadinessChangedPayload>(READY_DEFAULT);

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
   */
  handleMessage(message: { type: string; payload?: unknown }): void {
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

  /** Accept a snapshot and re-arm or retire the watchdog to match it. */
  private adopt(snapshot: BootReadinessChangedPayload): void {
    this.hasSnapshot = true;
    this._status.set(snapshot);
    if (snapshot.readiness === 'warming') {
      this.startWatchdog();
    } else {
      this.stopWatchdog();
    }
  }

  private startWatchdog(): void {
    if (!this.isElectron || this.watchdog !== null) return;
    this.watchdog = setInterval(() => {
      void this.pullReadiness();
    }, DEFAULT_READINESS_RETRY_AFTER_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdog === null) return;
    clearInterval(this.watchdog);
    this.watchdog = null;
  }
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
