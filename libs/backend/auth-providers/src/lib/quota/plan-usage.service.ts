/**
 * PlanUsageService — one `PlanLimitOwnerSnapshot` per quota owner, from the
 * best source for that owner, merged with the ledger's evidence
 * (TASK_2026_596, Component 6; Req 2.2-2.10).
 *
 * ## Dispatch
 *
 * A plain record of reader functions keyed by normalised provider id:
 * `anthropic` (Claude `/usage` through the session probe) and `openai-codex`
 * (the App Server account read). OpenCode (`opencode`, `opencode-go`,
 * `opencode-zen`) has no proactive source and answers `no-usage-source`
 * (Req 2.6, 2.8); every other provider answers `provider-unsupported`.
 *
 * ## Credentials
 *
 * A target names where its secret lives (`credentialRef`), never the secret.
 * It is read through `PlanCredentialSource.resolve` just before the one reader
 * call and handed over as a `PlanSecret`; only the reader's request reveals
 * it. An unavailable credential maps straight to its status. Nothing here
 * stores, logs or returns it (F71). No-source providers never read one.
 *
 * ## Cache, single flight, cancellation
 *
 * - 30 s per owner, keyed by owner key. A changed account or key is a new
 *   owner key, so an old owner's data is never served for a new one (Req 4.3).
 * - One read per owner at a time; concurrent callers join it. Each caller's
 *   `AbortSignal` ends only that caller's wait. The read itself is cancelled
 *   once every caller that could cancel it has, and no caller without a
 *   signal is waiting.
 *
 * ## Stale rule (Req 2.9)
 *
 * Only a transient failure (a thrown reader, an unparseable response, an
 * unreadable secret store, a source's own stale answer) for the same owner
 * key re-serves that owner's last `available` reading, as `stale` with
 * `staleSince` = the first failure. Its windows keep their original
 * observation time and are given to the ledger with `{stale:true}`, which
 * never lets them clear live evidence. Eligibility and configuration
 * statuses replace the cached reading and carry no windows. With no open
 * Claude session the stream-event evidence is returned as is (Req 2.2).
 *
 * One owner's failure never touches another owner's cache or snapshot.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type {
  PlanLimitOwnerSnapshot,
  ProviderAccountUsageStatus,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { PlanLimitLedgerService } from './plan-limit-ledger.service';
import type {
  PlanCredentialSource,
  PlanSecret,
} from './plan-credential.source';
import { normaliseOwnerProviderId } from './provider-owner.resolver';
import {
  createClaudePlanUsageReader,
  type ClaudePlanUsageProbe,
} from './readers/claude-plan-usage.reader';
import {
  createCodexPlanUsageReader,
  type CodexPlanUsageSource,
} from './readers/codex-plan-usage.reader';
import { createAntigravityPlanUsageReader } from './readers/antigravity-plan-usage.reader';
import { createOllamaCloudPlanUsageReader } from './readers/ollama-cloud-plan-usage.reader';
import type {
  PlanOwnerTarget,
  PlanUsageReader,
  PlanUsageReading,
} from './readers/plan-usage-reader.types';

/** Per-owner reading cache lifetime; the same as the Codex account cache. */
export const PLAN_USAGE_CACHE_TTL_MS = 30_000;

/** Providers that have an owner but no source reporting its limits. */
const NO_USAGE_SOURCE_PROVIDERS: ReadonlySet<string> = new Set([
  'opencode',
  'opencode-go',
  'opencode-zen',
]);

/** The owner cannot be read at all; such a snapshot carries no windows. */
const ELIGIBILITY_STATUSES: ReadonlySet<ProviderAccountUsageStatus> = new Set([
  'unsupported-auth',
  'unsupported-config',
  'provider-unsupported',
  'cli-unavailable',
  'cli-version-unsupported',
]);

/** The ledger surface the service reads and feeds. */
export type PlanUsageLedger = Pick<
  PlanLimitLedgerService,
  'snapshotFor' | 'recordWindowEvidence'
>;
/** The credential surface the service reads secrets through. */
export type PlanUsageCredentials = Pick<PlanCredentialSource, 'resolve'>;

export interface PlanUsageRequestOptions {
  /** Skip the 30 s cache (an in-flight read is still joined). */
  readonly refresh?: boolean;
  /** Ends this caller's wait with an `AbortError`. */
  readonly signal?: AbortSignal;
}

interface CachedReading {
  readonly reading: PlanUsageReading;
  readonly readAt: number;
}

interface Flight {
  readonly key: string;
  readonly promise: Promise<PlanLimitOwnerSnapshot>;
  readonly controller: AbortController;
  /** Callers with a signal still waiting. */
  cancellable: number;
  /** A caller without a signal joined, so the read is never cancelled. */
  pinned: boolean;
}

@injectable()
export class PlanUsageService {
  private readonly readers: Readonly<Record<string, PlanUsageReader>>;
  private readonly cache = new Map<string, CachedReading>();
  private readonly failingSince = new Map<string, number>();
  private readonly flights = new Map<string, Flight>();

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(AUTH_PROVIDERS_TOKENS.PLAN_LIMIT_LEDGER)
    private readonly ledger: PlanUsageLedger,
    @inject(AUTH_PROVIDERS_TOKENS.PLAN_CREDENTIAL_SOURCE)
    private readonly credentials: PlanUsageCredentials,
    @inject(SDK_TOKENS.SDK_SESSION_QUOTA_PROBE)
    probe: ClaudePlanUsageProbe,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_CODEX_ACCOUNT_USAGE)
    codexUsage: CodexPlanUsageSource,
    /** Test seam; the DI factory leaves the default. */
    private readonly now: () => number = Date.now,
  ) {
    this.readers = {
      anthropic: createClaudePlanUsageReader(probe, logger, now),
      'openai-codex': createCodexPlanUsageReader(codexUsage, now),
      'ollama-cloud': createOllamaCloudPlanUsageReader(logger, now),
      antigravity: createAntigravityPlanUsageReader(logger, now),
    };
  }

  /**
   * The owner's snapshot. Never rejects, except with an `AbortError` when
   * the caller's signal fires first.
   */
  getOwnerSnapshot(
    target: PlanOwnerTarget,
    options: PlanUsageRequestOptions = {},
  ): Promise<PlanLimitOwnerSnapshot> {
    const { signal } = options;
    if (signal?.aborted) return Promise.reject(abortError());
    const key = target.ownerRef.key;
    const cached = this.cache.get(key);
    if (
      !options.refresh &&
      cached &&
      this.now() - cached.readAt < PLAN_USAGE_CACHE_TTL_MS
    ) {
      return Promise.resolve(this.assemble(target.ownerRef, cached.reading));
    }
    const flight =
      this.flights.get(key) ??
      this.startFlight(target, options.refresh === true);
    return this.join(flight, signal);
  }

  // ------------------------------------------------------- single flight

  private startFlight(target: PlanOwnerTarget, refresh: boolean): Flight {
    const controller = new AbortController();
    const read = this.read(target, refresh, controller.signal);
    const flight: Flight = {
      key: target.ownerRef.key,
      controller,
      cancellable: 0,
      pinned: false,
      promise: read.finally(() => this.release(flight)),
    };
    this.flights.set(flight.key, flight);
    return flight;
  }

  /** Forget a settled or cancelled flight; a newer one for the owner stays. */
  private release(flight: Flight): void {
    if (this.flights.get(flight.key) === flight)
      this.flights.delete(flight.key);
  }

  private join(
    flight: Flight,
    signal: AbortSignal | undefined,
  ): Promise<PlanLimitOwnerSnapshot> {
    if (!signal) {
      flight.pinned = true;
      return flight.promise;
    }
    flight.cancellable += 1;
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (settle: () => void) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', onAbort);
        settle();
      };
      const onAbort = () =>
        finish(() => {
          flight.cancellable -= 1;
          if (flight.cancellable === 0 && !flight.pinned) {
            // A caller arriving now starts a fresh read, not this doomed one.
            this.release(flight);
            flight.controller.abort();
          }
          reject(abortError());
        });
      signal.addEventListener('abort', onAbort, { once: true });
      flight.promise.then(
        (snapshot) => finish(() => resolve(snapshot)),
        (error: unknown) => finish(() => reject(error)),
      );
    });
  }

  // ---------------------------------------------------------------- reads

  private async read(
    target: PlanOwnerTarget,
    refresh: boolean,
    signal: AbortSignal,
  ): Promise<PlanLimitOwnerSnapshot> {
    const owner = target.ownerRef;
    const providerId = normaliseOwnerProviderId(target.providerId);
    if (NO_USAGE_SOURCE_PROVIDERS.has(providerId)) {
      return this.settle(owner, statusOnly('no-usage-source'));
    }
    const reader = this.readers[providerId];
    if (!reader) return this.settle(owner, statusOnly('provider-unsupported'));

    let credential: PlanSecret | undefined;
    if (target.credentialRef) {
      const resolution = await this.credentials.resolve(target.credentialRef);
      if (resolution.kind === 'unavailable') {
        return this.settle(owner, statusOnly(resolution.status));
      }
      credential = resolution.secret;
    }

    let reading: PlanUsageReading;
    try {
      reading = await reader({
        target,
        refresh,
        signal,
        ...(credential && { credential }),
      });
    } catch (error: unknown) {
      if (signal.aborted) throw abortError();
      // The error text may quote a response body; only its kind is kept.
      this.logger.debug('[PlanUsage] reader failed', {
        providerId,
        reason: errorKind(error),
      });
      return this.settle(owner, statusOnly('service-unavailable'));
    }
    // A failure caused by the cancellation itself is not the owner's state.
    if (signal.aborted && reading.status !== 'available') throw abortError();
    return this.settle(owner, reading);
  }

  /** Apply the cache and stale rules to one reading. */
  private settle(
    owner: QuotaOwnerRef,
    reading: PlanUsageReading,
  ): PlanLimitOwnerSnapshot {
    const key = owner.key;
    if (isTransientFailure(reading)) {
      const since = this.failingSince.get(key) ?? this.now();
      this.failingSince.set(key, since);
      const cached = this.cache.get(key)?.reading;
      const staleFrom =
        reading.status === 'stale'
          ? reading
          : cached?.status === 'available'
            ? cached
            : undefined;
      if (!staleFrom) return this.assemble(owner, reading);
      for (const window of staleFrom.windows) {
        this.ledger.recordWindowEvidence(owner, window, { stale: true });
      }
      return this.assemble(owner, { ...staleFrom, status: 'stale' }, since);
    }
    this.failingSince.delete(key);
    // No open session says nothing about the owner; the next read retries.
    if (reading.unavailableReason !== 'no-open-session') {
      this.cache.set(key, { reading, readAt: this.now() });
    }
    if (reading.status === 'available') {
      for (const window of reading.windows) {
        this.ledger.recordWindowEvidence(owner, window);
      }
    }
    return this.assemble(owner, reading);
  }

  /**
   * The snapshot: the reading's status and metadata, and the ledger's merged
   * windows (the reading's own, recorded above, plus stream, error and proxy
   * evidence), owner evidence and cooldown.
   */
  private assemble(
    owner: QuotaOwnerRef,
    reading: PlanUsageReading,
    staleSince?: number,
  ): PlanLimitOwnerSnapshot {
    const evidence = this.ledger.snapshotFor(owner.key);
    const ineligible = ELIGIBILITY_STATUSES.has(reading.status);
    return {
      owner,
      status: reading.status,
      ...(reading.fetchedAt !== undefined && { fetchedAt: reading.fetchedAt }),
      ...(staleSince !== undefined && { staleSince }),
      windowSetEstablished: !ineligible && reading.windowSetEstablished,
      windows: ineligible ? [] : (evidence?.windows ?? []),
      ownerEvidence: evidence?.ownerEvidence ?? [],
      ...(evidence?.cooldown && { cooldown: evidence.cooldown }),
      ...(reading.account && { account: reading.account }),
      ...(reading.activity && { activity: reading.activity }),
      ...(reading.unavailableReason && {
        unavailableReason: reading.unavailableReason,
      }),
    };
  }
}

/**
 * A read that failed for a reason that may pass on its own: a source's own
 * stale answer, or `service-unavailable` other than "no open session".
 */
function isTransientFailure(reading: PlanUsageReading): boolean {
  if (reading.status === 'stale') return true;
  return (
    reading.status === 'service-unavailable' &&
    reading.unavailableReason !== 'no-open-session'
  );
}

function statusOnly(status: ProviderAccountUsageStatus): PlanUsageReading {
  return { status, windowSetEstablished: false, windows: [] };
}

function abortError(): Error {
  const error = new Error('The operation was aborted');
  error.name = 'AbortError';
  return error;
}

function errorKind(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
