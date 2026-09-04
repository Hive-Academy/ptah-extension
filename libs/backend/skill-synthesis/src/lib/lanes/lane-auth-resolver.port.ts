/**
 * Local structural mirror of agent-sdk's `IProviderAuthResolver`.
 *
 * Declared here rather than imported for the same reason `IInternalQuery` is
 * (`internal-query.interface.ts:1-9`): this library resolves the concrete
 * implementation by its globally-interned symbol at runtime and must not take
 * a type dependency that closes the `skill-synthesis → agent-sdk` cycle. The
 * real implementation lives a further lib away again (`auth-providers`), so
 * importing the port would drag the whole chain in for one signature.
 *
 * The mirror is narrower than the original in exactly one place, on purpose:
 * it returns {@link LaneAuthOverride}, whose `env` is
 * `Readonly<Record<string, string | undefined>>` rather than the `AuthEnv`
 * interface. `AuthEnv` enumerates the keys it knows about; a lane env also
 * carries whatever ambient `process.env` entries the resolver preserved, and —
 * critically — the stripped chat keys as present-but-`undefined` properties.
 * The index-signature shape is what keeps those describable. See risk R2 on
 * `LaneAuthOverride`.
 *
 * Kept in sync by the `scope` argument alone: a resolver that stopped honouring
 * `'lane'` would return the main-agent tier mapping, which the lane-resolver
 * specs assert against.
 */
import type { LaneAuthOverride } from './lane.types';

/**
 * Which persisted per-provider tier mapping to read. Mirrors
 * `ProviderTierScope` from `@ptah-extension/shared`; lanes always pass
 * `'lane'`, which reads `provider.<id>.lane.modelTier.<tier>` and — by
 * construction, not by discipline — writes no globals, because
 * `ProviderModelsService.setModelTier` guards its `process.env` /
 * `AuthEnv` writes with `scope === 'mainAgent'`.
 */
export type LaneTierScope = 'mainAgent' | 'cliAgent' | 'lane';

export interface ILaneAuthResolver {
  /**
   * @param providerId - Registry provider id, or `''` to ride the active
   *   provider. Never compared against a literal provider id.
   * @param scope - Which persisted tier mapping to read.
   * @returns `null` when the lane should ride the active provider — either
   *   nothing was requested, or the requested provider IS the active one.
   *   Throws (name `'ProviderAuthError'`) when a configured provider is
   *   unusable; the lane resolver turns that into an `auth-unresolvable`
   *   failure rather than a fallback. Throws (name `'ProviderQuotaError'`,
   *   carrying `retryAfterMs`) when the provider that would actually be dialled
   *   is still cooling down from an upstream 429 — including when this lane
   *   passed `''` and the ACTIVE provider is the exhausted one, which is the
   *   common case. That becomes `quota-exhausted`, again never a fallback.
   */
  resolve(
    providerId: string,
    scope?: LaneTierScope,
  ): Promise<LaneAuthOverride | null>;
}

/**
 * Matched by `name` rather than `instanceof` for the same reason the memory
 * curator adapter does it (`sdk-internal-query.curator-llm.ts:36-41`): the
 * error class lives in `auth-providers`, which depends on this side of the
 * graph. Kept in sync with `ProviderAuthError`'s constructor.
 */
export const PROVIDER_AUTH_ERROR_NAME = 'ProviderAuthError';

/**
 * Matched by `name` rather than `instanceof` for the same reason
 * {@link PROVIDER_AUTH_ERROR_NAME} is: `ProviderQuotaError` lives in
 * `auth-providers`, which depends on this side of the graph, so this library
 * cannot import the class and keeps ZERO direct SDK imports. Kept in sync with
 * `ProviderQuotaError`'s constructor — and with the identical mirror in
 * `agent-sdk`'s `sdk-internal-query.curator-llm.ts`, which the memory curator
 * reads. Duplicating the string across the two consumers is the design, not a
 * smell; sharing it would close the cycle the split exists to break.
 */
export const PROVIDER_QUOTA_ERROR_NAME = 'ProviderQuotaError';
