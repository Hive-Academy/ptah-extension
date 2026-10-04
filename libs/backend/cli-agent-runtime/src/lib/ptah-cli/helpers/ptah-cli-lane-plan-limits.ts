/**
 * Ptah CLI lane plan limits (TASK_2026_596, Component 10; Decision 4 S2;
 * Gate 2 G3 and its non-blocking note).
 *
 * **Not injectable** — one instance per `spawnAgent()` call, like
 * `PtahCliStreamLoop`, because it holds the run's owner.
 *
 * It does two things for one lane:
 *
 * 1. **Names the run's quota owner** and hands it to
 *    `AgentProcessManager.recordQuotaOwner`:
 *    - `claude-cli` (the host's Claude login) — the lane's own
 *      `accountInfo()`, read once after the system init with a 3 s timeout;
 *    - `ollama-cloud` — the fingerprint of the key stored for this agent
 *      (unknown for the placeholder), read at spawn with the same timeout;
 *    - any other provider — no owner rule, so no owner ("Unknown owner").
 *    A failed or late read leaves the owner unknown; nothing here throws.
 *    The owner is recorded only once the manager tracks the run
 *    ({@link attach}), and the lane's turns are released to the manager only
 *    after the read has settled ({@link settled}), so both the
 *    `agent:quota-owner` persist and the exit persist carry it.
 * 2. **Files the lane stream's signals** in the plan-limit ledger under that
 *    owner: evidence as windows, owner evidence and cooldowns; a success with
 *    the turn's scopes and billing. A success on an unknown owner proves
 *    nothing about any allowance and is skipped (F65). A ledger failure is
 *    logged and never reaches the stream.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import type { ClaudePlanLimitEvidence } from '@ptah-extension/agent-sdk';
import type {
  ClaudeAccountInfo,
  PlanLimitLedgerService,
} from '@ptah-extension/auth-providers';
import type { PlanLimitWindow, QuotaOwnerRef } from '@ptah-extension/shared';
import type { LaneOwnerResolver } from '../../cli-agents/limits/lane-owner.resolver';
import { laneWindowDescriptor } from '../../cli-agents/limits/lane-limit-classifier';
import type { PtahCliPlanLimitSignal } from './ptah-cli-stream-loop.service';

/** Bound on the lane's owner read: `accountInfo()` or the stored-key read. */
export const LANE_OWNER_READ_TIMEOUT_MS = 3_000;

/** The ledger writes a lane stream makes. */
export type LanePlanLimitWriter = Pick<
  PlanLimitLedgerService,
  | 'recordWindowEvidence'
  | 'recordOwnerEvidence'
  | 'recordCooldown'
  | 'recordSuccess'
>;

/** The owner rules a Ptah CLI lane uses. */
export type LaneOwnerReader = Pick<
  LaneOwnerResolver,
  'ownerForClaudeLane' | 'ownerForPtahCliKey'
>;

/** `AgentProcessManager.recordQuotaOwner`. */
export type LaneOwnerRecorder = (
  agentId: string,
  owner: QuotaOwnerRef,
) => boolean;

/** The query surface the owner read needs; absent on a stubbed query. */
export interface LaneAccountSource {
  readonly accountInfo?: () => Promise<ClaudeAccountInfo>;
}

export interface PtahCliLanePlanLimitsDeps {
  readonly logger: Logger;
  /** `null` when the host has no ledger; signals are then dropped. */
  readonly ledger: LanePlanLimitWriter | null;
  /** `null` when the host has no owner resolver; the run then has no owner. */
  readonly owners: LaneOwnerReader | null;
  /** `null` when the host has no process manager to record the owner on. */
  readonly recordOwner: LaneOwnerRecorder | null;
  readonly ptahCliId: string;
  readonly providerId: string;
}

type OwnerRule = 'claude-account' | 'stored-key';

/** Providers with an owner rule (Component 10, lane owner resolver). */
const OWNER_RULES: Readonly<Record<string, OwnerRule>> = {
  'claude-cli': 'claude-account',
  'ollama-cloud': 'stored-key',
};

/**
 * Whether every successful turn of a provider's lane is plan-billed. Ollama
 * documents no overage, credit or fallback billing (Decision 4 S2).
 */
export function isPlanBilledLaneProvider(providerId: string): boolean {
  return providerId === 'ollama-cloud';
}

/** The owner of the run with this agent id; `null` when it is unknown. */
type OwnerForRun = ((agentId: string) => QuotaOwnerRef) | null;

class LaneOwnerReadTimeoutError extends Error {
  constructor() {
    super('lane owner read timed out');
    this.name = 'LaneOwnerReadTimeoutError';
  }
}

export class PtahCliLanePlanLimits {
  /** Resolves once the owner read has finished, failed or will not run. */
  readonly settled: Promise<void>;
  private readonly rule: OwnerRule | undefined;
  private readState: 'idle' | 'reading' | 'done' = 'idle';
  private ownerForRun: OwnerForRun = null;
  private agentId: string | undefined;
  private ownerPublished = false;
  private markSettled!: () => void;
  private publishOwner!: (owner: QuotaOwnerRef | undefined) => void;
  /** The run's recorded owner; `undefined` when it has none. */
  private readonly owner: Promise<QuotaOwnerRef | undefined>;

  constructor(private readonly deps: PtahCliLanePlanLimitsDeps) {
    this.settled = new Promise<void>((resolve) => {
      this.markSettled = resolve;
    });
    this.owner = new Promise<QuotaOwnerRef | undefined>((resolve) => {
      this.publishOwner = resolve;
    });
    this.rule = deps.owners ? OWNER_RULES[deps.providerId] : undefined;
    if (this.rule === undefined) {
      this.finishRead(null);
    } else if (this.rule === 'stored-key') {
      const owners = deps.owners as LaneOwnerReader;
      this.startRead(async () => {
        const owner = await owners.ownerForPtahCliKey(
          deps.ptahCliId,
          deps.providerId,
        );
        return () => owner;
      });
    }
  }

  /**
   * The lane's system init arrived: read its Claude account, once. Only a
   * `claude-cli` lane reads it; any other provider's `accountInfo()` names an
   * API key, not the owner of a plan.
   */
  onSystemInit(query: LaneAccountSource): void {
    if (this.rule !== 'claude-account' || this.readState !== 'idle') return;
    const owners = this.deps.owners as LaneOwnerReader;
    this.startRead(async () => {
      if (typeof query.accountInfo !== 'function') return null;
      const account = await query.accountInfo();
      this.deps.logger.debug('[PtahCliRegistry] Lane account read', {
        ptahCliId: this.deps.ptahCliId,
        hasEmail: Boolean(account?.email),
        hasOrganization: Boolean(account?.organization),
      });
      return (agentId: string) => owners.ownerForClaudeLane(account, agentId);
    });
  }

  /**
   * The manager now tracks the run under `agentId`. Deferred one microtask so
   * the manager finishes registering the run before its owner is announced.
   */
  attach(agentId: string): void {
    if (this.agentId !== undefined) return;
    this.agentId = agentId;
    queueMicrotask(() => this.tryPublishOwner());
  }

  /**
   * The lane's stream has ended. An owner read that never started (no system
   * init arrived) will not start now; one in flight is left to settle.
   */
  end(): void {
    if (this.readState === 'idle') this.finishRead(null);
  }

  /** File one stream signal under the run's owner, once it is known. */
  onSignal(signal: PtahCliPlanLimitSignal): void {
    if (!this.deps.ledger || this.rule === undefined) return;
    void this.owner.then((owner) => {
      if (owner) this.write(owner, signal);
    });
  }

  private startRead(read: () => Promise<OwnerForRun>): void {
    this.readState = 'reading';
    void within(read(), LANE_OWNER_READ_TIMEOUT_MS)
      .catch((error: unknown) => {
        // The error text is not logged: an account or secret-store failure
        // may quote what it was reading. The failure kind is enough.
        this.deps.logger.debug(
          '[PtahCliRegistry] Lane owner read failed; owner stays unknown',
          {
            ptahCliId: this.deps.ptahCliId,
            providerId: this.deps.providerId,
            failure:
              error instanceof LaneOwnerReadTimeoutError
                ? 'timeout'
                : 'rejected',
          },
        );
        return null;
      })
      .then((ownerForRun) => this.finishRead(ownerForRun));
  }

  private finishRead(ownerForRun: OwnerForRun): void {
    if (this.readState === 'done') return;
    this.readState = 'done';
    this.ownerForRun = ownerForRun;
    this.tryPublishOwner();
    this.markSettled();
  }

  private tryPublishOwner(): void {
    if (this.ownerPublished || this.readState !== 'done') return;
    if (this.ownerForRun === null) {
      this.ownerPublished = true;
      this.publishOwner(undefined);
      return;
    }
    if (this.agentId === undefined) return;
    this.ownerPublished = true;
    let owner: QuotaOwnerRef | undefined;
    try {
      owner = this.ownerForRun(this.agentId);
      this.deps.recordOwner?.(this.agentId, owner);
    } catch (error: unknown) {
      this.deps.logger.warn('[PtahCliRegistry] Lane owner not recorded', {
        ptahCliId: this.deps.ptahCliId,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
    this.publishOwner(owner);
  }

  private write(owner: QuotaOwnerRef, signal: PtahCliPlanLimitSignal): void {
    const ledger = this.deps.ledger as LanePlanLimitWriter;
    try {
      if (signal.kind === 'evidence') {
        this.writeEvidence(ledger, owner, signal.evidence);
        return;
      }
      if (owner.identityKind === 'unknown') return;
      ledger.recordSuccess({
        ownerKey: owner.key,
        modelScopes: signal.turnScopes,
        billing: signal.billing,
        observedAt: signal.observedAt,
      });
    } catch (error: unknown) {
      this.deps.logger.warn('[PtahCliRegistry] Plan-limit ledger write failed', {
        ptahCliId: this.deps.ptahCliId,
        signal: signal.kind,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  private writeEvidence(
    ledger: LanePlanLimitWriter,
    owner: QuotaOwnerRef,
    evidence: ClaudePlanLimitEvidence,
  ): void {
    if (evidence.kind === 'window') {
      ledger.recordWindowEvidence(owner, laneWindowFromEvidence(evidence));
      return;
    }
    ledger.recordOwnerEvidence(owner, {
      observedAt: evidence.observedAt,
      source: evidence.source,
      ...(evidence.resetsAt !== undefined && {
        resetsAt: evidence.resetsAt,
        resetSource: evidence.source,
      }),
    });
    if (evidence.cooldown) ledger.recordCooldown(owner, evidence.cooldown);
  }
}

/** A lane's `rate_limit_event` as a window; a rejected one carries exhaustion. */
export function laneWindowFromEvidence(
  evidence: Extract<ClaudePlanLimitEvidence, { kind: 'window' }>,
): PlanLimitWindow {
  const reset =
    evidence.resetsAt !== undefined
      ? { resetsAt: evidence.resetsAt, resetSource: evidence.source }
      : {};
  const scope =
    evidence.modelScope !== undefined
      ? { modelScope: evidence.modelScope }
      : {};
  return {
    ...laneWindowDescriptor(evidence.windowKey, evidence.modelScope),
    ...scope,
    ...reset,
    ...(evidence.exhausted && {
      exhaustion: {
        observedAt: evidence.observedAt,
        source: evidence.source,
        ...reset,
        ...scope,
      },
    }),
    observedAt: evidence.observedAt,
  };
}

/** `pending`, or a rejection after `ms`; the timer never outlives the race. */
async function within<T>(pending: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new LaneOwnerReadTimeoutError()), ms);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
