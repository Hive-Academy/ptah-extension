/**
 * One network back-off per PROVIDER a skill-synthesis call rides — TASK_2026_437
 * C14 (f).
 *
 * Lanes may name different providers (`skillSynthesis.<lane>.provider`,
 * resolved per lane by `LaneResolverService`). A single back-off for the whole
 * library let a success on a healthy provider clear the window of a provider
 * that was still down, so the next background call dispatched straight back
 * into the dead endpoint. Keying by provider keeps each outage's window its
 * own.
 *
 * The key is the lane's configured provider id, trimmed. `''` is "the active
 * provider" — every lane that inherits, and `SkillEnhancerService`, which is not
 * a lane and always rides the ambient auth env. With no lane provider configured
 * (every install that never opened the Lanes panel) there is exactly one key,
 * and the behaviour is that of one back-off.
 *
 * A wrapper rather than a change to agent-sdk's `NetworkBackoff`: that class
 * stays one window, and the memory curator — one provider path — keeps using it
 * unkeyed.
 */
import {
  NetworkBackoff,
  type NetworkBackoffOptions,
} from '@ptah-extension/agent-sdk';

/** The provider key for a call that rides the active provider. */
export const ACTIVE_PROVIDER_KEY = '';

export class ProviderNetworkBackoffs {
  private readonly byProvider = new Map<string, NetworkBackoff>();

  constructor(private readonly options: NetworkBackoffOptions) {}

  /** Normalise a lane's configured provider id into a key. */
  static keyFor(provider: string | undefined): string {
    return (provider ?? ACTIVE_PROVIDER_KEY).trim();
  }

  /** The back-off for `providerKey`, created on first use. */
  for(providerKey: string): NetworkBackoff {
    const key = ProviderNetworkBackoffs.keyFor(providerKey);
    let backoff = this.byProvider.get(key);
    if (!backoff) {
      backoff = new NetworkBackoff({
        ...this.options,
        logPrefix: `${this.options.logPrefix} [provider ${key || 'active'}]`,
      });
      this.byProvider.set(key, backoff);
    }
    return backoff;
  }

  /** Milliseconds `providerKey`'s window stays open; `0` for a provider never seen. */
  remainingMs(providerKey: string): number {
    return (
      this.byProvider
        .get(ProviderNetworkBackoffs.keyFor(providerKey))
        ?.remainingMs() ?? 0
    );
  }

  /** Whether EVERY key in `providerKeys` has an open window. `false` for none. */
  allDeferring(providerKeys: Iterable<string>): boolean {
    let any = false;
    for (const key of providerKeys) {
      any = true;
      if (this.remainingMs(key) <= 0) return false;
    }
    return any;
  }
}
