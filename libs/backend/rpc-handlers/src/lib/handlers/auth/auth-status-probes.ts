import type {
  IAuthSecretsService,
  Logger,
  SentryService,
} from '@ptah-extension/vscode-core';
import type { IPlatformAuthProvider } from '@ptah-extension/platform-core';
import type {
  CopilotAuthService,
  ICodexAuthService,
} from '@ptah-extension/auth-providers';
import { maskKeyHint } from '../../utils/mask-key-hint';
import { getGitHubUsername } from './github-username';
import { keyStoreReadFailure } from './key-store-read-failure';
import { withProbeTimeout } from './probe-timeout';

/** Copilot half of the status payload. */
export interface CopilotProbeResult {
  copilotAuthenticated: boolean;
  copilotUsername?: string;
}

/** Codex half of the status payload. */
export interface CodexProbeResult {
  codexAuthenticated: boolean;
  codexTokenStale: boolean;
}

/** Secret-store half of the status payload. */
export interface SecretProbeResult {
  hasApiKey: boolean;
  /** Masked hint of the Claude API key (`maskKeyHint`); never logged. */
  apiKeyHint: string | undefined;
  hasOpenRouterKey: boolean;
  hasAnyProviderKey: boolean;
}

export interface AuthStatusProbesDeps {
  readonly logger: Logger;
  readonly sentryService: SentryService;
  readonly authSecretsService: IAuthSecretsService;
  readonly copilotAuth: CopilotAuthService;
  readonly codexAuth: ICodexAuthService;
  readonly platformAuth: IPlatformAuthProvider;
}

/**
 * The stateless sources behind `auth:getAuthStatus`: the secret store, Copilot
 * and Codex. The memoised Claude-CLI probe lives in `ClaudeCliHealthProbe`.
 */
export class AuthStatusProbes {
  constructor(private readonly deps: AuthStatusProbesDeps) {}

  /**
   * Secret-store presence flags. The per-provider sweep keeps its early break:
   * one hit answers the question, and the whole set is only walked when NO
   * provider key exists at all.
   */
  async probeSecrets(
    checkProviderId: string,
    allProviders: ReadonlyArray<{ id: string }>,
  ): Promise<SecretProbeResult> {
    const { authSecretsService } = this.deps;
    try {
      // The Claude API key is read once for presence AND its masked hint; the
      // value never leaves this scope.
      const [apiKey, hasOpenRouterKey] = await Promise.all([
        authSecretsService.getCredential('apiKey'),
        authSecretsService.hasProviderKey(checkProviderId),
      ]);

      let hasAnyProviderKey = hasOpenRouterKey;
      if (!hasAnyProviderKey) {
        for (const p of allProviders) {
          if (await authSecretsService.hasProviderKey(p.id)) {
            hasAnyProviderKey = true;
            break;
          }
        }
      }

      return {
        hasApiKey: !!apiKey && apiKey.length > 0,
        apiKeyHint: maskKeyHint(apiKey),
        hasOpenRouterKey,
        hasAnyProviderKey,
      };
    } catch (error: unknown) {
      throw keyStoreReadFailure(
        this.deps.logger,
        this.deps.sentryService,
        'auth:getAuthStatus',
        error,
      );
    }
  }

  /** Copilot probe. Non-fatal: a failure yields "not authenticated". */
  async probeCopilot(): Promise<CopilotProbeResult> {
    return withProbeTimeout(
      this.deps.logger,
      'Copilot',
      this.runCopilotProbe(),
      () => ({
        copilotAuthenticated: false,
      }),
    );
  }

  private async runCopilotProbe(): Promise<CopilotProbeResult> {
    try {
      const copilotAuthenticated =
        await this.deps.copilotAuth.isAuthenticated();
      if (!copilotAuthenticated) return { copilotAuthenticated: false };
      return {
        copilotAuthenticated: true,
        copilotUsername: await getGitHubUsername(this.deps.platformAuth),
      };
    } catch (copilotError: unknown) {
      this.deps.logger.warn(
        'Copilot auth status check failed (non-fatal)',
        copilotError instanceof Error
          ? copilotError
          : new Error(String(copilotError)),
      );
      return { copilotAuthenticated: false };
    }
  }

  /** Codex probe. Non-fatal: a failure yields "not authenticated, not stale". */
  async probeCodex(): Promise<CodexProbeResult> {
    return withProbeTimeout(
      this.deps.logger,
      'Codex',
      this.runCodexProbe(),
      () => ({
        codexAuthenticated: false,
        codexTokenStale: false,
      }),
    );
  }

  private async runCodexProbe(): Promise<CodexProbeResult> {
    try {
      const codexStatus = await this.deps.codexAuth.getTokenStatus();
      return {
        codexAuthenticated: codexStatus.authenticated,
        codexTokenStale: codexStatus.stale,
      };
    } catch (codexError: unknown) {
      this.deps.logger.warn(
        'Codex auth status check failed (non-fatal)',
        codexError instanceof Error
          ? codexError
          : new Error(String(codexError)),
      );
      return { codexAuthenticated: false, codexTokenStale: false };
    }
  }
}
