import { inject, injectable } from 'tsyringe';
import { z } from 'zod';
import {
  Logger,
  RpcHandler,
  RpcUserError,
  TOKENS,
} from '@ptah-extension/vscode-core';
import { SDK_TOKENS, SdkAgentAdapter } from '@ptah-extension/agent-sdk';
import {
  SETTINGS_TOKENS,
  WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import {
  SCOPED_SETTING_KEYS,
  getAnthropicProvider,
  type ConfigGetScopesResult,
  type ConfigClearScopeOverrideResult,
  type RpcMethodName,
  type ScopedSettingEntry,
} from '@ptah-extension/shared';
import { AuthRpcHandlers } from './auth-rpc.handlers';
import { resolveScopeFromKey } from './setting-scope';

const GetScopesSchema = z
  .object({ keys: z.array(z.string().min(1).max(256)).max(256) })
  .strict();
const ClearScopeSchema = z
  .object({
    key: z.string().min(1).max(256),
    target: z.enum(['nearest', 'all-above-global']).optional(),
  })
  .strict();

/** One allowlist gate for both scope reads and clears. Never accepts physical keys. */
function settingDefinition(key: string) {
  if (
    Object.prototype.hasOwnProperty.call(SCOPED_SETTING_KEYS, key) &&
    !key.includes('<')
  ) {
    return SCOPED_SETTING_KEYS[key];
  }
  const auth =
    /^provider\.(apiKey|claudeCli|thirdParty\.([a-z0-9-]+))\.(selectedModel|reasoningEffort)$/.exec(
      key,
    );
  if (auth && (!auth[2] || getAnthropicProvider(auth[2]))) {
    return SCOPED_SETTING_KEYS[`provider.<authKey>.${auth[3]}`];
  }
  const tier = /^provider\.([a-z0-9-]+)\.modelTier\.(opus|sonnet|haiku)$/.exec(
    key,
  );
  if (tier && getAnthropicProvider(tier[1])) {
    return SCOPED_SETTING_KEYS[`provider.<id>.modelTier.${tier[2]}`];
  }
  throw new RpcUserError('Unsupported scoped setting', 'INVALID_PARAMS');
}

@injectable()
export class ConfigScopeRpcHandlers {
  static readonly METHODS = [
    'config:getScopes',
    'config:clearScopeOverride',
  ] as const satisfies readonly RpcMethodName[];

  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(TOKENS.RPC_HANDLER) private readonly rpcHandler: RpcHandler,
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER)
    private readonly scopeResolver: WorkspaceScopeResolver,
    @inject(SDK_TOKENS.SDK_AGENT_ADAPTER)
    private readonly sdkAdapter: SdkAgentAdapter,
    @inject(AuthRpcHandlers) private readonly authHandlers: AuthRpcHandlers,
  ) {}

  register(): void {
    this.rpcHandler.registerMethod(
      'config:getScopes',
      async (raw: unknown): Promise<ConfigGetScopesResult> => {
        const parsed = GetScopesSchema.safeParse(raw);
        if (!parsed.success)
          throw new RpcUserError('Invalid scope request', 'INVALID_PARAMS');
        // Validate the entire batch before reading any setting.
        const definitions = parsed.data.keys.map(settingDefinition);
        try {
          return {
            activePath: this.scopeResolver.getActivePath() ?? null,
            entries: parsed.data.keys.map((key, index) =>
              this.entry(key, definitions[index]),
            ),
          };
        } catch (error: unknown) {
          this.logger.warn('Unable to inspect setting scopes', {
            errorType: error instanceof Error ? error.name : 'unknown',
          });
          throw new Error('Unable to inspect setting scopes');
        }
      },
    );
    this.rpcHandler.registerMethod(
      'config:clearScopeOverride',
      async (raw: unknown): Promise<ConfigClearScopeOverrideResult> => {
        const parsed = ClearScopeSchema.safeParse(raw);
        if (!parsed.success)
          throw new RpcUserError(
            'Invalid scope clear request',
            'INVALID_PARAMS',
          );
        const { key, target = 'nearest' } = parsed.data;
        const definition = settingDefinition(key);
        // Global-only consumers never read overrides. In particular, never delete their global value.
        if (definition.supportedTargets.length === 1) {
          return { success: true, cleared: [], resolvesFrom: 'global' };
        }
        try {
          const before = this.scopeResolver.inspect(
            key,
            definition.appScopable,
          );
          const authKey =
            key === 'authMethod' ||
            key === 'anthropicProviderId' ||
            key.startsWith('provider.');
          try {
            if (target === 'all-above-global') {
              await this.scopeResolver.clearMoreSpecific(
                key,
                'global',
                definition.appScopable,
              );
            } else {
              await this.scopeResolver.clearOverride(
                key,
                definition.appScopable,
              );
            }
          } finally {
            // A partially completed clear must also invalidate the old SDK/auth state.
            if (authKey) {
              try {
                await this.sdkAdapter.reset();
              } finally {
                this.authHandlers.invalidateAuthStatusCache();
              }
            }
          }
          const remaining = new Set(
            this.scopeResolver
              .inspect(key, definition.appScopable)
              .map((candidate) => candidate.key),
          );
          const cleared = before
            .filter(
              (candidate) =>
                candidate.key !== key && !remaining.has(candidate.key),
            )
            .map((candidate) => candidate.key);
          const resolvesFrom = resolveScopeFromKey(
            this.scopeResolver.effectiveKey(key, definition.appScopable),
            key,
          ).scope;
          return { success: true, cleared, resolvesFrom };
        } catch (error: unknown) {
          // The transport exposes thrown messages; never forward storage or SDK diagnostics.
          this.logger.warn('Unable to clear the setting override', {
            errorType: error instanceof Error ? error.name : 'unknown',
          });
          throw new Error('Unable to clear the setting override');
        }
      },
    );
  }

  private entry(
    key: string,
    definition: (typeof SCOPED_SETTING_KEYS)[string],
  ): ScopedSettingEntry {
    const globalOnly = definition.supportedTargets.length === 1;
    const effectiveKey = globalOnly
      ? key
      : this.scopeResolver.effectiveKey(key, definition.appScopable);
    const candidates = globalOnly
      ? []
      : this.scopeResolver.inspect(key, definition.appScopable);
    const fallback = candidates[1];
    return {
      key,
      ...resolveScopeFromKey(effectiveKey, key),
      hasOverride:
        !globalOnly &&
        this.scopeResolver.hasOverride(key, definition.appScopable),
      effectiveKey,
      supportedTargets: definition.supportedTargets,
      fallbackPreview: fallback
        ? {
            scope: resolveScopeFromKey(fallback.key, key).scope,
            value: fallback.value,
          }
        : null,
      // Every allowlisted key is plain configuration; credential keys are never admitted.
      credentialSource: 'not-a-secret',
    };
  }
}
