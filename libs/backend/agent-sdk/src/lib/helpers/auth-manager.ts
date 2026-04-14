/**
 * Authentication Manager - Handles SDK authentication configuration
 *
 * Responsibilities:
 * - Anthropic-compatible provider (OpenRouter, Moonshot, Z.AI), OAuth token and API key detection
 * - Environment variable setup
 * - Token format validation
 * - Authentication priority logic (Anthropic Provider > OAuth > API Key)
 *
 * TASK_2025_091: Added OpenRouter as highest-priority auth method
 * TASK_2025_129 Batch 3: Generalized to support multiple Anthropic-compatible providers
 * TASK_2025_134: Clean Slate pattern - centralized env cleanup before each auth configuration
 */

import { injectable, inject } from 'tsyringe';
import {
  Logger,
  ConfigManager,
  TOKENS,
  IAuthSecretsService,
} from '@ptah-extension/vscode-core';
import type { AuthEnv } from '@ptah-extension/shared';
import {
  getAnthropicProvider,
  getProviderBaseUrl,
  getProviderAuthEnvVar,
  seedStaticModelPricing,
  DEFAULT_PROVIDER_ID,
  ANTHROPIC_DIRECT_PROVIDER_ID,
} from './anthropic-provider-registry';
import { ProviderModelsService } from '../provider-models.service';
import { SDK_TOKENS } from '../di/tokens';
import { COPILOT_PROXY_TOKEN_PLACEHOLDER } from '../copilot-provider/copilot-provider.types';
import type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
} from '../copilot-provider/copilot-provider.types';
import { CODEX_PROXY_TOKEN_PLACEHOLDER } from '../codex-provider/codex-provider.types';
import type { ICodexAuthService } from '../codex-provider/codex-provider.types';
import type { ITranslationProxy } from '../openai-translation';
import {
  LOCAL_PROXY_TOKEN_PLACEHOLDER,
  OLLAMA_AUTH_TOKEN_PLACEHOLDER,
} from '../local-provider';
import { LocalModelTranslationProxy } from '../local-provider/local-model-translation-proxy';
import type { OllamaModelDiscoveryService } from '../local-provider/ollama-model-discovery.service';

export interface AuthResult {
  configured: boolean;
  details: string[];
  errorMessage?: string;
}

export interface AuthConfig {
  method: 'oauth' | 'apiKey' | 'openrouter' | 'auto';
}

/** All auth-related environment variable names (single source of truth) */
const AUTH_ENV_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

/** Snapshot of env values captured before cleanup, used for shell fallback detection */
interface EnvSnapshot {
  ANTHROPIC_API_KEY: string | undefined;
  ANTHROPIC_BASE_URL: string | undefined;
  ANTHROPIC_AUTH_TOKEN: string | undefined;
  CLAUDE_CODE_OAUTH_TOKEN: string | undefined;
}

/**
 * Manages SDK authentication setup and validation
 */
@injectable()
export class AuthManager {
  private configInProgress: Promise<AuthResult> | null = null;

  constructor(
    @inject(TOKENS.LOGGER) private logger: Logger,
    @inject(TOKENS.CONFIG_MANAGER) private config: ConfigManager,
    @inject(TOKENS.AUTH_SECRETS_SERVICE)
    private authSecrets: IAuthSecretsService,
    @inject(SDK_TOKENS.SDK_PROVIDER_MODELS)
    private providerModels: ProviderModelsService,
    @inject(SDK_TOKENS.SDK_AUTH_ENV) private authEnv: AuthEnv,
    @inject(SDK_TOKENS.SDK_COPILOT_AUTH)
    private copilotAuth: ICopilotAuthService,
    @inject(SDK_TOKENS.SDK_COPILOT_PROXY)
    private copilotProxy: ICopilotTranslationProxy,
    @inject(SDK_TOKENS.SDK_CODEX_AUTH)
    private codexAuth: ICodexAuthService,
    @inject(SDK_TOKENS.SDK_CODEX_PROXY)
    private codexProxy: ITranslationProxy,
    @inject(SDK_TOKENS.SDK_OLLAMA_DISCOVERY)
    private ollamaDiscovery: OllamaModelDiscoveryService,
    @inject(SDK_TOKENS.SDK_LM_STUDIO_PROXY)
    private lmStudioProxy: LocalModelTranslationProxy,
  ) {}

  /**
   * Configure authentication for SDK
   * Returns auth status and details for logging
   *
   * Uses the "Clean Slate" pattern:
   * 1. Capture env snapshot (for shell fallback detection)
   * 2. Clear ALL auth + tier env vars (single source of truth)
   * 3. Run selected configure method (only sets its own vars)
   * 4. Log env summary (boolean presence, no secrets)
   */
  async configureAuthentication(rawAuthMethod: string): Promise<AuthResult> {
    // Concurrency guard: if a configuration is already in progress, await it
    if (this.configInProgress) {
      this.logger.debug(
        '[AuthManager] configureAuthentication already in progress, awaiting existing call',
      );
      return this.configInProgress;
    }

    this.configInProgress = this.doConfigureAuthentication(rawAuthMethod);
    try {
      return await this.configInProgress;
    } finally {
      this.configInProgress = null;
    }
  }

  /**
   * Internal implementation of configureAuthentication (guarded by concurrency mutex above)
   */
  private async doConfigureAuthentication(
    rawAuthMethod: string,
  ): Promise<AuthResult> {
    // Normalize: treat unknown/legacy values (e.g. 'vscode-lm') as 'auto'
    const validMethods = new Set(['oauth', 'apiKey', 'openrouter', 'auto']);
    const authMethod = validMethods.has(rawAuthMethod) ? rawAuthMethod : 'auto';

    if (rawAuthMethod !== authMethod) {
      this.logger.warn(
        `[AuthManager] Unknown auth method '${rawAuthMethod}', falling back to 'auto'`,
      );
    }

    this.logger.debug(`[AuthManager] Configuring auth method: ${authMethod}`);

    // Step 1: Capture env snapshot before cleanup (for shell fallback)
    const envSnapshot = this.captureEnvSnapshot();

    // Step 2: Clean slate - clear ALL auth and tier env vars
    this.clearAllAuthEnvVars();
    this.providerModels.clearAllTierEnvVars();

    let authConfigured = false;
    const authDetails: string[] = [];

    // TASK_2025_129 Batch 3: Priority 1 - Anthropic-compatible provider
    // Supports OpenRouter, Moonshot (Kimi), Z.AI (GLM), and future providers
    if (authMethod === 'openrouter' || authMethod === 'auto') {
      const providerResult = await this.configureAnthropicProvider();
      if (providerResult.configured) {
        authConfigured = true;
        authDetails.push(...providerResult.details);
        // Skip OAuth and API key when provider is configured
        this.logger.info(
          `[AuthManager] Authentication configured: ${authDetails.join(', ')}`,
        );
        this.logEnvSummary();
        return { configured: true, details: authDetails };
      }
      // When provider was explicitly selected (not auto), surface its error directly
      if (authMethod === 'openrouter' && providerResult.errorMessage) {
        this.logEnvSummary();
        return providerResult;
      }
    }

    // Priority 2: OAuth token (from Claude Max/Pro subscription)
    // NOTE: As of SDK v0.1.8+, CLAUDE_CODE_OAUTH_TOKEN is supported and will use your subscription
    // Get token via: claude setup-token
    if (authMethod === 'oauth' || authMethod === 'auto') {
      const oauthResult = await this.configureOAuthToken(envSnapshot);
      if (oauthResult.configured) {
        authConfigured = true;
        authDetails.push(...oauthResult.details);
      }
    }

    // Priority 3: API key (pay-per-token billing, separate from subscription)
    // NOTE: API key takes precedence over OAuth token if both are set
    // In 'auto' mode with OAuth token, we skip API key to use subscription
    const hasOAuthToken = authDetails.some((d) => d.includes('OAuth token'));

    if ((authMethod === 'apiKey' || authMethod === 'auto') && !hasOAuthToken) {
      const apiKeyResult = await this.configureAPIKey(envSnapshot);
      if (apiKeyResult.configured) {
        authConfigured = true;
        authDetails.push(...apiKeyResult.details);
      }
    } else if (hasOAuthToken && authMethod === 'auto') {
      this.logger.info(
        '[AuthManager] Skipping API key check - using OAuth token from subscription',
      );
    }

    // No auth configured — expected on first install, not an error
    if (!authConfigured) {
      const infoMsg =
        'No authentication configured yet. Configure in Ptah Settings > Authentication tab.';
      this.logger.info(`[AuthManager] ${infoMsg}`);
      this.logger.debug(
        '[AuthManager] Option 1 (Provider): Configure in Settings > Authentication > Provider tab',
      );
      this.logger.debug(
        '[AuthManager] Option 2 (Subscription): Run "claude setup-token" and paste the token',
      );
      this.logger.debug(
        '[AuthManager] Option 3 (API Key): Get from https://console.anthropic.com/settings/keys',
      );
      this.logEnvSummary();
      return {
        configured: false,
        details: [],
        errorMessage: infoMsg,
      };
    }

    // Log summary
    this.logger.info(
      `[AuthManager] Authentication configured: ${authDetails.join(', ')}`,
    );
    this.logEnvSummary();

    return {
      configured: true,
      details: authDetails,
    };
  }

  /**
   * Configure OAuth token authentication
   * Reads from SecretStorage (primary) or env snapshot (fallback)
   */
  private async configureOAuthToken(
    envSnapshot: EnvSnapshot,
  ): Promise<AuthResult> {
    const oauthToken = await this.authSecrets.getCredential('oauthToken');
    const envOAuthToken = envSnapshot.CLAUDE_CODE_OAUTH_TOKEN;
    const details: string[] = [];

    if (oauthToken?.trim()) {
      const tokenLength = oauthToken.length;
      const isOAuthFormat = oauthToken.startsWith('sk-ant-oat01-');

      this.logger.info(
        `[AuthManager] Found OAuth token in SecretStorage (length: ${tokenLength}, OAuth format: ${isOAuthFormat})`,
      );

      if (!isOAuthFormat) {
        this.logger.warn(
          '[AuthManager] WARNING: OAuth token does not start with "sk-ant-oat01-". Get token via: claude setup-token',
        );
      }

      this.authEnv.CLAUDE_CODE_OAUTH_TOKEN = oauthToken.trim();

      this.logger.info(
        '[AuthManager] Using OAuth token from Claude Max/Pro subscription',
      );

      details.push(
        `OAuth token from SecretStorage (subscription mode${
          !isOAuthFormat ? ', format may be invalid' : ''
        })`,
      );

      try {
        this.providerModels.applyPersistedTiers(ANTHROPIC_DIRECT_PROVIDER_ID);
      } catch (e) {
        this.logger.warn(
          '[AuthManager] Failed to apply tier mappings for direct auth',
          e instanceof Error ? e : new Error(String(e)),
        );
      }

      return { configured: true, details };
    } else if (envOAuthToken) {
      const tokenLength = envOAuthToken.length;
      const isOAuthFormat = envOAuthToken.startsWith('sk-ant-oat01-');

      this.logger.info(
        `[AuthManager] Found OAuth token in environment (length: ${tokenLength}, OAuth format: ${isOAuthFormat})`,
      );

      // Restore the token from snapshot (it was cleared in clean slate)
      this.authEnv.CLAUDE_CODE_OAUTH_TOKEN = envOAuthToken;

      this.logger.info(
        '[AuthManager] Using OAuth token from environment (subscription mode)',
      );

      details.push(
        `OAuth token from environment (subscription mode${
          !isOAuthFormat ? ', format may be invalid' : ''
        })`,
      );

      try {
        this.providerModels.applyPersistedTiers(ANTHROPIC_DIRECT_PROVIDER_ID);
      } catch (e) {
        this.logger.warn(
          '[AuthManager] Failed to apply tier mappings for direct auth',
          e instanceof Error ? e : new Error(String(e)),
        );
      }

      return { configured: true, details };
    } else {
      this.logger.debug(
        '[AuthManager] No OAuth token found in SecretStorage or environment',
      );
      return { configured: false, details: [] };
    }
  }

  /**
   * Configure Anthropic-compatible provider authentication (TASK_2025_129 Batch 3)
   *
   * Supports multiple providers that implement the Anthropic API protocol:
   * - OpenRouter: Multi-model access (200+ models) — ANTHROPIC_AUTH_TOKEN (Bearer)
   * - Moonshot (Kimi): Anthropic-compatible endpoint — ANTHROPIC_AUTH_TOKEN (Bearer)
   * - Z.AI (GLM): Anthropic-compatible endpoint — ANTHROPIC_AUTH_TOKEN (Bearer)
   *
   * Environment variables set:
   * - ANTHROPIC_BASE_URL: Provider's API endpoint (from registry)
   * - Provider's authEnvVar: Either ANTHROPIC_AUTH_TOKEN or ANTHROPIC_API_KEY
   *
   * @see https://openrouter.ai/docs/guides/claude-code-integration
   * @see https://platform.moonshot.ai/docs/guide/agent-support.en-US
   * @see https://docs.z.ai/devpack/tool/claude
   */
  private async configureAnthropicProvider(): Promise<AuthResult> {
    // Read selected provider from config (default: openrouter for backward compat)
    const providerId = this.config.getWithDefault<string>(
      'anthropicProviderId',
      DEFAULT_PROVIDER_ID,
    );

    const provider = getAnthropicProvider(providerId);
    const details: string[] = [];

    // TASK_2025_186: OAuth provider flow (e.g., GitHub Copilot)
    // Uses translation proxy instead of API key
    if (provider?.requiresProxy && provider?.authType === 'oauth') {
      return this.configureOAuthProvider(provider);
    }

    // TASK_2025_281: Ollama Anthropic-native flow (no proxy needed)
    // Ollama v0.14.0+ speaks Anthropic Messages API directly
    if (!provider?.requiresProxy && provider?.authType === 'none') {
      return this.configureOllamaProvider(provider);
    }

    // TASK_2025_265: Local proxy provider flow (LM Studio)
    // Uses translation proxy, requires no API key or OAuth
    if (provider?.requiresProxy && provider?.authType === 'none') {
      return this.configureLocalProvider(provider);
    }

    // Per-provider key lookup: each provider has its own isolated storage slot
    const providerKey = await this.authSecrets.getProviderKey(providerId);

    if (providerKey?.trim()) {
      const providerName = provider?.name ?? providerId;
      const baseUrl = getProviderBaseUrl(providerId);
      const authEnvVar = getProviderAuthEnvVar(providerId);

      const keyLength = providerKey.length;

      // Validate key format if provider has expected prefix
      const hasExpectedPrefix = provider?.keyPrefix
        ? providerKey.startsWith(provider.keyPrefix)
        : true;

      this.logger.info(
        `[AuthManager] Found provider key in SecretStorage (provider: ${providerName}, length: ${keyLength}, valid format: ${hasExpectedPrefix})`,
      );

      if (!hasExpectedPrefix && provider?.keyPrefix) {
        this.logger.warn(
          `[AuthManager] WARNING: Key does not start with "${provider.keyPrefix}". Expected format for ${providerName}.`,
        );
        this.logger.warn(
          `[AuthManager] Get valid keys from: ${provider.helpUrl}`,
        );
      }

      // Set provider-specific env vars only
      // authEnvVar is per-provider: ANTHROPIC_AUTH_TOKEN (Bearer) or ANTHROPIC_API_KEY (X-API-Key)
      this.authEnv.ANTHROPIC_BASE_URL = baseUrl;
      this.authEnv[authEnvVar as keyof AuthEnv] = providerKey.trim();
      // Sync to process.env — SDK reads these directly, not from the env option
      process.env['ANTHROPIC_BASE_URL'] = baseUrl;
      process.env[authEnvVar] = providerKey.trim();

      // Apply persisted tier mappings for this provider (TASK_2025_132)
      this.providerModels.switchActiveProvider(providerId);

      // Seed pricing map with static model pricing (fallback for models not on OpenRouter)
      seedStaticModelPricing(providerId);

      this.logger.info(
        `[AuthManager] Using ${providerName} (routing via ${baseUrl})`,
      );
      this.logger.info(
        `[AuthManager] Set ANTHROPIC_BASE_URL=${baseUrl}, ${authEnvVar}=<set>`,
      );

      details.push(
        `${providerName} API key (routing via ${baseUrl}${
          !hasExpectedPrefix && provider?.keyPrefix
            ? ', format may be invalid'
            : ''
        })`,
      );
      return { configured: true, details };
    } else {
      this.logger.debug('[AuthManager] No provider key found in SecretStorage');
      return { configured: false, details: [] };
    }
  }

  /**
   * Configure an OAuth-based provider that requires a translation proxy (TASK_2025_186).
   *
   * Flow:
   * 1. Check/initiate OAuth authentication (e.g., GitHub Copilot via VS Code auth)
   * 2. Start local translation proxy
   * 3. Point ANTHROPIC_BASE_URL to the proxy
   * 4. Set a placeholder auth token (proxy handles real auth internally)
   */
  private async configureOAuthProvider(provider: {
    id: string;
    name: string;
    staticModels?: Array<{ id: string }>;
  }): Promise<AuthResult> {
    // Stop the OTHER provider's proxy to prevent cross-contamination.
    // Only one proxy should be active at a time — the selected provider's.
    if (provider.id === 'openai-codex') {
      await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
      return this.configureCodexOAuth(provider);
    }

    // Default: GitHub Copilot flow
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
    return this.configureCopilotOAuth(provider);
  }

  /**
   * Stop a translation proxy if it's running.
   * Called when switching providers to ensure only one proxy is active.
   */
  private async stopProxyIfRunning(
    proxy: { isRunning(): boolean; stop(): Promise<void> },
    name: string,
  ): Promise<void> {
    if (proxy.isRunning()) {
      this.logger.info(
        `[AuthManager] Stopping ${name} proxy (switching to different provider)`,
      );
      try {
        await proxy.stop();
      } catch (error) {
        this.logger.warn(
          `[AuthManager] Failed to stop ${name} proxy: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }

  /**
   * Configure Ollama provider (Anthropic-native, no proxy) - TASK_2025_281.
   *
   * Flow:
   * 1. Stop ALL other provider proxies
   * 2. Point ANTHROPIC_BASE_URL directly to Ollama server
   * 3. Set placeholder auth token (Ollama ignores auth)
   * 4. Register dynamic model fetcher via OllamaModelDiscoveryService
   */
  private async configureOllamaProvider(provider: {
    id: string;
    name: string;
  }): Promise<AuthResult> {
    const providerName = provider.name;

    this.logger.info(
      `[AuthManager] Configuring Ollama provider: ${providerName} (Anthropic-native)`,
    );

    // Step 1: Stop all other proxies
    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');
    await this.stopProxyIfRunning(this.lmStudioProxy, 'LM Studio');

    // Step 2: Get the base URL (custom or default from provider entry)
    const customUrl = this.config.get<string>(
      `provider.${provider.id}.baseUrl`,
    );
    const baseUrl = customUrl?.trim() || getProviderBaseUrl(provider.id);

    // Step 2.5: Version check — verify Ollama v0.14.0+ for Anthropic API support
    try {
      const { version, supported } = await this.ollamaDiscovery.checkVersion(
        provider.id,
      );

      if (!supported) {
        this.logger.warn(
          `[AuthManager] Ollama v${version} does not support Anthropic Messages API. Minimum: v0.14.0.`,
        );
        return {
          configured: false,
          details: [],
          errorMessage: `Ollama v${version} is too old. Please upgrade to v0.14.0+ for Anthropic API support (download from ollama.com/download).`,
        };
      }

      this.logger.info(
        `[AuthManager] Ollama v${version} — Anthropic Messages API supported`,
      );
    } catch {
      this.logger.warn(
        `[AuthManager] Ollama server not reachable at ${baseUrl}. Ensure Ollama is running.`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: `Ollama is not reachable at ${baseUrl}. Ensure Ollama is running.`,
      };
    }

    // Step 2.6: Model availability check
    try {
      const models =
        provider.id === 'ollama-cloud'
          ? await this.ollamaDiscovery.listCloudModels()
          : await this.ollamaDiscovery.listLocalModels();

      if (provider.id === 'ollama-cloud' && models.length === 0) {
        this.logger.warn(
          `[AuthManager] Ollama Cloud: no cloud models found. Run "ollama signin" to authenticate with Ollama Cloud.`,
        );
      }
    } catch (modelError) {
      this.logger.warn(
        `[AuthManager] Failed to list Ollama models: ${
          modelError instanceof Error ? modelError.message : String(modelError)
        }`,
      );
      // Non-fatal: proceed with configuration even if model listing fails
    }

    // Step 3: Point SDK directly at Ollama (no proxy)
    this.authEnv.ANTHROPIC_BASE_URL = baseUrl;
    this.authEnv.ANTHROPIC_AUTH_TOKEN = OLLAMA_AUTH_TOKEN_PLACEHOLDER;
    process.env['ANTHROPIC_BASE_URL'] = baseUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = OLLAMA_AUTH_TOKEN_PLACEHOLDER;

    // Step 4: Apply tier mappings and register dynamic model fetcher
    this.providerModels.switchActiveProvider(provider.id);

    // Register the appropriate model fetcher (local vs cloud)
    if (provider.id === 'ollama-cloud') {
      this.providerModels.registerDynamicFetcher(provider.id, () =>
        this.ollamaDiscovery.listCloudModels(),
      );
    } else {
      this.providerModels.registerDynamicFetcher(provider.id, () =>
        this.ollamaDiscovery.listLocalModels(),
      );
    }

    this.logger.info(
      `[AuthManager] Using ${providerName} (Anthropic-native at ${baseUrl})`,
    );
    this.logger.info(
      `[AuthManager] Set ANTHROPIC_BASE_URL=${baseUrl}, ANTHROPIC_AUTH_TOKEN=<ollama>`,
    );

    return {
      configured: true,
      details: [`${providerName} (Anthropic-native at ${baseUrl})`],
    };
  }

  /**
   * Configure GitHub Copilot OAuth provider (TASK_2025_186).
   * Uses VS Code GitHub authentication and the Copilot translation proxy.
   */
  private async configureCopilotOAuth(provider: {
    id: string;
    name: string;
    staticModels?: Array<{ id: string }>;
  }): Promise<AuthResult> {
    const providerName = provider.name;

    this.logger.info(
      `[AuthManager] Configuring OAuth provider: ${providerName}`,
    );

    // Step 1: Check if already authenticated, if not try silent restore
    // IMPORTANT: Do NOT call copilotAuth.login() here. The full login()
    // triggers an interactive device code flow (dialog + 5-minute polling)
    // which blocks startup and prevents the window from being created.
    // Instead, try silent file-based token restoration. If that fails,
    // the user can manually trigger login from the Settings UI.
    const isAuthed = await this.copilotAuth.isAuthenticated();
    if (!isAuthed) {
      this.logger.info(
        `[AuthManager] ${providerName} not authenticated, attempting silent restore...`,
      );
      const restored = await this.copilotAuth.tryRestoreAuth();
      if (!restored) {
        this.logger.info(
          `[AuthManager] ${providerName} silent restore failed — user can connect via Settings`,
        );
        return {
          configured: false,
          details: [],
          errorMessage: `${providerName} is not authenticated. Connect via Settings > Authentication.`,
        };
      }
    }

    // Step 2: Start the translation proxy
    let proxyUrl: string;
    try {
      if (this.copilotProxy.isRunning()) {
        proxyUrl = this.copilotProxy.getUrl()!;
        this.logger.info(
          `[AuthManager] Translation proxy already running at ${proxyUrl}`,
        );
      } else {
        const result = await this.copilotProxy.start();
        proxyUrl = result.url;
        this.logger.info(
          `[AuthManager] Translation proxy started at ${proxyUrl}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[AuthManager] Failed to start translation proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { configured: false, details: [] };
    }

    // Step 3: Point SDK at the proxy
    this.authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    this.authEnv.ANTHROPIC_AUTH_TOKEN = COPILOT_PROXY_TOKEN_PLACEHOLDER;
    // Sync to process.env — SDK reads these directly, not from the env option
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = COPILOT_PROXY_TOKEN_PLACEHOLDER;

    // Step 4: Apply tier mappings and seed pricing
    this.providerModels.switchActiveProvider(provider.id);
    seedStaticModelPricing(provider.id);

    this.logger.info(
      `[AuthManager] Using ${providerName} via translation proxy (${proxyUrl})`,
    );
    this.logger.info(
      `[AuthManager] Set ANTHROPIC_BASE_URL=${proxyUrl}, ANTHROPIC_AUTH_TOKEN=<proxy-managed>`,
    );

    return {
      configured: true,
      details: [`${providerName} (OAuth via translation proxy at ${proxyUrl})`],
    };
  }

  /**
   * Configure OpenAI Codex OAuth provider (TASK_2025_193).
   * Uses file-based auth from ~/.codex/auth.json and the Codex translation proxy.
   */
  private async configureCodexOAuth(provider: {
    id: string;
    name: string;
    staticModels?: Array<{ id: string }>;
  }): Promise<AuthResult> {
    const providerName = provider.name;

    this.logger.info(
      `[AuthManager] Configuring OAuth provider: ${providerName}`,
    );

    // Step 1: Verify Codex auth and ensure tokens are fresh
    const isAuthed = await this.codexAuth.isAuthenticated();
    if (!isAuthed) {
      this.logger.warn(
        `[AuthManager] ${providerName} not authenticated. Run \`codex login\` to authenticate.`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: `${providerName} is not authenticated. Run \`codex login\` in your terminal to set up authentication.`,
      };
    }

    const tokensFresh = await this.codexAuth.ensureTokensFresh();
    if (!tokensFresh) {
      this.logger.warn(
        `[AuthManager] ${providerName} token refresh failed. Run \`codex login\` to re-authenticate.`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: `${providerName} token has expired. Run \`codex login\` in your terminal to re-authenticate.`,
      };
    }

    // Step 2: Start the Codex translation proxy
    let proxyUrl: string;
    try {
      if (this.codexProxy.isRunning()) {
        proxyUrl = this.codexProxy.getUrl()!;
        this.logger.info(
          `[AuthManager] Codex translation proxy already running at ${proxyUrl}`,
        );
      } else {
        const result = await this.codexProxy.start();
        proxyUrl = result.url;
        this.logger.info(
          `[AuthManager] Codex translation proxy started at ${proxyUrl}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[AuthManager] Failed to start Codex translation proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return { configured: false, details: [] };
    }

    // Step 3: Point SDK at the Codex proxy
    this.authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    this.authEnv.ANTHROPIC_AUTH_TOKEN = CODEX_PROXY_TOKEN_PLACEHOLDER;
    // Sync to process.env — SDK reads these directly, not from the env option
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = CODEX_PROXY_TOKEN_PLACEHOLDER;

    // Step 4: Apply tier mappings and seed pricing
    this.providerModels.switchActiveProvider(provider.id);
    seedStaticModelPricing(provider.id);

    this.logger.info(
      `[AuthManager] Using ${providerName} via translation proxy (${proxyUrl})`,
    );
    this.logger.info(
      `[AuthManager] Set ANTHROPIC_BASE_URL=${proxyUrl}, ANTHROPIC_AUTH_TOKEN=<proxy-managed>`,
    );

    return {
      configured: true,
      details: [`${providerName} (OAuth via translation proxy at ${proxyUrl})`],
    };
  }

  /**
   * Configure a local proxy provider that requires no authentication (TASK_2025_265).
   * Now LM Studio only — Ollama uses configureOllamaProvider() instead (TASK_2025_281).
   *
   * Flow:
   * 1. Stop ALL other provider proxies (only one active at a time)
   * 2. Start the provider's translation proxy
   * 3. Point ANTHROPIC_BASE_URL to the proxy
   * 4. Set a placeholder auth token
   * 5. Register dynamic model fetcher for the provider
   */
  private async configureLocalProvider(provider: {
    id: string;
    name: string;
  }): Promise<AuthResult> {
    const providerName = provider.name;

    this.logger.info(
      `[AuthManager] Configuring local provider: ${providerName}`,
    );

    // Step 1: Stop other proxies to prevent cross-contamination
    await this.stopProxyIfRunning(this.copilotProxy, 'Copilot');
    await this.stopProxyIfRunning(this.codexProxy, 'Codex');

    // Step 2: LM Studio is the only proxy provider now (TASK_2025_281)
    const proxy = this.lmStudioProxy;

    // Step 3: Start the translation proxy
    let proxyUrl: string;
    try {
      if (proxy.isRunning()) {
        proxyUrl = proxy.getUrl()!;
        this.logger.info(
          `[AuthManager] ${providerName} translation proxy already running at ${proxyUrl}`,
        );
      } else {
        const result = await proxy.start();
        proxyUrl = result.url;
        this.logger.info(
          `[AuthManager] ${providerName} translation proxy started at ${proxyUrl}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `[AuthManager] Failed to start ${providerName} translation proxy: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return {
        configured: false,
        details: [],
        errorMessage: `${providerName} is not running. Start ${providerName} and try again.`,
      };
    }

    // Step 4: Point SDK at the proxy
    this.authEnv.ANTHROPIC_BASE_URL = proxyUrl;
    this.authEnv.ANTHROPIC_AUTH_TOKEN = LOCAL_PROXY_TOKEN_PLACEHOLDER;
    // Sync to process.env -- SDK reads these directly, not from the env option
    process.env['ANTHROPIC_BASE_URL'] = proxyUrl;
    process.env['ANTHROPIC_AUTH_TOKEN'] = LOCAL_PROXY_TOKEN_PLACEHOLDER;

    // Step 5: Apply tier mappings and register dynamic model fetcher
    this.providerModels.switchActiveProvider(provider.id);
    this.providerModels.registerDynamicFetcher(provider.id, () =>
      proxy.listModels(),
    );

    this.logger.info(
      `[AuthManager] Using ${providerName} via translation proxy (${proxyUrl})`,
    );
    this.logger.info(
      `[AuthManager] Set ANTHROPIC_BASE_URL=${proxyUrl}, ANTHROPIC_AUTH_TOKEN=<proxy-managed>`,
    );

    return {
      configured: true,
      details: [`${providerName} (local via translation proxy at ${proxyUrl})`],
    };
  }

  /**
   * Configure API key authentication
   * Reads from SecretStorage (primary) or env snapshot (fallback)
   */
  private async configureAPIKey(envSnapshot: EnvSnapshot): Promise<AuthResult> {
    const apiKey = await this.authSecrets.getCredential('apiKey');
    const envApiKey = envSnapshot.ANTHROPIC_API_KEY;
    const details: string[] = [];

    if (apiKey?.trim()) {
      const keyPrefix = apiKey.substring(0, 10);
      const keyLength = apiKey.length;
      const isValidFormat = apiKey.startsWith('sk-ant-api');

      this.logger.info(
        `[AuthManager] Found API key in SecretStorage (length: ${keyLength}, prefix: ${keyPrefix}..., valid format: ${isValidFormat})`,
      );

      if (!isValidFormat) {
        this.logger.warn(
          '[AuthManager] WARNING: API key does not start with "sk-ant-api". Expected format: sk-ant-api03-...',
        );
        this.logger.warn(
          '[AuthManager] Get valid API keys from: https://console.anthropic.com/settings/keys',
        );
      }

      this.authEnv.ANTHROPIC_API_KEY = apiKey.trim();
      // Sync to process.env — SDK reads these directly
      process.env['ANTHROPIC_API_KEY'] = apiKey.trim();
      details.push(
        `API key from SecretStorage (pay-per-token, format ${
          isValidFormat ? 'valid' : 'INVALID'
        })`,
      );

      try {
        this.providerModels.applyPersistedTiers(ANTHROPIC_DIRECT_PROVIDER_ID);
      } catch (e) {
        this.logger.warn(
          '[AuthManager] Failed to apply tier mappings for direct auth',
          e instanceof Error ? e : new Error(String(e)),
        );
      }

      return { configured: true, details };
    } else if (envApiKey) {
      const keyLength = envApiKey.length;
      const isValidFormat = envApiKey.startsWith('sk-ant-api');

      this.logger.info(
        `[AuthManager] Found API key in environment (length: ${keyLength}, valid format: ${isValidFormat})`,
      );

      if (!isValidFormat) {
        this.logger.warn(
          '[AuthManager] WARNING: Environment API key format may be invalid',
        );
      }

      // Restore the key from snapshot (it was cleared in clean slate)
      this.authEnv.ANTHROPIC_API_KEY = envApiKey;

      details.push(
        `API key from environment (pay-per-token, format ${
          isValidFormat ? 'valid' : 'INVALID'
        })`,
      );

      try {
        this.providerModels.applyPersistedTiers(ANTHROPIC_DIRECT_PROVIDER_ID);
      } catch (e) {
        this.logger.warn(
          '[AuthManager] Failed to apply tier mappings for direct auth',
          e instanceof Error ? e : new Error(String(e)),
        );
      }

      return { configured: true, details };
    } else {
      this.logger.debug(
        '[AuthManager] No API key found in SecretStorage or environment',
      );
      return { configured: false, details: [] };
    }
  }

  /**
   * Clear all authentication environment variables
   * Delegates to centralized cleanup methods
   */
  clearAuthentication(): void {
    this.clearAllAuthEnvVars();
    this.providerModels.clearAllTierEnvVars();

    // Stop Copilot translation proxy if running (TASK_2025_186)
    if (this.copilotProxy?.isRunning()) {
      this.copilotProxy.stop().catch((err) => {
        this.logger.warn(
          `[AuthManager] Failed to stop Copilot proxy during cleanup: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    // Stop Codex translation proxy if running (TASK_2025_193)
    if (this.codexProxy?.isRunning()) {
      this.codexProxy.stop().catch((err) => {
        this.logger.warn(
          `[AuthManager] Failed to stop Codex proxy during cleanup: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    // Clear Ollama model discovery cache (TASK_2025_281)
    this.ollamaDiscovery.clearCache();

    // Stop LM Studio proxy if running (TASK_2025_265, updated TASK_2025_281)
    // Ollama no longer uses a proxy — it speaks Anthropic API natively
    if (this.lmStudioProxy?.isRunning()) {
      this.lmStudioProxy.stop().catch((err) => {
        this.logger.warn(
          `[AuthManager] Failed to stop LM Studio proxy during cleanup: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    // Reset Codex auth service cache to prevent stale data on provider re-selection
    this.codexAuth.clearCache();

    this.logger.debug(
      '[AuthManager] Cleared authentication environment variables',
    );
  }

  /**
   * Capture current env values before cleanup (for shell fallback detection)
   * When users set env vars in their shell (e.g. ANTHROPIC_API_KEY),
   * we need to detect them even after the clean slate wipe.
   */
  private captureEnvSnapshot(): EnvSnapshot {
    return {
      ANTHROPIC_API_KEY: process.env['ANTHROPIC_API_KEY'],
      ANTHROPIC_BASE_URL: process.env['ANTHROPIC_BASE_URL'],
      ANTHROPIC_AUTH_TOKEN: process.env['ANTHROPIC_AUTH_TOKEN'],
      CLAUDE_CODE_OAUTH_TOKEN: process.env['CLAUDE_CODE_OAUTH_TOKEN'],
    };
  }

  /**
   * Delete ALL auth env vars from the AuthEnv singleton - single source of truth for cleanup.
   * Called once at the top of configureAuthentication() to ensure a clean slate.
   */
  private clearAllAuthEnvVars(): void {
    for (const varName of AUTH_ENV_VARS) {
      delete this.authEnv[varName as keyof AuthEnv];
      // Sync to process.env — SDK reads these directly
      delete process.env[varName];
    }
  }

  /**
   * Log boolean presence of all auth + tier env vars (no secrets)
   * Useful for debugging which auth method is active after configuration.
   */
  private logEnvSummary(): void {
    const authSummary = AUTH_ENV_VARS.map(
      (v) => `${v}=${this.authEnv[v as keyof AuthEnv] ? 'set' : 'unset'}`,
    ).join(', ');

    this.logger.debug(`[AuthManager] Env summary: ${authSummary}`);
  }
}
