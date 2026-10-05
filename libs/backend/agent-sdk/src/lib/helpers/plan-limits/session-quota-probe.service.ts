/**
 * SessionQuotaProbeService — gives the plan-limit readers access to a live
 * native Claude session's `Query` (TASK_2026_596, Component 4; Gate 2 G2).
 *
 * Three reads, all in process:
 *
 * - `readAccount(sessionId)` — `query.accountInfo()`. The result goes only to
 *   the owner resolver in `auth-providers`, which hashes it. It is never
 *   logged (presence flags only) and never serialized.
 * - `readPlanUsage(sessionId?)` — the experimental full `/usage` table, on
 *   demand only (RPC refresh, dashboard open, tool lookup). Never per turn.
 * - `sessionRoute(sessionId)` — which route the session runs on, read from the
 *   record's frozen `capacityRoute`. No credential and no fingerprint.
 *
 * ## Account cache (G2, AS1)
 *
 * There is no Claude account-change event (D4: `authFileChanged` is Codex
 * only, so the probe does not listen to it or to `configChanged`). Instead
 * the account is re-read once per turn:
 *
 * - The cache is keyed by the `Query` instance. A replaced query
 *   (`SessionRegistry.setSessionQuery`, or a restart that registers a new
 *   record) is a new key, so it never sees the old query's account.
 * - `turn-start` from `SessionPlanLimitCallbackRegistry` drops the entry and,
 *   on a native route, starts the next read without awaiting it. One read per
 *   turn, never per message, and nothing on the stream path waits for it.
 * - A `turnFailed` whose error is `authentication_failed`,
 *   `oauth_org_not_allowed`, `account_on_hold` or `cloud_credential_error`
 *   drops the entry. That event is the `StopFailure` hook carrying the
 *   assistant message's error field.
 *
 * Signals carry the SDK's real session id. The lookup still goes through
 * `SessionLifecycleManager.find`, which accepts either id for the same record
 * and therefore the same `Query`, so no re-keying on
 * `SessionIdResolvedCallbackRegistry` is needed.
 *
 * Every SDK call is bounded by a 3 s timeout and yields `null` on timeout,
 * rejection, a missing query or a query without the method. A failed read is
 * not cached, so the next caller tries again; a read in flight is shared.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import type { SessionId } from '@ptah-extension/shared';
import { SDK_TOKENS } from '../../di/tokens';
import type {
  AccountInfo,
  Query as SdkQuery,
  SDKAssistantMessageError,
} from '../../types/sdk-types/claude-sdk.types';
import type { SessionRecord } from '../session-lifecycle/session-registry.service';
import type {
  SdkAdapterEvents,
  SdkAdapterTurnFailedEvent,
} from '../sdk-adapter-events.service';
import type {
  SessionPlanLimitCallbackRegistry,
  SessionPlanLimitEvent,
} from './session-plan-limit-callback-registry';

/** Upper bound on every SDK control request the probe makes. */
export const SESSION_QUOTA_PROBE_TIMEOUT_MS = 3_000;

const USAGE_METHOD =
  'usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET' as const;

/** The SDK's `/usage` answer. `rate_limits_available` is false for API keys. */
export type ClaudePlanUsage = Awaited<
  ReturnType<SdkQuery[typeof USAGE_METHOD]>
>;

/**
 * - `native` — direct Anthropic route without an API key (subscription login).
 * - `direct-key` — direct Anthropic route with `ANTHROPIC_API_KEY`.
 * - `proxy` — any other base URL; `providerId` names it when known.
 * - `unknown` — the record carries no route.
 */
export type SessionQuotaRouteKind =
  'native' | 'proxy' | 'direct-key' | 'unknown';

export interface SessionQuotaRoute {
  readonly providerId: string | null;
  readonly routeKind: SessionQuotaRouteKind;
  /** Non-secret host parsed from ANTHROPIC_BASE_URL, when the record has one. */
  readonly baseUrlHost?: string;
}

/** What `auth-providers` consumes through `SDK_TOKENS.SDK_SESSION_QUOTA_PROBE`. */
export interface SessionQuotaProbe {
  /** `null` on timeout, rejection, unknown session or missing query. */
  readAccount(sessionId: string): Promise<AccountInfo | null>;
  /**
   * The given session's `/usage`, or with no id the most recently active
   * direct-Anthropic session's. `null` for a proxy route or on failure.
   */
  readPlanUsage(sessionId?: string): Promise<ClaudePlanUsage | null>;
  /** `null` when no session is registered under this id. */
  sessionRoute(sessionId: string): SessionQuotaRoute | null;
}

/** The two session lookups the probe needs from `SessionLifecycleManager`. */
export type QuotaProbeSessionSource = {
  find(idOrTabId: string): SessionRecord | undefined;
  getActiveSessionIds(): SessionId[];
};

type QuotaReadableQuery = Partial<
  Pick<SdkQuery, 'accountInfo' | typeof USAGE_METHOD>
>;

/** Assistant errors after which the cached account may no longer be valid. */
const ACCOUNT_INVALIDATING_ERRORS: ReadonlySet<SDKAssistantMessageError> =
  new Set<SDKAssistantMessageError>([
    'authentication_failed',
    'oauth_org_not_allowed',
    'account_on_hold',
    'cloud_credential_error',
  ]);

type ProbeFailure = 'timeout' | 'rejected';

class ProbeTimeoutError extends Error {
  constructor() {
    super('session quota probe timed out');
    this.name = 'ProbeTimeoutError';
  }
}

@injectable()
export class SessionQuotaProbeService implements SessionQuotaProbe {
  private readonly accountReads = new WeakMap<
    object,
    Promise<AccountInfo | null>
  >();
  private readonly disposers: Array<() => void>;

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SDK_TOKENS.SDK_SESSION_LIFECYCLE_MANAGER)
    private readonly sessions: QuotaProbeSessionSource,
    @inject(SDK_TOKENS.SDK_SESSION_PLAN_LIMIT_REGISTRY)
    planLimitRegistry: SessionPlanLimitCallbackRegistry,
    @inject(SDK_TOKENS.SDK_ADAPTER_EVENTS)
    adapterEvents: SdkAdapterEvents,
  ) {
    this.disposers = [
      planLimitRegistry.register((event) => this.onPlanLimitEvent(event)),
      adapterEvents.onTurnFailed((event) => this.onTurnFailed(event)),
    ];
  }

  readAccount(sessionId: string): Promise<AccountInfo | null> {
    const query = this.queryOf(sessionId);
    if (!query) return Promise.resolve(null);
    const cached = this.accountReads.get(query);
    if (cached) return cached;

    const read = this.callBounded(sessionId, 'accountInfo', () =>
      typeof query.accountInfo === 'function' ? query.accountInfo() : null,
    ).then((account) => {
      if (account === null && this.accountReads.get(query) === read) {
        this.accountReads.delete(query);
      }
      if (account !== null) {
        this.logger.debug('[SessionQuotaProbe] account read', {
          sessionId,
          hasEmail: Boolean(account.email),
          hasOrganization: Boolean(account.organization),
          hasSubscriptionType: Boolean(account.subscriptionType),
          hasApiKeySource: Boolean(account.apiKeySource),
        });
      }
      return account;
    });
    this.accountReads.set(query, read);
    return read;
  }

  async readPlanUsage(sessionId?: string): Promise<ClaudePlanUsage | null> {
    const targetId =
      sessionId ??
      this.sessions
        .getActiveSessionIds()
        .find((id) => this.isDirectAnthropic(id) && this.queryOf(id) !== null);
    if (targetId === undefined || !this.isDirectAnthropic(targetId)) {
      return null;
    }
    const query = this.queryOf(targetId);
    if (!query) return null;
    return this.callBounded(targetId, 'usage', () => {
      const usage = query[USAGE_METHOD];
      return typeof usage === 'function'
        ? usage.call(query, { skipBehaviors: true })
        : null;
    });
  }

  sessionRoute(sessionId: string): SessionQuotaRoute | null {
    const record = this.sessions.find(sessionId);
    if (!record) return null;
    const route = record.capacityRoute;
    if (!route) return { providerId: null, routeKind: 'unknown' };
    const baseUrlHost = hostFromBaseUrl(
      record.accountingAuthEnv.ANTHROPIC_BASE_URL,
    );
    if (route.kind === 'proxy') {
      return {
        providerId: route.providerId,
        routeKind: 'proxy',
        ...(baseUrlHost && { baseUrlHost }),
      };
    }
    // Same OAuth-vs-key test as `SdkModelService` (direct route, no API key).
    const hasApiKey = Boolean(
      record.accountingAuthEnv.ANTHROPIC_API_KEY?.trim(),
    );
    return {
      providerId: route.providerId,
      routeKind: hasApiKey ? 'direct-key' : 'native',
      ...(baseUrlHost && { baseUrlHost }),
    };
  }

  /** Release both subscriptions. */
  dispose(): void {
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  private onPlanLimitEvent({ sessionId, signal }: SessionPlanLimitEvent): void {
    if (signal.kind !== 'turn-start') return;
    this.dropAccount(sessionId);
    if (this.sessionRoute(sessionId)?.routeKind === 'native') {
      // The stream must not wait; report an unexpected read failure instead.
      void this.readAccount(sessionId).catch(() => {
        this.logger.debug(
          '[SessionQuotaProbe] turn-start account read failed',
          {
            sessionId,
          },
        );
      });
    }
  }

  private onTurnFailed(event: SdkAdapterTurnFailedEvent): void {
    if (ACCOUNT_INVALIDATING_ERRORS.has(event.error)) {
      this.dropAccount(event.sessionId);
    }
  }

  private dropAccount(sessionId: string): void {
    const query = this.queryOf(sessionId);
    if (query) this.accountReads.delete(query);
  }

  private isDirectAnthropic(sessionId: string): boolean {
    const kind = this.sessionRoute(sessionId)?.routeKind;
    return kind === 'native' || kind === 'direct-key';
  }

  /**
   * The live SDK query of a session. The registry stores it under Ptah's
   * structural `Query` mirror, which does not declare the two read methods; the
   * runtime object is the SDK's `Query`, and each call checks the method exists.
   */
  private queryOf(sessionId: string): (object & QuotaReadableQuery) | null {
    const query = this.sessions.find(sessionId)?.query;
    return query ? (query as object & QuotaReadableQuery) : null;
  }

  private async callBounded<T>(
    sessionId: string,
    operation: 'accountInfo' | 'usage',
    call: () => Promise<T> | null,
  ): Promise<T | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = call();
      if (pending === null) {
        this.logger.debug('[SessionQuotaProbe] query lacks the method', {
          sessionId,
          operation,
        });
        return null;
      }
      return await Promise.race([
        pending,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new ProbeTimeoutError()),
            SESSION_QUOTA_PROBE_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error: unknown) {
      // degradation-audit: reported - the failure kind is logged at debug (the
      // error text may echo account details) and the caller gets no quota
      // reading.
      const failure: ProbeFailure =
        error instanceof ProbeTimeoutError ? 'timeout' : 'rejected';
      // The error text is not logged: a control-request failure may echo
      // account details. The failure kind is enough to diagnose.
      this.logger.debug('[SessionQuotaProbe] read failed', {
        sessionId,
        operation,
        failure,
      });
      return null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

function hostFromBaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).hostname.toLowerCase();
  } catch {
    // degradation-audit: optional-capability - a base URL that does not parse
    // has no host; callers treat that as no host.
    return undefined;
  }
}
