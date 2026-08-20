import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import type { ISettingsStore } from '../ports/settings-store.interface';
import {
  AUTH_METHOD_DEF,
  ANTHROPIC_PROVIDER_ID_DEF,
} from '../schema/auth-schema';
import { providerReasoningEffortDef } from '../schema/provider-schema';
import { ComputedSettingHandle } from './computed-setting-handle';
import { BaseSettingsRepository } from './base-repository';
import type { WorkspaceScopeResolver } from '../scope/workspace-scope-resolver';

/**
 * Typed accessor for reasoning effort settings.
 *
 * The `effort` handle resolves to the provider-specific key at runtime:
 *   `provider.<authKey>.reasoningEffort`
 * where `authKey` is computed from current authMethod + anthropicProviderId.
 *
 * Usage:
 *   const reasoning = container.resolve<ReasoningSettings>(SETTINGS_TOKENS.REASONING_SETTINGS);
 *   const level = reasoning.effort.get();   // '' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
 *   await reasoning.effort.set('high');
 */
export class ReasoningSettings extends BaseSettingsRepository {
  /** Reasoning effort level for the currently-active provider. */
  readonly effort: ComputedSettingHandle<string>;

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
      return `provider.${authKey}.reasoningEffort`;
    };

    this.effort = new ComputedSettingHandle(
      store,
      providerReasoningEffortDef('apiKey'),
      resolveKey,
      AUTH_METHOD_DEF.key,
      ANTHROPIC_PROVIDER_ID_DEF.key,
      resolver,
    );
  }
}
