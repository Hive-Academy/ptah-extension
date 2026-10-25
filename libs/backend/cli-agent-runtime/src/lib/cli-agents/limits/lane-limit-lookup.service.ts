/**
 * Lane limit lookup (TASK_2026_596, Component 10; Req 5.4, 5.7).
 *
 * The agent tools ask it for the limit state of each lane they list or spawn
 * on. For every row it names the lane's quota owner, reads that owner's
 * snapshot through `PlanUsageService`, narrows it to the lane's model scope
 * and classifies the lane with the shared engine.
 *
 * ## Deadline
 *
 * Each lane races its own deadline (3 s normally, 12 s for Codex and
 * Antigravity, see `limitLookupDeadlineMs`), so a slow reader is classified
 * only on its own lane: it becomes `lookup: 'timeout'` ("limit lookup
 * timed out") and every other lane is still returned. The whole lookup still
 * waits for the slowest lane, so a cold Codex or Antigravity read can hold the
 * response for up to 12 s; later reads come from the reader caches. A lane whose owner or
 * snapshot read throws becomes `lookup: 'failed'`. Both are `unknown` and
 * borrow nothing. When the deadline passes or the caller's signal fires, the
 * reads still waiting are cancelled.
 *
 * `lookup` never rejects, so a tool never fails because of it.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  AUTH_PROVIDERS_TOKENS,
  type PlanLimitLedgerService,
  type PlanUsageService,
} from '@ptah-extension/auth-providers';
import {
  FRESHNESS_MS,
  LIMIT_LOOKUP_DEADLINE_MS,
  limitLookupDeadlineMs,
  NEAR_LIMIT_PERCENT,
  applicableLimits,
  classifyLaneState,
  type CliType,
  type LaneLookupFailure,
  type LaneStateResult,
  type PlanLimitOwnerSnapshot,
  type QuotaOwnerRef,
} from '@ptah-extension/shared';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import { CLI_AGENT_RUNTIME_TOKENS } from '../../di/tokens';
import { laneAccountFields } from '../lane-resume-gate';
import type { LaneOwnerResolver } from './lane-owner.resolver';
import { planOwnerRead, snapshotWithoutRead } from './plan-owner-read';

/**
 * The route fingerprint a lane's owner is remembered under: `undefined` for
 * the ambient login (key unchanged), the binding's fingerprint for a lane run
 * on a named Claude account, `null` when a binding is present but unreadable
 * (fail closed: such a lane is never keyed as ambient).
 */
export function laneRouteFingerprint(value: object): string | null | undefined {
  const { accountBinding } = laneAccountFields(value);
  if (accountBinding === undefined) return undefined;
  if (
    typeof accountBinding !== 'object' ||
    accountBinding === null ||
    !('routeFingerprint' in accountBinding) ||
    typeof accountBinding.routeFingerprint !== 'string'
  ) {
    return null;
  }
  return accountBinding.routeFingerprint;
}

/** One lane to look up. `CliDetectionResult` rows fit as they are. */
export interface LaneLimitLookupRow {
  readonly cli: CliType;
  /** Ptah CLI agent id; set for `cli: 'ptah-cli'`. */
  readonly ptahCliId?: string;
  /** The Ptah CLI agent's provider id; set for `cli: 'ptah-cli'`. */
  readonly providerId?: string;
  /** CLI session id returned by a Ptah-started lane, never discovered locally. */
  readonly cliSessionId?: string;
  /**
   * The owner a spawned run recorded. It wins over the lane's owner rule, so
   * a run keeps the account it ran on after the current account changes.
   */
  readonly quotaOwner?: QuotaOwnerRef;
  /**
   * The lane's resolved model scope (`opus`, `sonnet`, ...) whenever it is
   * known. Without it a lane whose owner has model-scoped limits can never
   * confirm room.
   */
  readonly modelScope?: string | null;
  /** The model a spawn asks for; picks the OpenCode owner. */
  readonly model?: string;
  /**
   * The certified named Claude route the lane runs on. It keys the lane's
   * remembered owner to that route and lets a Claude read ask only the query
   * bound to it. Without it, a persisted `accountBinding` on the row still
   * keys the remembered owner; with neither, the lane is ambient.
   */
  readonly claudeRoute?: ClaudeAccountNamedRoute;
}

export interface LaneLimitLookupOptions {
  /** Per-lookup deadline; {@link LIMIT_LOOKUP_DEADLINE_MS} by default. */
  readonly deadlineMs?: number;
  /** Ends the lookup early; lanes still waiting become `failed`. */
  readonly signal?: AbortSignal;
}

/**
 * - `ok` — the owner's snapshot was read (or is known without a read).
 * - `no-owner` — the lane has no owner rule, so there is nothing to read.
 * - `timeout` — the lane missed the deadline.
 * - `failed` — the owner or snapshot read threw, or the caller cancelled.
 */
export type LaneLimitLookupStatus = 'ok' | 'no-owner' | 'timeout' | 'failed';

export interface LaneLimitResult<R extends LaneLimitLookupRow> {
  readonly row: R;
  readonly lookup: LaneLimitLookupStatus;
  readonly owner?: QuotaOwnerRef;
  readonly snapshot?: PlanLimitOwnerSnapshot;
  readonly state: LaneStateResult;
}

/** The lane owner rules the lookup uses. */
export type LaneLimitOwnerRules = Pick<
  LaneOwnerResolver,
  'resolveOwnerForLane' | 'ownerForPtahCliKey' | 'lastLaneOwner'
>;
/** The snapshot read the lookup uses. */
export type LaneLimitSnapshots = Pick<PlanUsageService, 'getOwnerSnapshot'>;
/** The ledger read for owners that are not read from their provider. */
export type LaneLimitLedger = Pick<PlanLimitLedgerService, 'snapshotFor'>;

interface LaneRead {
  readonly owner?: QuotaOwnerRef;
  readonly snapshot?: PlanLimitOwnerSnapshot;
}

type LaneOutcome =
  | { readonly kind: 'read'; readonly read: LaneRead }
  | { readonly kind: 'missed'; readonly failure: LaneLookupFailure };

const TIMED_OUT: LaneOutcome = { kind: 'missed', failure: 'timed-out' };
const CANCELLED: LaneOutcome = { kind: 'missed', failure: 'failed' };

@injectable()
export class LaneLimitLookupService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(CLI_AGENT_RUNTIME_TOKENS.LANE_OWNER_RESOLVER)
    private readonly owners: LaneLimitOwnerRules,
    @inject(AUTH_PROVIDERS_TOKENS.PLAN_USAGE_SERVICE)
    private readonly snapshots: LaneLimitSnapshots,
    @inject(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER)
    private readonly ledger: LaneLimitLedger,
  ) {}

  /** One result per row, in row order. Never rejects. */
  async lookup<R extends LaneLimitLookupRow>(
    rows: readonly R[],
    options: LaneLimitLookupOptions = {},
  ): Promise<Array<LaneLimitResult<R>>> {
    if (rows.length === 0) return [];
    const outcomes = await Promise.all(
      rows.map((row) => this.lookupRow(row, options)),
    );
    const now = Date.now();
    return rows.map((row, index) => this.toResult(row, outcomes[index], now));
  }

  /** Each lane owns its timer and cancellation, so one lane's timeout never fails a peer. */
  private async lookupRow(
    row: LaneLimitLookupRow,
    options: LaneLimitLookupOptions,
  ): Promise<LaneOutcome> {
    const controller = new AbortController();
    const { signal } = options;
    const onCallerAbort = (): void => controller.abort();
    if (signal?.aborted) controller.abort();
    else signal?.addEventListener('abort', onCallerAbort, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<LaneOutcome>((resolve) => {
      timer = setTimeout(
        () => resolve(TIMED_OUT),
        options.deadlineMs ??
          limitLookupDeadlineMs(
            row.cli,
            row.providerId,
            row.quotaOwner?.providerId,
          ),
      );
      timer.unref?.();
    });
    const cancelled = new Promise<LaneOutcome>((resolve) => {
      if (controller.signal.aborted) resolve(CANCELLED);
      else
        controller.signal.addEventListener('abort', () => resolve(CANCELLED), {
          once: true,
        });
    });
    try {
      return await Promise.race([
        this.readLane(row, controller.signal),
        deadline,
        cancelled,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
      controller.abort();
    }
  }

  /** The lane's owner and snapshot. Settles as a `failed` outcome on a throw. */
  private async readLane(
    row: LaneLimitLookupRow,
    signal: AbortSignal,
  ): Promise<LaneOutcome> {
    try {
      const owner = row.quotaOwner ?? (await this.ownerOf(row));
      if (!owner) return { kind: 'read', read: {} };
      const plan = planOwnerRead(owner, {
        ptahCliId: row.ptahCliId,
        cliSessionId: row.cliSessionId,
        ...(row.claudeRoute && { claudeRoute: row.claudeRoute }),
      });
      if (!plan) return { kind: 'read', read: { owner } };
      const snapshot =
        plan.kind === 'read'
          ? await this.snapshots.getOwnerSnapshot(plan.target, { signal })
          : snapshotWithoutRead(owner, plan, this.ledger);
      return { kind: 'read', read: { owner, snapshot } };
    } catch (error: unknown) {
      // A read cancelled at the deadline already counts as `timeout`; only a
      // real failure is logged, and only its kind: an owner or reader error
      // may quote a secret store or a response body.
      if (!signal.aborted) {
        this.logger.debug('[LaneLimitLookup] lane lookup failed', {
          cli: row.cli,
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
      return { kind: 'missed', failure: 'failed' };
    }
  }

  /**
   * The lane's owner by its rule: the CLI's own store or account home, or a
   * Ptah CLI agent's stored Ollama Cloud key. Any other Ptah CLI lane (Claude
   * and the rest) learns its owner only from a run: its own `accountInfo()`
   * (`row.quotaOwner`), else the last known owner a run of that lane carried.
   */
  private async ownerOf(
    row: LaneLimitLookupRow,
  ): Promise<QuotaOwnerRef | undefined> {
    if (row.cli !== 'ptah-cli') {
      return this.owners.resolveOwnerForLane(row.cli, row.model);
    }
    if (row.providerId === 'ollama-cloud' && row.ptahCliId) {
      return this.owners.ownerForPtahCliKey(row.ptahCliId, row.providerId);
    }
    // An account-bound lane reads only the owner remembered under its own
    // route; an unreadable binding reads none rather than the ambient one.
    const fingerprint =
      row.claudeRoute?.routeFingerprint ?? laneRouteFingerprint(row);
    if (fingerprint === null) return undefined;
    return this.owners.lastLaneOwner({
      cli: row.cli,
      ptahCliId: row.ptahCliId,
      ...(fingerprint !== undefined && {
        accountRouteFingerprint: fingerprint,
      }),
    });
  }

  private toResult<R extends LaneLimitLookupRow>(
    row: R,
    outcome: LaneOutcome,
    now: number,
  ): LaneLimitResult<R> {
    const ctx = {
      now,
      nearLimitPercent: NEAR_LIMIT_PERCENT,
      freshnessMs: FRESHNESS_MS,
    };
    if (outcome.kind === 'missed') {
      return {
        row,
        lookup: outcome.failure === 'timed-out' ? 'timeout' : 'failed',
        ...(row.quotaOwner && { owner: row.quotaOwner }),
        state: classifyLaneState(undefined, {
          ...ctx,
          lookupFailure: outcome.failure,
        }),
      };
    }
    const { owner, snapshot } = outcome.read;
    return {
      row,
      lookup: owner ? 'ok' : 'no-owner',
      ...(owner && { owner }),
      ...(snapshot && { snapshot }),
      state: classifyLaneState(
        snapshot ? applicableLimits(snapshot, row.modelScope) : undefined,
        ctx,
      ),
    };
  }
}
