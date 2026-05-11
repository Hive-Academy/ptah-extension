/**
 * Zod schemas for {@link ProviderRpcHandlers}.
 *
 * Extracted from `provider-rpc.handlers.ts` (TASK_2025_294 W2.B2) so the
 * schemas can be unit-tested in isolation without spinning up the full
 * handler surface, and so call-site code stays focused on RPC plumbing
 * rather than validation shape.
 *
 * IMPORTANT — extraction contract:
 *   - The parse behaviour here MUST match the inline `z.object({...})`
 *     literals that previously lived inside `registerListModels()`,
 *     `registerSetModelTier()`, `registerGetModelTiers()`, and
 *     `registerClearModelTier()`. Any valid payload that parsed before MUST
 *     still parse; any invalid payload that was rejected before MUST still
 *     be rejected with an equivalent error shape.
 *   - `tier` is a `z.enum(['sonnet', 'opus', 'haiku'])` — the three tiers
 *     the Anthropic-compatible provider registry exposes. Unknown tiers are
 *     rejected at the RPC boundary.
 *   - `providerId` is `z.string().optional()` on every schema; the handler
 *     falls back to the persisted `anthropicProviderId` config value when
 *     it's absent (see `resolveProviderId()` in the handler).
 */

import { z } from 'zod';

/**
 * Validated shape for the `provider:listModels` RPC method.
 *
 * Fields:
 *   - `toolUseOnly` — optional filter that asks the registry to drop models
 *     without tool-use support. Defaults to `false` when omitted.
 *   - `providerId`  — optional override for the provider to list models
 *     for. Falls back to the persisted `anthropicProviderId` when absent.
 */
export const ProviderListModelsSchema = z.object({
  toolUseOnly: z.boolean().optional(),
  providerId: z.string().optional(),
});

export type ProviderListModelsInput = z.infer<typeof ProviderListModelsSchema>;

/**
 * Validated shape for the `provider:setModelTier` RPC method.
 *
 * Fields:
 *   - `tier`       — required tier slot (`sonnet` / `opus` / `haiku`).
 *   - `modelId`    — required non-empty model identifier (e.g.
 *                    `anthropic/claude-3.5-sonnet`).
 *   - `providerId` — optional override for the provider to map this tier
 *                    against. Falls back to persisted config.
 *   - `scope`      — required scope: `mainAgent` (mutates globals) or
 *                    `cliAgent` (persists only, no global side-effects).
 */
export const ProviderSetModelTierSchema = z.object({
  tier: z.enum(['sonnet', 'opus', 'haiku']),
  modelId: z.string().min(1),
  providerId: z.string().optional(),
  scope: z.enum(['mainAgent', 'cliAgent']),
});

export type ProviderSetModelTierInput = z.infer<
  typeof ProviderSetModelTierSchema
>;

/**
 * Validated shape for the `provider:getModelTiers` RPC method.
 *
 * Fields:
 *   - `providerId` — optional override for which provider's tier mapping to
 *                    return. Falls back to persisted config.
 *   - `scope`      — required scope: `mainAgent` or `cliAgent`.
 */
export const ProviderGetModelTiersSchema = z.object({
  providerId: z.string().optional(),
  scope: z.enum(['mainAgent', 'cliAgent']),
});

export type ProviderGetModelTiersInput = z.infer<
  typeof ProviderGetModelTiersSchema
>;

/**
 * Validated shape for the `provider:clearModelTier` RPC method.
 *
 * Fields:
 *   - `tier`       — required tier slot to clear (`sonnet` / `opus` /
 *                    `haiku`).
 *   - `providerId` — optional override for which provider's tier to clear.
 *                    Falls back to persisted config.
 *   - `scope`      — required scope: `mainAgent` (also clears the global
 *                    env var) or `cliAgent` (config only).
 */
export const ProviderClearModelTierSchema = z.object({
  tier: z.enum(['sonnet', 'opus', 'haiku']),
  providerId: z.string().optional(),
  scope: z.enum(['mainAgent', 'cliAgent']),
});

export type ProviderClearModelTierInput = z.infer<
  typeof ProviderClearModelTierSchema
>;
