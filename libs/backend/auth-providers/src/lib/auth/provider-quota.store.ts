/**
 * Which providers are currently rate-limited, and until when.
 *
 * ## Why this exists at all
 *
 * `TranslationProxyBase` already answers an upstream 429 correctly — it reads
 * `retry-after`, logs, and hands the caller a clean `rate_limit_error`. Nothing
 * consumed that signal. The Claude CLI subprocess absorbs the 429 and retries
 * internally, so a background lane only ever sees its own wall clock expire and
 * records an exhausted subscription as a `timeout`; every queued row then pays a
 * full lane timeout to rediscover the same dead endpoint. This store is the
 * missing shared fact: the proxy WRITES it on a 429 and
 * {@link ProviderAuthResolver} READS it before dispatch, so the second row is
 * gated for free.
 *
 * ## One instance, three unrelated readers/writers
 *
 * The six translation-proxy subclasses are separate objects (and two of them are
 * built per provider id at runtime, not by the container), and the resolver is a
 * third place again. A per-proxy field would therefore record a cooldown the
 * resolver could never see. {@link providerQuotaStore} is the process-wide
 * instance every one of them uses; `registerAuthProvidersServices` registers
 * THAT SAME OBJECT under
 * `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_QUOTA_STORE`, so an injected store and an
 * imported one are never two stores.
 *
 * ## Keyed by REGISTRY provider id, never by display name
 *
 * `TranslationProxyConfig.name` is a log label (`'Codex'`). The resolver resolves
 * registry ids (`'openai-codex'`), and a store keyed on the label would record
 * cooldowns nothing ever matches. That is why `TranslationProxyBase` grew an
 * abstract `getProviderId()` rather than a config field: two subclasses serve a
 * provider id that is only known at construction time.
 */

/** A recorded cooldown. `until` is an epoch-ms deadline. */
export interface ProviderQuotaState {
  readonly providerId: string;
  readonly until: number;
}

/**
 * How long a provider is gated when the upstream sent no `retry-after`.
 *
 * Deliberately shorter than `skill-synthesis`'s 30-minute `LANE_AUTH_RETRY_MS`:
 * quota refills on a clock, a misconfigured provider does not. Fifteen minutes
 * is short enough that a subscription which resets on the hour is picked up on
 * the next tick or two, and long enough that a whole boot-time queue does not
 * re-probe a dead endpoint. Every rate-limit line in the captured run was bare,
 * so this default is the normal case rather than the fallback.
 */
export const PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS = 15 * 60_000;

/** Floor for an honoured `retry-after`, so a `0` cannot disable the gate. */
const MIN_COOLDOWN_MS = 1_000;

/**
 * Ceiling for an honoured `retry-after`. A provider that asks for a week would
 * otherwise disable its own background work until the host restarts; the gate
 * re-arms on the next 429 anyway, so capping costs one extra upstream request.
 */
const MAX_COOLDOWN_MS = 6 * 60 * 60_000;

/**
 * `retry-after` is `delta-seconds` OR an HTTP-date (RFC 9110 §10.2.3). Node
 * hands headers back as `string | string[] | undefined`. Anything unparseable
 * yields `null`, and the caller falls back to
 * {@link PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS} — a bad header must never be the
 * reason a quota gate fails to arm.
 */
export function parseRetryAfterMs(
  header: string | string[] | undefined,
  now: number = Date.now(),
): number | null {
  const raw = (Array.isArray(header) ? header[0] : header)?.trim();
  if (!raw) return null;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? clampCooldown(seconds * 1_000) : null;
  }

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  const delta = at - now;
  return delta > 0 ? clampCooldown(delta) : null;
}

function clampCooldown(ms: number): number {
  return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, Math.round(ms)));
}

export class ProviderQuotaStore {
  /** provider id → epoch-ms deadline. Absent means "not gated". */
  private readonly cooldowns = new Map<string, number>();

  /**
   * Record a 429 against `providerId`.
   *
   * A later deadline always wins: two proxies for the same provider can be
   * in flight at once, and shortening a live cooldown because the second reply
   * carried no header would re-open the gate early.
   *
   * @param retryAfter the raw `retry-after` response header, if the upstream
   *   sent one. Absent is the normal case on this path.
   * @returns the state now in effect.
   */
  recordRateLimit(
    providerId: string,
    retryAfter?: string | string[] | undefined,
    now: number = Date.now(),
  ): ProviderQuotaState | null {
    const id = providerId.trim();
    if (id.length === 0) return null;
    const cooldownMs =
      parseRetryAfterMs(retryAfter, now) ?? PROVIDER_QUOTA_DEFAULT_COOLDOWN_MS;
    const until = Math.max(now + cooldownMs, this.cooldowns.get(id) ?? 0);
    this.cooldowns.set(id, until);
    return { providerId: id, until };
  }

  /**
   * Clear the gate because `providerId` just answered.
   *
   * Clearing on SUCCESS rather than only on expiry is the point: a subscription
   * that refills early would otherwise stay gated for the rest of the cooldown
   * even though the very next request would have worked. The cost of being
   * wrong in this direction is one extra upstream 429, which re-arms the gate.
   */
  recordSuccess(providerId: string): void {
    this.cooldowns.delete(providerId.trim());
  }

  /**
   * The live cooldown for `providerId`, or `null` when it is usable.
   *
   * Expired entries are evicted on read, so the map cannot accumulate one
   * dead key per provider the user has ever rate-limited.
   */
  cooldownFor(
    providerId: string,
    now: number = Date.now(),
  ): ProviderQuotaState | null {
    const id = providerId.trim();
    const until = this.cooldowns.get(id);
    if (until === undefined) return null;
    if (until <= now) {
      this.cooldowns.delete(id);
      return null;
    }
    return { providerId: id, until };
  }

  /** Milliseconds until `providerId` is usable again; `0` when it already is. */
  retryAfterMs(providerId: string, now: number = Date.now()): number {
    const state = this.cooldownFor(providerId, now);
    return state ? state.until - now : 0;
  }

  /** Test seam. Production never needs to forget every provider at once. */
  clear(): void {
    this.cooldowns.clear();
  }
}

/**
 * The process-wide store. Imported directly by `TranslationProxyBase` (whose
 * subclasses are not all container-built) and registered under
 * `AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_QUOTA_STORE` so DI consumers inject the
 * very same object.
 */
export const providerQuotaStore = new ProviderQuotaStore();
