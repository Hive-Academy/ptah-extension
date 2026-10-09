/**
 * WorkspaceLlmResolver — the `IWorkspaceLlmResolver` implementation.
 *
 * Resolves provider AND model for one workspace path from ONE place:
 *  - the provider: `ActiveProviderResolver.resolveActiveAuthForPath` (the
 *    workspace's override, else the app-, then global-scoped value; `''` for
 *    rootless callers reads app/global directly);
 *  - the model: `provider.<authKey>.selectedModel` read for that same path;
 *  - the credentials: `WorkspaceProviderProfileResolver.buildProfileForPath`,
 *    the snapshot builder the chat path uses, so the model's tier aliases are
 *    resolved against the provider they will be sent to.
 *
 * Never the process-wide `AuthEnv` and never the active workspace: a
 * workspace-scoped save re-configures that env for whichever workspace is
 * active, which is not necessarily the one this work belongs to.
 */

import { inject, injectable } from 'tsyringe';
import { Logger, TOKENS } from '@ptah-extension/vscode-core';
import { resolveAuthProviderKey } from '@ptah-extension/platform-core';
import {
  SETTINGS_TOKENS,
  type WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import type {
  IWorkspaceLlmResolver,
  OneShotAuthOverride,
  WorkspaceLlmResolveOptions,
  WorkspaceLlmSnapshot,
} from '@ptah-extension/agent-sdk';
import type { ProviderProfile } from '@ptah-extension/shared';
import { AUTH_PROVIDERS_TOKENS } from '../di/tokens';
import type { ProviderModelsService } from '../provider-models.service';
import type { ActiveProviderResolver } from './active-provider-resolver';
import type { WorkspaceProviderProfileResolver } from './workspace-provider-profile-resolver';
import type { ProviderQuotaStore } from './provider-quota.store';

const TIER_ALIASES: ReadonlySet<string> = new Set([
  'default',
  'opus',
  'sonnet',
  'haiku',
]);

@injectable()
export class WorkspaceLlmResolver implements IWorkspaceLlmResolver {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER)
    private readonly scope: WorkspaceScopeResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_ACTIVE_PROVIDER_RESOLVER)
    private readonly activeProviderResolver: ActiveProviderResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_WORKSPACE_PROVIDER_PROFILE_RESOLVER)
    private readonly profileResolver: WorkspaceProviderProfileResolver,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_MODELS)
    private readonly providerModels: ProviderModelsService,
    @inject(AUTH_PROVIDERS_TOKENS.SDK_PROVIDER_QUOTA_STORE)
    private readonly quota: ProviderQuotaStore,
  ) {}

  async resolveForPath(
    workspaceRoot: string | undefined,
    options: WorkspaceLlmResolveOptions = {},
  ): Promise<WorkspaceLlmSnapshot> {
    const path = workspaceRoot?.trim() ?? '';
    const { authMethod, providerId } =
      this.activeProviderResolver.resolveActiveAuthForPath(path);
    const thirdParty = authMethod === 'thirdParty';
    const catalog = thirdParty
      ? this.providerModels.getCachedModelIds(providerId)
      : null;

    const savedModel =
      this.scope
        .readForPath<string>(
          `provider.${resolveAuthProviderKey(authMethod, providerId)}.selectedModel`,
          path,
          true,
        )
        ?.trim() || 'default';
    const requestedModel = this.acceptRequestedModel(
      options.requestedModel,
      thirdParty,
      catalog,
      providerId,
    );

    let profile: ProviderProfile | undefined;
    try {
      profile = await this.profileResolver.buildProfileForPath(
        path,
        requestedModel ?? savedModel,
      );
    } catch (error: unknown) {
      // degradation-audit: optional-capability - the builder already returns
      // `undefined` on its own failures; a throw degrades the same way.
      this.logger.warn(
        '[WorkspaceLlmResolver] Could not build the provider snapshot',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }

    if (!profile) {
      this.logger.warn(
        '[WorkspaceLlmResolver] No isolated provider snapshot for this workspace — the query rides the process-wide auth',
        { providerId, workspaceRoot: path || '(none)' },
      );
      return {
        providerId,
        model: requestedModel ?? savedModel,
        ...this.cooldownFor(providerId),
      };
    }

    const auth: OneShotAuthOverride = {
      env: { ...profile.authEnv },
      ...(profile.baseUrl ? { baseUrl: profile.baseUrl } : {}),
    };
    return {
      providerId: profile.providerId,
      model: this.ensureAvailable(profile, catalog),
      auth,
      // The cooldown belongs to the provider the snapshot targets.
      ...this.cooldownFor(profile.providerId),
    };
  }

  private cooldownFor(providerId: string): { cooldownMs?: number } {
    const cooldownMs = this.quota.retryAfterMs(providerId);
    return cooldownMs > 0 ? { cooldownMs } : {};
  }

  /**
   * A caller-supplied model is kept only when the snapshot's provider offers
   * it: in its cached catalogue for a third-party provider, or a Claude id /
   * tier alias for direct Anthropic. Anything else (typically a model the
   * frontend still holds for the previous provider) is ignored.
   */
  private acceptRequestedModel(
    requested: string | undefined,
    thirdParty: boolean,
    catalog: readonly string[] | null,
    providerId: string,
  ): string | undefined {
    const model = requested?.trim();
    if (!model) return undefined;
    const accepted = thirdParty
      ? catalog !== null && catalog.includes(model)
      : model.startsWith('claude-') || TIER_ALIASES.has(model.toLowerCase());
    if (!accepted) {
      this.logger.warn(
        '[WorkspaceLlmResolver] Ignoring a requested model the workspace provider does not offer',
        { requested: model, providerId },
      );
      return undefined;
    }
    return model;
  }

  /**
   * Stale-model pre-flight: a model absent from the provider's cached list is
   * replaced by the provider's tier mapping (opus → sonnet → haiku, the order
   * `resolveModel` uses for `default`), the first tier the list contains.
   * No cached list, or no tier in it → the model is kept (swapping one
   * unlisted id for another fixes nothing); this never blocks a run.
   */
  private ensureAvailable(
    profile: ProviderProfile,
    catalog: readonly string[] | null,
  ): string {
    if (!catalog || catalog.includes(profile.model)) return profile.model;
    const fallback = [
      profile.authEnv.ANTHROPIC_DEFAULT_OPUS_MODEL,
      profile.authEnv.ANTHROPIC_DEFAULT_SONNET_MODEL,
      profile.authEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    ].find(
      (m): m is string =>
        typeof m === 'string' && m.length > 0 && catalog.includes(m),
    );
    if (!fallback) return profile.model;
    this.logger.warn(
      '[WorkspaceLlmResolver] Saved model is not offered by the workspace provider — using its default tier',
      { model: profile.model, fallback, providerId: profile.providerId },
    );
    return fallback;
  }
}
