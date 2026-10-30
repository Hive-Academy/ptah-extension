import { injectable, inject } from 'tsyringe';
import {
  SETTINGS_TOKENS,
  WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import type { IAuthSecretsService } from '@ptah-extension/vscode-core';
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  DEFAULT_PROVIDER_ID,
  type LegacyAuthMethod,
} from '@ptah-extension/shared';
import type { ClaudeAmbientLoginStatusReader } from '../accounts/claude-ambient-login-status';
import { parseAuthMethod, resolveDefaultAuthMethod } from './auth-method.utils';

export interface ActiveAuth {
  authMethod: LegacyAuthMethod;
  providerId: string;
}

/**
 * The credential state that decides the auth method when none is configured
 * ({@link ActiveProviderResolver.resolveActiveAuthWithDefault}).
 */
export interface AuthCredentialProbe {
  /** An Anthropic API key is stored (SecretStorage) or set in the environment. */
  hasAnthropicApiKey(): Promise<boolean>;
  /** The Claude CLI login is connected. */
  isClaudeCliConnected(): Promise<boolean>;
}

/**
 * The probe every host uses: the stored `apiKey` credential or
 * `ANTHROPIC_API_KEY` (what `ApiKeyStrategy` can configure), and the cached,
 * bounded ambient login read (`ClaudeAmbientLoginStatusReader.read()` never
 * throws).
 */
export function createAuthCredentialProbe(
  authSecrets: Pick<IAuthSecretsService, 'getCredential'>,
  ambientLogin: Pick<ClaudeAmbientLoginStatusReader, 'read'>,
): AuthCredentialProbe {
  return {
    hasAnthropicApiKey: async () =>
      Boolean(
        (await authSecrets.getCredential('apiKey'))?.trim() ||
        process.env['ANTHROPIC_API_KEY']?.trim(),
      ),
    isClaudeCliConnected: async () =>
      (await ambientLogin.read()).state === 'connected',
  };
}

@injectable()
export class ActiveProviderResolver {
  /**
   * The method a missing or unknown `authMethod` resolves to: the last answer
   * of {@link resolveActiveAuthWithDefault}, `'claudeCli'` until one is known.
   * The credential facts are global (one key store, one Claude login), so the
   * synchronous readers report the same method that the adapter configured.
   */
  private unconfiguredAuthMethod: LegacyAuthMethod = 'claudeCli';

  constructor(
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER)
    private readonly scope: WorkspaceScopeResolver,
  ) {}

  resolveActiveAuth(): ActiveAuth {
    return this.toActiveAuth(this.scope.read<string>('authMethod', true), () =>
      this.resolveThirdPartyProviderId(),
    );
  }

  resolveThirdPartyProviderId(): string {
    return (
      this.scope.read<string>('anthropicProviderId', true) ??
      DEFAULT_PROVIDER_ID
    );
  }

  /**
   * Path-scoped counterpart of {@link resolveActiveAuth}. Resolves the auth
   * method + provider id for an EXPLICIT workspace path rather than the ambient
   * active workspace — the entry point for per-workspace provider isolation, so
   * a chat session belonging to workspace A resolves A's provider regardless of
   * which workspace is currently focused.
   */
  resolveActiveAuthForPath(workspacePath: string): ActiveAuth {
    return this.toActiveAuth(
      this.scope.readForPath<string>('authMethod', workspacePath, true),
      () => this.resolveThirdPartyProviderIdForPath(workspacePath),
    );
  }

  /**
   * The active auth with the credential-aware default applied — the one rule
   * used by global initialization (`AuthManager.configureAuthentication()`)
   * and by per-workspace snapshots (`WorkspaceProviderProfileResolver`).
   *
   * A known configured `authMethod` (the workspace override for
   * `workspacePath`, else the app or global value) is always honoured and no
   * credential is read. Otherwise the Claude CLI login is the default; only a
   * stored or environment API key without a connected Claude CLI login gives
   * `'apiKey'`. The answer is remembered for the synchronous readers.
   *
   * @param workspacePath an explicit workspace; omitted reads the active scope.
   */
  async resolveActiveAuthWithDefault(
    probe: AuthCredentialProbe,
    workspacePath?: string,
  ): Promise<ActiveAuth> {
    const raw =
      workspacePath === undefined
        ? this.scope.read<string>('authMethod', true)
        : this.scope.readForPath<string>('authMethod', workspacePath, true);
    if (parseAuthMethod(raw) === undefined) {
      const hasApiKey = await probe.hasAnthropicApiKey();
      this.unconfiguredAuthMethod = resolveDefaultAuthMethod({
        hasApiKey,
        // Without a key the answer is the Claude CLI login either way.
        claudeCliConnected: hasApiKey && (await probe.isClaudeCliConnected()),
      });
    }
    return workspacePath === undefined
      ? this.resolveActiveAuth()
      : this.resolveActiveAuthForPath(workspacePath);
  }

  resolveThirdPartyProviderIdForPath(workspacePath: string): string {
    return (
      this.scope.readForPath<string>(
        'anthropicProviderId',
        workspacePath,
        true,
      ) ?? DEFAULT_PROVIDER_ID
    );
  }

  private toActiveAuth(
    raw: string | undefined,
    thirdPartyProviderId: () => string,
  ): ActiveAuth {
    const authMethod = parseAuthMethod(raw) ?? this.unconfiguredAuthMethod;
    if (authMethod === 'apiKey' || authMethod === 'claudeCli') {
      return { authMethod, providerId: ANTHROPIC_DIRECT_PROVIDER_ID };
    }
    return { authMethod, providerId: thirdPartyProviderId() };
  }
}
