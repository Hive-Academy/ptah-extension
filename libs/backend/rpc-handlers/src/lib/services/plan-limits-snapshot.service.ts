/**
 * PlanLimitsSnapshotService — assembles the `PlanLimitsSnapshot` that both
 * `provider:getPlanLimits` and the `planLimits:changed` push carry
 * (TASK_2026_596, Component 12; Decision 7).
 *
 * ## Owners
 *
 * `PlanLimitOwnerDiscoveryService.discoverTargets` names the owners. Each
 * entry is either:
 * - `read` — read through `PlanUsageService.getOwnerSnapshot(target)`, every
 *   owner in parallel, each under its provider's `limitLookupDeadlineMs`
 *   (3 s, or 12 s for Codex and Antigravity cold starts). A read that misses
 *   it is cancelled and the owner is still
 *   listed, as `service-unavailable` with the ledger's evidence;
 * - `known` — the snapshot is already complete and is passed through
 *   unchanged. It is never read.
 *
 * Discovery and all parallel owner reads share one 24-second ceiling. Slow
 * owners still appear with ledger evidence when that ceiling expires.
 *
 * The single-owner lookup behind `provider:getAccountUsage`
 * (`ownerSnapshotForProvider`) is the exception: it reads without that
 * deadline, so the reader's own time limit applies.
 *
 * ## The push uses the last request
 *
 * The push has no caller, so it repeats the scope of the most recent
 * `provider:getPlanLimits` call (provider, sessions, owner keys) without a
 * refresh. A push therefore lists the same owners the view last asked for and
 * can replace the view's snapshot as a whole.
 *
 * ## No secret crosses this boundary (F71)
 *
 * A read target names where its credential lives; the target itself is never
 * placed in the result. Only owner snapshots (hashed owner key, generic label)
 * and session owner keys are returned. A failed read is logged with its error
 * name only, never its message, which may quote a response body or a path.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  AUTH_PROVIDERS_TOKENS,
  type PlanLimitLedgerService,
  type PlanOwnerTarget,
  type PlanUsageService,
} from '@ptah-extension/auth-providers';
import {
  CLI_AGENT_RUNTIME_TOKENS,
  type DiscoveredPlanOwner,
  type PlanLimitOwnerDiscoveryService,
  type PlanOwnerDiscoveryRequest,
  type SelectedProviderDiscovery,
} from '@ptah-extension/cli-agent-runtime';
import {
  limitLookupDeadlineMs,
  SLOW_LIMIT_LOOKUP_DEADLINE_MS,
  type PlanLimitOwnerSnapshot,
  type PlanLimitSessionOwner,
  type PlanLimitsSnapshot,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';

/** The scope of one snapshot: what the view asked for. */
export interface PlanLimitsSnapshotRequest {
  readonly providerId?: string;
  readonly sessionIds?: readonly string[];
  readonly ownerKeys?: readonly string[];
  readonly refresh?: boolean;
}

export type PlanLimitsDiscovery = Pick<
  PlanLimitOwnerDiscoveryService,
  'discoverTargets' | 'discoverSelectedProvider'
>;
export type ProviderOwnerSnapshot =
  | { readonly kind: 'snapshot'; readonly snapshot: PlanLimitOwnerSnapshot }
  | { readonly kind: 'no-owner' }
  | { readonly kind: 'unavailable' };
export type PlanLimitsUsage = Pick<PlanUsageService, 'getOwnerSnapshot'>;
export type PlanLimitsLedgerReader = Pick<
  PlanLimitLedgerService,
  'snapshotFor' | 'sessionOwners'
>;
/** Leaves six seconds for RPC transport and rendering (30 second client timeout). */
const SNAPSHOT_BUDGET_MS = 24_000;
const RESERVED_READ_MS = SLOW_LIMIT_LOOKUP_DEADLINE_MS;

@injectable()
export class PlanLimitsSnapshotService {
  /** Scope of the most recent RPC request; the push repeats it. */
  private lastRequest: PlanOwnerDiscoveryRequest = {};

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(CLI_AGENT_RUNTIME_TOKENS.PLAN_LIMIT_OWNER_DISCOVERY)
    private readonly discovery: PlanLimitsDiscovery,
    @inject(AUTH_PROVIDERS_TOKENS.PLAN_USAGE_SERVICE)
    private readonly usage: PlanLimitsUsage,
    @inject(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER)
    private readonly ledger: PlanLimitsLedgerReader,
  ) {}

  /**
   * The snapshot for an RPC request. Its scope (not `refresh`) becomes the
   * scope of later pushes. Never rejects.
   */
  async snapshot(
    request: PlanLimitsSnapshotRequest,
  ): Promise<PlanLimitsSnapshot> {
    const scope = discoveryRequest(request);
    this.lastRequest = scope;
    return this.assemble(scope, request.refresh === true);
  }

  /** The snapshot for a push: the last request's scope, cached reads. */
  async currentSnapshot(): Promise<PlanLimitsSnapshot> {
    return this.assemble(this.lastRequest, false);
  }

  /**
   * The snapshot of the owner the given provider's route resolves to, or
   * `undefined` when the route names no owner. Does not change the push
   * scope. Never rejects.
   *
   * The read carries no {@link LIMIT_LOOKUP_DEADLINE_MS} deadline: this one
   * owner is what the caller asked for, so its reader's own time limit
   * applies (a Codex cold start may take up to 10 s, Req 2.10).
   */
  async ownerSnapshotForProvider(
    providerId: string,
    refresh: boolean,
  ): Promise<ProviderOwnerSnapshot> {
    const result: SelectedProviderDiscovery =
      await this.discovery.discoverSelectedProvider(providerId);
    if (result.kind === 'unavailable') return result;
    if (!result.entry) return { kind: 'no-owner' };
    return {
      kind: 'snapshot',
      snapshot: await this.ownerSnapshot(result.entry, refresh, false),
    };
  }

  // ---------------------------------------------------------------- helpers

  private async assemble(
    scope: PlanOwnerDiscoveryRequest,
    refresh: boolean,
  ): Promise<PlanLimitsSnapshot> {
    const deadlineAt = Date.now() + SNAPSHOT_BUDGET_MS;
    const entries = await this.discovery.discoverTargets(scope, deadlineAt - RESERVED_READ_MS);
    const owners = await Promise.all(
      entries.map((entry) => this.ownerSnapshot(entry, refresh, true, deadlineAt)),
    );
    return {
      generatedAt: Date.now(),
      owners,
      discoveryIncomplete: entries.discoveryIncomplete === true,
      sessionOwners: this.sessionOwners(scope.sessionIds ?? []),
    };
  }

  private async ownerSnapshot(
    entry: DiscoveredPlanOwner,
    refresh: boolean,
    withDeadline: boolean,
    deadlineAt?: number,
  ): Promise<PlanLimitOwnerSnapshot> {
    if (entry.kind === 'known') return entry.snapshot;
    const snapshot = await this.readOwner(entry.target, refresh, withDeadline, deadlineAt);
    return entry.unknownReason
      ? { ...snapshot, unknownReason: entry.unknownReason }
      : snapshot;
  }

  /**
   * One owner's read, under its provider-specific deadline
   * when `withDeadline` is set (otherwise under the reader's own limits). A
   * read that times out or fails still lists the owner, from ledger evidence
   * alone.
   */
  private async readOwner(
    target: PlanOwnerTarget,
    refresh: boolean,
    withDeadline: boolean,
    deadlineAt?: number,
  ): Promise<PlanLimitOwnerSnapshot> {
    const controller = withDeadline ? new AbortController() : undefined;
    const remainingMs = controller
      ? Math.min(limitLookupDeadlineMs(target.providerId), (deadlineAt ?? Date.now()) - Date.now())
      : 0;
    if (controller && remainingMs <= 0) {
      this.logger.debug('[PlanLimitsSnapshot] owner read ended without a snapshot', {
        providerId: target.providerId,
        reason: 'timeout',
      });
      return this.unreadSnapshot(target.ownerRef);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const read = this.usage.getOwnerSnapshot(target, {
        refresh,
        ...(controller && { signal: controller.signal }),
      });
      if (!controller) return await read;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error('Plan limit owner read deadline'));
        }, remainingMs);
        timer.unref?.();
      });
      return await Promise.race([read, timeout]);
    } catch (error: unknown) {
      this.logger.debug(
        '[PlanLimitsSnapshot] owner read ended without a snapshot',
        {
          providerId: target.providerId,
          reason: controller?.signal.aborted
            ? 'timeout'
            : error instanceof Error
              ? error.name
              : typeof error,
        },
      );
      return this.unreadSnapshot(target.ownerRef);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  /** The owner as `service-unavailable`, with whatever the ledger holds. */
  private unreadSnapshot(owner: QuotaOwnerRef): PlanLimitOwnerSnapshot {
    const evidence = this.ledger.snapshotFor(owner.key);
    return {
      owner,
      status: 'service-unavailable',
      windowSetEstablished: false,
      windows: evidence?.windows ?? [],
      ownerEvidence: evidence?.ownerEvidence ?? [],
      ...(evidence?.cooldown && { cooldown: evidence.cooldown }),
    };
  }

  /**
   * Every session the ledger has seen, plus each requested session it has
   * not seen yet as "owner not resolved".
   */
  private sessionOwners(
    sessionIds: readonly string[],
  ): Record<string, PlanLimitSessionOwner> {
    const known = this.ledger.sessionOwners();
    const result: Record<string, PlanLimitSessionOwner> = { ...known };
    for (const sessionId of sessionIds) {
      result[sessionId] ??= { ownerKey: null, modelScope: null };
    }
    return result;
  }
}

function discoveryRequest(
  request: PlanLimitsSnapshotRequest,
): PlanOwnerDiscoveryRequest {
  return {
    ...(request.providerId !== undefined && {
      selectedProviderId: request.providerId,
    }),
    ...(request.sessionIds !== undefined && {
      sessionIds: [...request.sessionIds],
    }),
    ...(request.ownerKeys !== undefined && {
      ownerKeys: [...request.ownerKeys],
    }),
  };
}
