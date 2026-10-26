/**
 * Whether a send may keep the model stored for the active provider.
 *
 * The stored model is read from the ACTIVE workspace's provider slot, while a
 * send runs on the provider of the session's own workspace, and a model saved
 * while the previous provider was still active can land in the new provider's
 * slot. Either way a Codex id (e.g. `gpt-6-luna`) can reach Anthropic. Sends
 * without an explicit model check the stored one here first.
 */
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  getAllAnthropicProviders,
  getAnthropicProvider,
} from '@ptah-extension/shared';

/** Claude aliases; `ModelResolver` maps the tiers for every provider. */
const CLAUDE_ALIASES: ReadonlySet<string> = new Set([
  'default',
  'opus',
  'sonnet',
  'haiku',
  'opusplan',
]);

/** A Claude id or alias, case-insensitive, with an optional `[1m]`-style suffix. */
function isClaudeModel(model: string): boolean {
  const base = model.toLowerCase().replace(/\[[^\]]*\]$/, '');
  return CLAUDE_ALIASES.has(base) || base.startsWith('claude-');
}

/** Cached catalogue model ids of a provider, or `null` when none is on hand. */
export type CachedModelIdsReader = (
  providerId: string,
) => readonly string[] | null;

function isOfferedBy(
  providerId: string,
  model: string,
  cachedModelIds: CachedModelIdsReader,
): boolean {
  return (
    (cachedModelIds(providerId)?.includes(model) ?? false) ||
    (getAnthropicProvider(providerId)?.staticModels?.some(
      (m) => m.id === model,
    ) ??
      false)
  );
}

/**
 * `false` only when `model` is known to belong to ANOTHER provider: some
 * other provider offers it (cached catalogue or registry `staticModels`) and
 * the serving provider does not (direct Anthropic: not a Claude id or alias;
 * otherwise neither its cached catalogue nor its `staticModels`). Claude ids
 * and aliases are kept on every provider. Unknown ids (custom, pinned, local,
 * missing from a partial catalogue) are kept, as before this check.
 */
export function isStoredModelOffered(
  model: string,
  servingProviderId: string,
  cachedModelIds: CachedModelIdsReader,
): boolean {
  if (isClaudeModel(model)) return true;
  if (
    servingProviderId !== ANTHROPIC_DIRECT_PROVIDER_ID &&
    isOfferedBy(servingProviderId, model, cachedModelIds)
  ) {
    return true;
  }
  return !getAllAnthropicProviders().some(
    (provider) =>
      provider.id !== servingProviderId &&
      isOfferedBy(provider.id, model, cachedModelIds),
  );
}
