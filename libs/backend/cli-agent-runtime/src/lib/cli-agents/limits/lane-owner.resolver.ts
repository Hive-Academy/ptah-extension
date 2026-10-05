/**
 * Lane owner resolver (TASK_2026_596, Component 10; Decision 3, Decision 10,
 * Gate 2 G3).
 *
 * Names the quota owner a lane runs on. Every key is built by
 * `ProviderOwnerResolver` (auth-providers), the single hashing site; this
 * class only decides which of its owners applies to a lane:
 *
 * - codex — the account last read from the shared `CODEX_HOME`, unknown
 *   (keyed by that home) before the first read.
 * - opencode, antigravity — the CLI's own credential store.
 * - ptah-cli on Claude — the account the lane's own `accountInfo()` returned.
 * - ptah-cli on Ollama Cloud — the fingerprint of the lane's stored key,
 *   unknown for the placeholder.
 * - anything else — no owner; it reads as "Unknown owner".
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
import type { CliType, QuotaOwnerRef } from '@ptah-extension/shared';

/** The resolver surface lanes use. */
export type LaneOwnerSource = Pick<
  ProviderOwnerResolver,
  | 'ownerForCodexHome'
  | 'ownerForCliStore'
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

@injectable()
export class LaneOwnerResolver {
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
  ownerForLane(cli: CliType): QuotaOwnerRef | undefined {
    try {
      switch (cli) {
        case 'codex':
          return this.owners.ownerForCodexHome();
        case 'opencode':
          return this.owners.ownerForCliStore(cli);
        case 'antigravity':
          return this.owners.ownerForAntigravity();
        default:
          return undefined;
      }
    } catch (error: unknown) {
      // degradation-audit: reported - logged at warn; the lane runs with no
      // recorded owner.
      this.logger.warn('[LaneOwnerResolver] lane owner lookup failed', {
        cli,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return undefined;
    }
  }

  /**
   * A ptah-cli Claude lane's owner from its own `accountInfo()`. Without an
   * email it is unknown, keyed by the run so no other lane shares it.
   */
  ownerForClaudeLane(
    account: ClaudeAccountInfo,
    agentId: string,
  ): QuotaOwnerRef {
    return this.owners.ownerForClaudeAccount(account, `run:${agentId}`);
  }

  /** A ptah-cli lane's owner from the key stored for that agent. */
  ownerForPtahCliKey(
    ptahCliId: string,
    providerId: string,
  ): Promise<QuotaOwnerRef> {
    return this.owners.ownerForPtahCli(ptahCliId, providerId);
  }
}
