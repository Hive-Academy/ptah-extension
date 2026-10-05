/**
 * PlanCredentialSource — the one place a plan-usage read gets a secret
 * (TASK_2026_596, Component 6 credential boundary; Revision 2 finding 4).
 *
 * A `PlanCredentialRef` names WHERE a secret lives, never the secret. This
 * source reads it at call time from the same slots the auth strategies use:
 *
 * - `{kind:'provider-key', providerId}` → `getProviderKey(providerId)`. The
 *   main-session Ollama Cloud key is `getProviderKey('ollama-cloud')`
 *   (`local-native.strategy.ts`, `configureCloudDirect`), the proxy providers'
 *   keys `getProviderKey(providerId)` (`api-key.strategy.ts`,
 *   `configureProxyProvider`).
 * - `{kind:'ptah-cli-key', ptahCliId}` → `getProviderKey('ptahCli.<id>')`.
 *
 * Nothing is cached: every call reads the store again, so a changed key is
 * seen on the next read (Req 4.3). The secret comes back wrapped in a
 * {@link PlanSecret}, whose JSON, string and inspect forms are redacted, so an
 * accidental log line or serialized result cannot carry it (F71). The secret
 * is meant for one reader call and is never stored by this source.
 */
import { inject, injectable } from 'tsyringe';
import {
  TOKENS,
  type IAuthSecretsService,
  type Logger,
} from '@ptah-extension/vscode-core';
import {
  isPlaceholderCredential,
  normaliseOwnerProviderId,
  ptahCliKeySlot,
} from './provider-owner.resolver';
import type { PlanCredentialRef } from './readers/plan-usage-reader.types';

const REDACTED = '[redacted]';

/**
 * A secret held in memory for one reader call. Only {@link reveal} returns
 * the value; every other way of turning the object into text is redacted.
 */
export class PlanSecret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  /** The secret itself. Pass it straight to the request that needs it. */
  reveal(): string {
    return this.#value;
  }

  toJSON(): string {
    return REDACTED;
  }

  toString(): string {
    return REDACTED;
  }

  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}

/**
 * Why no secret is available, as the plan-usage status it maps to:
 *
 * - `unsupported-config` — no key is stored (Ollama Cloud with no key).
 * - `unsupported-auth` — a placeholder is stored (a local daemon owns auth).
 * - `service-unavailable` — the secret store could not be read.
 */
export type PlanCredentialUnavailableStatus =
  'unsupported-config' | 'unsupported-auth' | 'service-unavailable';

export type PlanCredentialResolution =
  | { readonly kind: 'available'; readonly secret: PlanSecret }
  | {
      readonly kind: 'unavailable';
      readonly status: PlanCredentialUnavailableStatus;
    };

@injectable()
export class PlanCredentialSource {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private readonly authSecrets: IAuthSecretsService,
  ) {}

  /** Read the referenced secret now. Never throws, never caches. */
  async resolve(ref: PlanCredentialRef): Promise<PlanCredentialResolution> {
    const slot =
      ref.kind === 'provider-key'
        ? ref.providerId
        : ptahCliKeySlot(ref.ptahCliId);
    let raw: string | undefined;
    try {
      raw = await this.authSecrets.getProviderKey(slot);
    } catch {
      // The store's error text may quote the slot's contents; only the
      // reference kind and a normalised id are kept.
      this.logger.debug('[PlanCredentialSource] secret read failed', {
        refKind: ref.kind,
        id: normaliseOwnerProviderId(
          ref.kind === 'provider-key' ? ref.providerId : ref.ptahCliId,
        ),
      });
      return { kind: 'unavailable', status: 'service-unavailable' };
    }
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value.length === 0) {
      return { kind: 'unavailable', status: 'unsupported-config' };
    }
    if (isPlaceholderCredential(value)) {
      return { kind: 'unavailable', status: 'unsupported-auth' };
    }
    return { kind: 'available', secret: new PlanSecret(value) };
  }
}
