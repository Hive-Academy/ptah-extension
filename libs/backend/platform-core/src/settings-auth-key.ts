/**
 * Resolve the provider auth key used to scope per-provider settings.
 *
 * The settings store uses `provider.<authKey>.*` as the key prefix for
 * per-provider settings (e.g., `provider.thirdParty.openrouter.selectedModel`).
 * This function computes the `authKey` segment from the legacy authMethod +
 * anthropicProviderId values that are stored in settings.json.
 *
 * Matches AuthMethod from @ptah-extension/shared (imported by value here
 * to keep platform-core free of inter-lib dependencies on @ptah-extension/shared).
 */
export function resolveAuthProviderKey(
  authMethod: string,
  anthropicProviderId?: string,
): string {
  if (authMethod === 'thirdParty') {
    const providerId =
      anthropicProviderId && anthropicProviderId.length > 0
        ? anthropicProviderId
        : 'unknown';
    return `thirdParty.${providerId}`;
  }
  // 'apiKey' | 'claudeCli' — use as-is
  return authMethod;
}
