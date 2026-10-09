/**
 * Plan-usage reader contracts (TASK_2026_596, Component 6).
 *
 * A reader turns one owner's provider source into windows. The plan-usage
 * service picks the reader by provider id (a plain record of functions, not a
 * plugin registry), hands it the target, and merges the reading with ledger
 * evidence.
 *
 * Backend only: none of these types crosses RPC. A target never carries a
 * secret — `credentialRef` says where one lives, and the service resolves it
 * through `PlanCredentialSource` just before the single reader call.
 */
import type {
  PlanLimitOwnerSnapshot,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import type { PlanSecret } from '../plan-credential.source';

/**
 * Where a reader's secret lives. Targets that need none (Claude subscription,
 * Codex account home, local CLI stores) carry no reference.
 */
export type PlanCredentialRef =
  | { readonly kind: 'provider-key'; readonly providerId: string }
  | { readonly kind: 'ptah-cli-key'; readonly ptahCliId: string };

/**
 * Selects which live session's query a probe-backed reader calls. A handle,
 * never a credential lookup.
 */
export interface PlanSessionHandle {
  readonly kind: 'session';
  readonly sessionId: string;
}

/** One owner whose limits are to be read. */
export interface PlanOwnerTarget {
  readonly providerId: string;
  readonly ownerRef: QuotaOwnerRef;
  readonly credentialRef?: PlanCredentialRef;
  readonly sessionHandle?: PlanSessionHandle;
  /** A CLI session created by Ptah; readers must never discover sessions. */
  readonly cliSessionId?: string;
}

/** Everything one reader call gets. */
export interface PlanUsageReadRequest {
  readonly target: PlanOwnerTarget;
  /** Resolved from `target.credentialRef` for this call only; never kept. */
  readonly credential?: PlanSecret;
  readonly refresh: boolean;
  /**
   * Local CLI accounting range expressed as OpenCode's `--days` value.
   * `0` means today. Omitted leaves the CLI's default aggregation intact.
   */
  readonly localUsageDays?: number;
  readonly signal?: AbortSignal;
}

/**
 * What a reader reports for its owner. The service adds the owner, ledger
 * evidence (`ownerEvidence`, `cooldown`) and the stale rule (`staleSince`).
 * Window instants keep the time they were observed at the source, never the
 * time they were re-served.
 */
export type PlanUsageReading = Omit<
  PlanLimitOwnerSnapshot,
  'owner' | 'ownerEvidence' | 'cooldown' | 'staleSince'
>;

/** Reads one provider's plan usage. A throw maps to `service-unavailable`. */
export type PlanUsageReader = (
  request: PlanUsageReadRequest,
) => Promise<PlanUsageReading>;
