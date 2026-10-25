/**
 * Saved-model handling for `config:models-list`.
 *
 * The picker list is built from the SDK tier slots and the Anthropic
 * `/v1/models` catalog. For a third-party provider that is only the three tier
 * mappings plus `default`, so a saved model that is a real provider model but
 * not a tier mapping (e.g. Codex `gpt-6-luna`) was never offered: nothing was
 * selected, the picker fell back to "Default" and the turn ran on the opus
 * tier. These helpers decide when a saved value matches a listed entry and
 * when it must be offered as an entry of its own.
 */
import { getAnthropicProvider } from '@ptah-extension/agent-sdk';

const TIER_ALIASES: ReadonlySet<string> = new Set(['opus', 'sonnet', 'haiku']);

/** Whether `model` is a bare tier alias (`opus` / `sonnet` / `haiku`). */
export function isTierAlias(model: string): boolean {
  return TIER_ALIASES.has(model.toLowerCase());
}

/** A saved model the active provider can serve but the list did not carry. */
export interface SavedModelOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

/**
 * The saved model as a picker entry, or `null` when it must not be offered.
 *
 * Offered only when it is a concrete model id (not `default`, not a tier
 * alias) that the active provider declares: its last live catalog when one
 * is on hand, otherwise the registry's static model list. An unknown id is
 * never invented into the list; the frontend's validity fallback handles it.
 */
export function savedModelOption(
  providerId: string,
  savedModel: string,
  cachedModelIds: readonly string[] | null,
): SavedModelOption | null {
  if (!savedModel || savedModel.toLowerCase() === 'default') return null;
  if (isTierAlias(savedModel)) return null;

  const staticModel = getAnthropicProvider(providerId)?.staticModels?.find(
    (model) => model.id === savedModel,
  );
  // A live catalog, when on hand, decides alone: the static list may still
  // name a model the provider has withdrawn.
  const offered = cachedModelIds
    ? cachedModelIds.includes(savedModel)
    : !!staticModel;
  if (!offered) return null;

  return {
    id: savedModel,
    name: staticModel?.name ?? savedModel,
    description: staticModel?.description ?? '',
  };
}
