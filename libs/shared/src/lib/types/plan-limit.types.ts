/**
 * Plan-limit contract (TASK_2026_596).
 *
 * The one data shape every layer reads for provider plan limits: which
 * windows an owner has, how much of each is used, when each resets, and where
 * every value came from. Plain types only — this file stays zod-free like the
 * rest of the shared barrel; boundary validation lives in the backend libs.
 *
 * Instants are epoch milliseconds, UTC. An absent value means "unknown": a
 * missing `used` is never 0 and a missing `resetsAt` is never invented.
 *
 * No field here is a credential or a credential reference. An owner is named
 * only by its opaque hashed key and a generic label.
 *
 * `import type` from `rpc-providers.types` is a type-only cycle (that file
 * references the owner and window types below); it is erased at runtime.
 */
import type {
  ProviderAccountUsageStatus,
  ProviderGetAccountUsageResult,
} from './rpc/rpc-providers.types';

/**
 * Provenance of one value.
 *
 * - `provider-api` — a documented or vendor-typed provider source.
 * - `provider-unofficial` — an undocumented provider source.
 * - `stream-event` — a rate-limit event observed on a live stream.
 * - `error-derived` — parsed from a limit error (e.g. "try again at …").
 * - `estimated` — computed locally; never supersedes newer real evidence.
 */
export type PlanLimitSource =
  | 'provider-api'
  | 'provider-unofficial'
  | 'stream-event'
  | 'error-derived'
  | 'estimated';

/** The kind of allowance a window measures. */
export type PlanWindowKind =
  | 'five_hour'
  | 'weekly'
  | 'weekly_model'
  | 'monthly'
  | 'overage'
  | 'other';

/**
 * Stable window identity within one owner. `weekly_model:<scope>` carries the
 * model family the window applies to; `other:<label>` a provider-specific one.
 */
export type PlanWindowKey =
  | 'five_hour'
  | 'weekly'
  | `weekly_model:${string}`
  | 'monthly'
  | 'overage'
  | `other:${string}`;

/** How much of a window is used. Absent on the window when unknown. */
export type PlanLimitUsed =
  | { readonly kind: 'percent'; readonly percent: number }
  | {
      readonly kind: 'amount';
      readonly amount: number;
      readonly limit: number;
      readonly unit: string;
    };

/**
 * Evidence that an owner hit a limit, either on one window (`exhaustion`) or
 * at owner level when the window is not known (`ownerEvidence`).
 */
export interface OwnerLimitEvidence {
  readonly observedAt: number;
  readonly source: PlanLimitSource;
  /** Absent when the reset is unknown; the evidence then clears only by rule. */
  readonly resetsAt?: number;
  readonly resetSource?: PlanLimitSource;
  /** Model family the evidence applies to; absent when it covers every model. */
  readonly modelScope?: string;
}

/** One plan window, with a source per field. */
export interface PlanLimitWindow {
  readonly key: PlanWindowKey;
  readonly kind: PlanWindowKind;
  readonly label: string;
  readonly modelScope?: string;
  readonly durationMins?: number;
  readonly used?: PlanLimitUsed;
  readonly usedSource?: PlanLimitSource;
  readonly usedObservedAt?: number;
  /** Next reset. */
  readonly resetsAt?: number;
  readonly resetSource?: PlanLimitSource;
  /** Instant the current window began; absent when it cannot be determined. */
  readonly lastResetAt?: number;
  readonly exhaustion?: OwnerLimitEvidence;
  readonly observedAt: number;
}

/**
 * How an owner was identified.
 *
 * - `account` — a provider-verified account id.
 * - `credential` — an API key fingerprint.
 * - `cli-store` — the resolved credential store of a CLI.
 * - `unknown` — identity could not be determined. Never treated as shared
 *   with another owner, even when the keys are equal.
 */
export type QuotaOwnerIdentityKind =
  | 'account'
  | 'credential'
  | 'cli-store'
  | 'unknown';

/**
 * Minimal, non-secret reference to the owner of a quota. Persisted per run
 * (`CliSessionReference.quotaOwner`) and carried on live runs
 * (`AgentProcessInfo.quotaOwner`) in this same shape.
 */
export interface QuotaOwnerRef {
  /** Canonical hashed owner key: `<providerId>#<identityKind>:<fingerprint>`. */
  readonly key: string;
  readonly providerId: string;
  readonly identityKind: QuotaOwnerIdentityKind;
  /** Generic label such as "Claude account"; never an email or a key. */
  readonly label: string;
}

/** A provider-imposed wait (e.g. Retry-After) on one owner. */
export interface PlanLimitCooldown {
  readonly until: number;
  readonly observedAt: number;
  /** The deadline as the provider stated it, before any clamping. */
  readonly rawUntil?: number;
}

/** Why an owner's limits could not be read even though the route supports it. */
export type PlanLimitUnavailableReason = 'no-open-session';

/** Everything known about one owner's limits. */
export interface PlanLimitOwnerSnapshot {
  readonly owner: QuotaOwnerRef;
  readonly status: ProviderAccountUsageStatus;
  readonly fetchedAt?: number;
  readonly staleSince?: number;
  /** True once a full-table source declared this owner's window set. */
  readonly windowSetEstablished: boolean;
  readonly windows: readonly PlanLimitWindow[];
  readonly ownerEvidence: readonly OwnerLimitEvidence[];
  readonly cooldown?: PlanLimitCooldown;
  readonly account?: ProviderGetAccountUsageResult['account'];
  readonly activity?: ProviderGetAccountUsageResult['activity'];
  readonly unavailableReason?: PlanLimitUnavailableReason;
}

/** The owner and current model scope of one chat session. */
export interface PlanLimitSessionOwner {
  /** `null` while the session's owner is not yet resolved. */
  readonly ownerKey: string | null;
  readonly modelScope: string | null;
}

/**
 * Result of `provider:getPlanLimits` and payload of
 * `MESSAGE_TYPES.PLAN_LIMITS_CHANGED`.
 */
export interface PlanLimitsSnapshot {
  readonly generatedAt: number;
  readonly owners: readonly PlanLimitOwnerSnapshot[];
  /** Keyed by session id. */
  readonly sessionOwners: Readonly<Record<string, PlanLimitSessionOwner>>;
}
