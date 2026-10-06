import type { Logger } from '@ptah-extension/vscode-core';
import {
  getAnthropicProvider,
  TIER_ENV_VAR_MAP,
} from '@ptah-extension/agent-sdk';
import type { ProviderModelsService } from '@ptah-extension/auth-providers';

/**
 * Auto-map a provider's default tier models on first selection or login.
 * Only sets tiers that haven't been explicitly configured by the user.
 *
 * Reads `defaultTiers` from the provider registry entry. Providers without
 * defaultTiers (e.g., OpenRouter, local providers) are silently skipped.
 */
export async function autoMapProviderTiers(
  providerModels: ProviderModelsService,
  logger: Logger,
  providerId: string,
): Promise<void> {
  const provider = getAnthropicProvider(providerId);
  if (!provider?.defaultTiers) return;

  try {
    const currentTiers = providerModels.getModelTiers(providerId, 'mainAgent');
    const { defaultTiers } = provider;

    const tierNames = Object.keys(TIER_ENV_VAR_MAP) as Array<
      keyof typeof TIER_ENV_VAR_MAP
    >;
    const promises: Promise<void>[] = [];
    for (const tier of tierNames) {
      if (!currentTiers[tier] && defaultTiers[tier]) {
        promises.push(
          providerModels.setModelTier(
            providerId,
            tier,
            defaultTiers[tier],
            'mainAgent',
          ),
        );
      }
    }

    if (promises.length > 0) {
      await Promise.all(promises);
      logger.info(`Auto-mapped ${provider.name} default tier models`, {
        mapped: promises.length,
      });
    }
  } catch (error) {
    logger.warn(
      `Failed to auto-map ${provider?.name ?? providerId} tier models (non-fatal)`,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}
