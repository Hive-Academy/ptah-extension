/**
 * How one quota owner's limits are read (TASK_2026_596, Components 10 and
 * 10b). The lane lookup and owner discovery both go through these two
 * functions, so a lane and a dashboard card for the same owner are read the
 * same way.
 *
 * A target never carries a secret. It names where one lives
 * (`credentialRef`), and `PlanUsageService` resolves that just before its one
 * reader call. Providers outside the plan-limit scope have no plan here.
 */
import type {
  PlanLimitLedgerService,
  PlanOwnerTarget,
} from '@ptah-extension/auth-providers';
import type {
  PlanLimitOwnerSnapshot,
  PlanLimitUnavailableReason,
  ProviderAccountUsageStatus,
  QuotaOwnerRef,
} from '@ptah-extension/shared';

/** The ledger read a snapshot built without a provider read needs. */
export type PlanOwnerLedgerReader = Pick<PlanLimitLedgerService, 'snapshotFor'>;

/** Where the owner's read comes from. */
export interface PlanOwnerReadContext {
  /** The live session whose query a Claude read must ask. */
  readonly sessionId?: string;
  /** The Ptah CLI agent whose stored key an Ollama Cloud read uses. */
  readonly ptahCliId?: string;
  /** Grok CLI session id recorded when Ptah started the lane. */
  readonly cliSessionId?: string;
}

/** A status that is known without asking the provider. */
export interface PlanOwnerKnownStatus {
  readonly status: ProviderAccountUsageStatus;
  readonly unavailableReason?: PlanLimitUnavailableReason;
}

export type PlanOwnerReadPlan =
  | { readonly kind: 'read'; readonly target: PlanOwnerTarget }
  | ({ readonly kind: 'known' } & PlanOwnerKnownStatus);

/** In-scope providers whose read needs no secret of Ptah's. */
const KEYLESS_READ_PROVIDERS: ReadonlySet<string> = new Set([
  'openai-codex',
  'antigravity',
  'opencode',
  'opencode-go',
  'opencode-zen',
  'grok',
]);

/** Statuses after which no window of the owner applies. */
const INELIGIBLE_STATUSES: ReadonlySet<ProviderAccountUsageStatus> = new Set([
  'unsupported-auth',
  'unsupported-config',
  'provider-unsupported',
]);

/**
 * How `owner` is read, or `null` for a provider outside the plan-limit scope.
 *
 * - Claude on an API key has no plan windows: `unsupported-auth`, no read.
 * - Any other Claude owner is read only through the session it was read
 *   for. Without that session the probe would answer with whichever native
 *   session is active, which may be another account, so the owner reads as
 *   "no open session" instead.
 * - Ollama Cloud reads the agent's own key for a Ptah CLI lane, else the
 *   provider key. A missing key or a placeholder becomes `unsupported-config`
 *   or `unsupported-auth` inside `PlanUsageService`, before any network call.
 * - Codex, Antigravity and OpenCode read without a Ptah secret.
 */
export function planOwnerRead(
  owner: QuotaOwnerRef,
  context: PlanOwnerReadContext = {},
): PlanOwnerReadPlan | null {
  switch (owner.providerId) {
    case 'anthropic':
      if (owner.identityKind === 'credential') {
        return { kind: 'known', status: 'unsupported-auth' };
      }
      return context.sessionId
        ? {
            kind: 'read',
            target: {
              providerId: 'anthropic',
              ownerRef: owner,
              sessionHandle: { kind: 'session', sessionId: context.sessionId },
            },
          }
        : {
            kind: 'known',
            status: 'service-unavailable',
            unavailableReason: 'no-open-session',
          };
    case 'ollama-cloud':
      return {
        kind: 'read',
        target: {
          providerId: 'ollama-cloud',
          ownerRef: owner,
          credentialRef: context.ptahCliId
            ? { kind: 'ptah-cli-key', ptahCliId: context.ptahCliId }
            : { kind: 'provider-key', providerId: 'ollama-cloud' },
        },
      };
    case 'grok':
      return context.cliSessionId
        ? {
            kind: 'read',
            target: {
              providerId: 'grok',
              ownerRef: owner,
              cliSessionId: context.cliSessionId,
            },
          }
        : { kind: 'known', status: 'service-unavailable' };
    default:
      return KEYLESS_READ_PROVIDERS.has(owner.providerId)
        ? { kind: 'read', target: { providerId: owner.providerId, ownerRef: owner } }
        : null;
  }
}

/**
 * An owner's snapshot with no provider read: the given status plus the
 * ledger's evidence. An ineligible status carries no windows, as in
 * `PlanUsageService`; the window set is never established without a read.
 */
export function snapshotWithoutRead(
  owner: QuotaOwnerRef,
  known: PlanOwnerKnownStatus,
  ledger: PlanOwnerLedgerReader,
): PlanLimitOwnerSnapshot {
  const evidence = ledger.snapshotFor(owner.key);
  return {
    owner,
    status: known.status,
    windowSetEstablished: false,
    windows: INELIGIBLE_STATUSES.has(known.status)
      ? []
      : (evidence?.windows ?? []),
    ownerEvidence: evidence?.ownerEvidence ?? [],
    ...(evidence?.cooldown && { cooldown: evidence.cooldown }),
    ...(known.unavailableReason && {
      unavailableReason: known.unavailableReason,
    }),
  };
}
