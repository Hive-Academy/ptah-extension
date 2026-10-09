import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import {
  DEFAULT_PROVIDER_ID,
  normalizeAuthMethod,
} from '@ptah-extension/shared';
import type { ISettingsStore } from '../ports/settings-store.interface';
import {
  AUTH_METHOD_DEF,
  ANTHROPIC_PROVIDER_ID_DEF,
} from '../schema/auth-schema';
import type { WorkspaceScopeResolver } from '../scope/workspace-scope-resolver';

/**
 * The `<authKey>` of the active provider's `provider.<authKey>.*` settings.
 *
 * Derived exactly as `ActiveProviderResolver.resolveActiveAuth` derives the
 * active provider (and so as `auth:getAuthStatus` reports it to the Settings
 * UI, which writes these keys): the stored `authMethod` is normalized (legacy
 * `'openrouter'` / `'oauth'` → `thirdParty`, `'claude-cli'` → `claudeCli`) and
 * a missing provider id is `DEFAULT_PROVIDER_ID`. Reading the raw values here
 * made the backend read a different key than the UI wrote.
 */
export function activeProviderAuthKey(
  store: ISettingsStore,
  resolver?: WorkspaceScopeResolver,
): string {
  const authMethod = normalizeAuthMethod(
    resolver
      ? resolver.read<string>(AUTH_METHOD_DEF.key, true)
      : store.readGlobal<string>(AUTH_METHOD_DEF.key),
  );
  const providerId =
    (resolver
      ? resolver.read<string>(ANTHROPIC_PROVIDER_ID_DEF.key, true)
      : store.readGlobal<string>(ANTHROPIC_PROVIDER_ID_DEF.key)) ??
    DEFAULT_PROVIDER_ID;
  return resolveAuthProviderKey(authMethod, providerId);
}
