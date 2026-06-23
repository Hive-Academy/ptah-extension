import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '../ports/settings-store.interface';
import {
  AUTH_METHOD_DEF,
  ANTHROPIC_PROVIDER_ID_DEF,
} from '../schema/auth-schema';
import { providerSelectedModelDef } from '../schema/provider-schema';
import { ComputedSettingHandle } from './computed-setting-handle';
import { BaseSettingsRepository } from './base-repository';
import type { WorkspaceScopeResolver } from '../scope/workspace-scope-resolver';

/**
 * Typed accessor for model selection settings.
 *
 * The `selectedModel` handle resolves to the provider-specific key at runtime:
 *   `provider.<authKey>.selectedModel`
 * where `authKey` is computed from current authMethod + anthropicProviderId.
 *
 * Usage:
 *   const model = container.resolve<ModelSettings>(SETTINGS_TOKENS.MODEL_SETTINGS);
 *   const id = model.selectedModel.get();   // '' means "use provider default"
 *   await model.selectedModel.set('claude-opus-4-5');
 */
export class ModelSettings extends BaseSettingsRepository {
  /** Model identifier for the currently-active provider. Empty = use provider default. */
  readonly selectedModel: ComputedSettingHandle<string>;

  constructor(store: ISettingsStore, resolver?: WorkspaceScopeResolver) {
    super(store);

    const resolveKey = () => {
      const authMethod =
        (resolver
          ? resolver.read<string>(AUTH_METHOD_DEF.key, true)
          : store.readGlobal<string>(AUTH_METHOD_DEF.key)) ??
        AUTH_METHOD_DEF.default;
      const providerId =
        (resolver
          ? resolver.read<string>(ANTHROPIC_PROVIDER_ID_DEF.key, true)
          : store.readGlobal<string>(ANTHROPIC_PROVIDER_ID_DEF.key)) ?? '';
      const authKey = resolveAuthProviderKey(authMethod, providerId);
      return `provider.${authKey}.selectedModel`;
    };

    this.selectedModel = new ComputedSettingHandle(
      store,
      providerSelectedModelDef('apiKey'),
      resolveKey,
      AUTH_METHOD_DEF.key,
      ANTHROPIC_PROVIDER_ID_DEF.key,
      resolver,
    );
  }
}
