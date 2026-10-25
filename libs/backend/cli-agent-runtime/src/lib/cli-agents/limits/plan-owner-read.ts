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
import {
  snapshotWindowsForStatus,
  type PlanLimitLedgerService,
  type PlanOwnerTarget,
} from '@ptah-extension/auth-providers';
import type { ClaudeAccountNamedRoute } from '@ptah-extension/auth-providers-tokens';
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
  /**
   * The certified named route that session was admitted on. With it the read
   * asks only a query whose immutable binding and auth epoch match; without a
   * session it is never read (no other query may stand in).
   */
  readonly claudeRoute?: ClaudeAccountNamedRoute;
  /** The Ptah CLI agent whose own key (or sign-in) an Ollama Cloud read uses. */
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

/** A Claude owner with no matching live query: listed, never read. */
export const NO_OPEN_SESSION: {
  readonly kind: 'known';
} & PlanOwnerKnownStatus = {
  kind: 'known',
  status: 'service-unavailable',
  unavailableReason: 'no-open-session',
};

/** The immutable launch binding a session record carries; no directory. */
export interface PlanOwnerSourceBinding {
  readonly provider: string;
  readonly routeFingerprint: string;
  readonly routeRevision: number;
  readonly authEpoch: number;
}

/**
 * Route material for a Claude owner whose identity is not proved on a named
 * source. It names the source (route, revision, epoch) and the run or session
 * the read was for, so an unknown owner is never shared with another route or
 * run, and a later epoch is a different unknown owner.
 */
export function namedSourceMaterial(
  source: PlanOwnerSourceBinding,
  run: string,
): string {
  return JSON.stringify([
    source.provider,
    source.routeFingerprint,
    source.routeRevision,
    source.authEpoch,
    run,
  ]);
}

/** Whether two bindings name the same immutable source and auth epoch. */
export function sameSourceBinding(
  a: PlanOwnerSourceBinding | undefined,
  b: PlanOwnerSourceBinding | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.provider === b.provider &&
    a.routeFingerprint === b.routeFingerprint &&
    a.routeRevision === b.routeRevision &&
    a.authEpoch === b.authEpoch
  );
}

/** In-scope providers whose read needs no secret of Ptah's. */
const KEYLESS_READ_PROVIDERS: ReadonlySet<string> = new Set([
  'openai-codex',
  'antigravity',
  'opencode',
  'opencode-go',
  'opencode-zen',
  'grok',
]);

/**
 * How `owner` is read, or `null` for a provider outside the plan-limit scope.
 *
 * - Claude on an API key has no plan windows: `unsupported-auth`, no read.
 * - Any other Claude owner is read only through the session it was read
 *   for. Without that session the probe would answer with whichever native
 *   session is active, which may be another account, so the owner reads as
 *   "no open session" instead. A named account's read also carries the
 *   certified route, so the reader asks only the query bound to that route
 *   and epoch.
 * - Ollama Cloud reads a Ptah CLI lane through the agent's own key when it
 *   holds a real one, else through the shared `ollama-cloud` provider key (the
 *   ollama.com sign-in); the main route reads the provider key. A missing key
 *   becomes `unsupported-config` inside `PlanUsageService`, before any network
 *   call.
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
              ...(context.claudeRoute && {
                claudeRoute: { ...context.claudeRoute },
              }),
            },
          }
        : NO_OPEN_SESSION;
    case 'ollama-cloud':
      // A Ptah CLI lane reads with the agent's own key when it holds a real
      // one, else (empty slot or the ollama.com sign-in placeholder) with the
      // shared provider key — the rule `ownerForPtahCli` resolves the owner by,
      // so the key and the owner always match. The main route reads the
      // provider key.
      return {
        kind: 'read',
        target: {
          providerId: 'ollama-cloud',
          ownerRef: owner,
          credentialRef: context.ptahCliId
            ? { kind: 'ollama-cloud-agent-key', ptahCliId: context.ptahCliId }
            : { kind: 'provider-key', providerId: 'ollama-cloud' },
        },
      };
    case 'grok':
      return {
        kind: 'read',
        target: {
          providerId: 'grok',
          ownerRef: owner,
          ...(context.cliSessionId && { cliSessionId: context.cliSessionId }),
        },
      };
    default:
      return KEYLESS_READ_PROVIDERS.has(owner.providerId)
        ? {
            kind: 'read',
            target: { providerId: owner.providerId, ownerRef: owner },
          }
        : null;
  }
}

/**
 * An owner's snapshot with no provider read: the given status plus the
 * ledger's evidence. Its windows follow `snapshotWindowsForStatus`, as in
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
    windows: snapshotWindowsForStatus(known.status, evidence?.windows ?? []),
    ownerEvidence: evidence?.ownerEvidence ?? [],
    ...(evidence?.cooldown && { cooldown: evidence.cooldown }),
    ...(known.unavailableReason && {
      unavailableReason: known.unavailableReason,
    }),
  };
}
