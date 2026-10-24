/**
 * Lane owner resolver (TASK_2026_596, Component 10; Decision 3, Decision 10,
 * Gate 2 G3).
 *
 * Names the quota owner a lane runs on. Every key is built by
 * `ProviderOwnerResolver` (auth-providers), the single hashing site; this
 * class only decides which of its owners applies to a lane:
 *
 * - codex — the account last read from the shared `CODEX_HOME`, unknown
 *   (keyed by that home) before the first read; a lookup reads it first.
 * - opencode — the OpenCode Go subscription when the store holds a Go key and
 *   the model is not another provider's; otherwise the CLI's credential store.
 * - antigravity, grok — the CLI's own credential store.
 * - ptah-cli on Claude — the account the lane's own `accountInfo()` returned.
 * - ptah-cli on Ollama Cloud — the fingerprint of the lane's stored key,
 *   unknown for the placeholder.
 * - anything else — no owner; it reads as "Unknown owner".
 *
 * Lanes without an owner rule (ptah-cli on Claude and other providers) learn
 * their owner only from a run. The last known owner of each such lane is
 * remembered in memory so a later lookup reads the evidence filed under it.
 * A lane run on a named Claude account is remembered under that route, so
 * one account's owner never answers for a lane on another account, and a
 * failed identity read is never remembered at all.
 *
 * A run's owner is recorded at spawn and may then only move from unknown to
 * known, or from a cli-store owner to the account of the same provider
 * ({@link upgradeQuotaOwner}); it is never overwritten otherwise.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  AUTH_PROVIDERS_TOKENS,
  type ClaudeAccountInfo,
  type ProviderOwnerResolver,
} from '@ptah-extension/auth-providers';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
import type { CliType, QuotaOwnerRef } from '@ptah-extension/shared';
import { namedSourceMaterial } from './plan-owner-read';

/** The resolver surface lanes use. */
export type LaneOwnerSource = Pick<
  ProviderOwnerResolver,
  | 'ownerForCodexHome'
  | 'resolveCodexHomeOwner'
  | 'ownerForCliStore'
  | 'ownerForOpenCode'
  | 'ownerForAntigravity'
  | 'ownerForClaudeAccount'
  | 'ownerForPtahCli'
>;

/**
 * The owner a run should carry after `candidate` is offered.
 *
 * Returns the new owner when it changes, `undefined` when it does not:
 * - no owner yet → `candidate`, whatever its kind;
 * - an unknown owner → `candidate` only when it is known;
 * - a cli-store owner → `candidate` only when it is the `account` of the
 *   same provider. The account a CLI's credential store serves may become
 *   known only while the lane runs, and the account is what the provider
 *   bills, so the run is re-attributed to it (D2). The old cli-store ledger
 *   owner the run already wrote under remains until it ages out; nothing is
 *   lost (R6);
 * - any other known owner (`account`, `credential`) → never replaced.
 */
export function upgradeQuotaOwner(
  current: QuotaOwnerRef | undefined,
  candidate: QuotaOwnerRef | undefined,
): QuotaOwnerRef | undefined {
  if (!candidate) return undefined;
  if (!current) return candidate;
  if (current.identityKind === 'unknown') {
    return candidate.identityKind !== 'unknown' ? candidate : undefined;
  }
  if (
    current.identityKind === 'cli-store' &&
    candidate.identityKind === 'account' &&
    candidate.providerId === current.providerId
  ) {
    return candidate;
  }
  return undefined;
}

/** A lane as the remembered-owner map keys it. */
export interface LaneOwnerKey {
  readonly cli: CliType;
  readonly ptahCliId?: string;
  /**
   * The certified route fingerprint of a lane run on a named Claude account.
   * Omitted for the ambient login, whose remembered owner keeps its key.
   */
  readonly accountRouteFingerprint?: string;
}

/** Remembered lane owners kept; the same bound as the plan-usage cache. */
const MAX_REMEMBERED_LANE_OWNERS = 64;

@injectable()
export class LaneOwnerResolver {
  /** Last known owner per lane, least recently written first. */
  private readonly laneOwners = new Map<string, QuotaOwnerRef>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.PROVIDER_OWNER_RESOLVER)
    private readonly owners: LaneOwnerSource,
  ) {}

  /**
   * The owner of a system CLI lane, read synchronously at spawn and again at
   * exit while it is still unknown. `undefined` for a CLI with no owner rule,
   * including ptah-cli, whose owner arrives through the two methods below.
   * Never throws: a failed read leaves the lane without an owner.
   */
  ownerForLane(cli: CliType, model?: string): QuotaOwnerRef | undefined {
    try {
      switch (cli) {
        case 'codex':
          return this.owners.ownerForCodexHome();
        case 'opencode':
          return this.owners.ownerForOpenCode(model);
        case 'antigravity':
          return this.owners.ownerForAntigravity();
        case 'grok':
          // The Grok reader itself answers no-usage-source for API-key and
          // custom auth, so an unconditional owner only lets hits be filed.
          return this.owners.ownerForCliStore('grok');
        default:
          return undefined;
      }
    } catch (error: unknown) {
      // degradation-audit: reported - logged at warn; the lane runs with no
      // recorded owner.
      this.warnLookupFailed(cli, error);
      return undefined;
    }
  }

  /**
   * {@link ownerForLane} for a limit lookup, which may wait: Codex reads its
   * account first, so the lookup names the owner its reader reports on.
   * Never rejects.
   */
  async resolveOwnerForLane(
    cli: CliType,
    model?: string,
  ): Promise<QuotaOwnerRef | undefined> {
    if (cli !== 'codex') return this.ownerForLane(cli, model);
    try {
      return await this.owners.resolveCodexHomeOwner();
    } catch (error: unknown) {
      // degradation-audit: reported - logged at warn; the lookup reports the
      // lane with no owner.
      this.warnLookupFailed(cli, error);
      return undefined;
    }
  }

  /**
   * Remember the owner a lane's run carries. Unknown owners are not kept; the
   * map holds at most 64 lanes, dropping the least recently written.
   */
  rememberLaneOwner(lane: LaneOwnerKey, owner: QuotaOwnerRef): void {
    if (owner.identityKind === 'unknown') return;
    const key = laneKey(lane);
    this.laneOwners.delete(key);
    this.laneOwners.set(key, owner);
    if (this.laneOwners.size > MAX_REMEMBERED_LANE_OWNERS) {
      const oldest = this.laneOwners.keys().next().value;
      if (oldest !== undefined) this.laneOwners.delete(oldest);
    }
  }

  /** The last known owner a run of this lane carried, if any. */
  lastLaneOwner(lane: LaneOwnerKey): QuotaOwnerRef | undefined {
    return this.laneOwners.get(laneKey(lane));
  }

  /**
   * A Claude lane's owner from its own query's `accountInfo()`. A known
   * email plus organization is the same owner whichever directory the lane
   * ran in. Without an email it is unknown, keyed by the run so no other
   * lane shares it; on a named route the key also names the route, revision
   * and auth epoch, so a later epoch of the same account is another unknown.
   */
  ownerForClaudeLane(
    account: ClaudeAccountInfo,
    agentId: string,
    route?: ClaudeAccountNamedRoute,
  ): QuotaOwnerRef {
    const run = `run:${agentId}`;
    return this.owners.ownerForClaudeAccount(
      account,
      route ? namedSourceMaterial(route, `${run}:${route.runId}`) : run,
    );
  }

  /** A ptah-cli lane's owner from the key stored for that agent. */
  ownerForPtahCliKey(
    ptahCliId: string,
    providerId: string,
  ): Promise<QuotaOwnerRef> {
    return this.owners.ownerForPtahCli(ptahCliId, providerId);
  }

  private warnLookupFailed(cli: CliType, error: unknown): void {
    this.logger.warn('[LaneOwnerResolver] lane owner lookup failed', {
      cli,
      errorName: error instanceof Error ? error.name : typeof error,
    });
  }
}

function laneKey(lane: LaneOwnerKey): string {
  const base = `${lane.cli}:${lane.ptahCliId ?? ''}`;
  return lane.accountRouteFingerprint === undefined
    ? base
    : JSON.stringify([base, lane.accountRouteFingerprint]);
}
