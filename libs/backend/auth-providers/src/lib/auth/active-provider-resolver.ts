import { injectable, inject } from 'tsyringe';
import {
  SETTINGS_TOKENS,
  WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import {
  ANTHROPIC_DIRECT_PROVIDER_ID,
  DEFAULT_PROVIDER_ID,
  type LegacyAuthMethod,
} from '@ptah-extension/shared';
import { normalizeAuthMethod } from './auth-method.utils';

export interface ActiveAuth {
  authMethod: LegacyAuthMethod;
  providerId: string;
}

@injectable()
export class ActiveProviderResolver {
  constructor(
    @inject(SETTINGS_TOKENS.WORKSPACE_SCOPE_RESOLVER)
    private readonly scope: WorkspaceScopeResolver,
  ) {}

  resolveActiveAuth(): ActiveAuth {
    const authMethod = normalizeAuthMethod(
      this.scope.read<string>('authMethod', true),
    );

    if (authMethod === 'apiKey' || authMethod === 'claudeCli') {
      return { authMethod, providerId: ANTHROPIC_DIRECT_PROVIDER_ID };
    }

    return { authMethod, providerId: this.resolveThirdPartyProviderId() };
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
    const authMethod = normalizeAuthMethod(
      this.scope.readForPath<string>('authMethod', workspacePath, true),
    );

    if (authMethod === 'apiKey' || authMethod === 'claudeCli') {
      return { authMethod, providerId: ANTHROPIC_DIRECT_PROVIDER_ID };
    }

    return {
      authMethod,
      providerId: this.resolveThirdPartyProviderIdForPath(workspacePath),
    };
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
}
