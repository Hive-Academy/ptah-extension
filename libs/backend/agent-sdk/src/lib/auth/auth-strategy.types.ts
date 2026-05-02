/**
 * Auth Strategy Interface - TASK_AUTH_REFACTOR Phase 2
 *
 * Every auth strategy implements this interface. The AuthManager delegates
 * to the appropriate strategy based on resolveStrategy().
 *
 * Lifecycle:
 *   1. configure(context) — set up auth env vars, start proxies, validate credentials
 *   2. teardown()         — stop proxies, clear caches
 *
 * The strategy OWNS the proxy lifecycle: configure() starts it, teardown() stops it.
 * AuthManager never touches proxies directly.
 */

import type { AuthEnv } from '@ptah-extension/shared';

/** Result of strategy.configure() */
export interface AuthConfigureResult {
  /** Whether authentication was successfully configured */
  configured: boolean;
  /** Human-readable details for logging */
  details: string[];
  /** Error message when configured === false */
  errorMessage?: string;
}

/** Context passed to every strategy's configure() method */
export interface AuthConfigureContext {
  /** The provider ID (e.g., 'openrouter', 'github-copilot', 'ollama') */
  providerId: string;
  /** The shared mutable AuthEnv singleton — strategies write their env vars here */
  authEnv: AuthEnv;
  /**
   * Process.env values captured before clean slate wipe (for fallback detection).
   *
   * `ANTHROPIC_API_KEY` supports the direct-Anthropic flow. `ANTHROPIC_AUTH_TOKEN`
   * + `ANTHROPIC_BASE_URL` support headless third-party flows (e.g. the openclaw
   * bridge that pre-sets these instead of populating the secret store).
   */
  envSnapshot?: {
    ANTHROPIC_API_KEY?: string;
    ANTHROPIC_AUTH_TOKEN?: string;
    ANTHROPIC_BASE_URL?: string;
  };
}

/**
 * Interface that all 5 auth strategies implement.
 *
 * Each strategy handles one authentication flow pattern:
 * - ApiKeyStrategy:       SecretStorage → env var
 * - OAuthProxyStrategy:   OAuth token → translation proxy → env var
 * - LocalNativeStrategy:  Local server → env var (no proxy)
 * - LocalProxyStrategy:   Local server → translation proxy → env var
 * - CliStrategy:          Claude CLI health check (no env vars)
 */
export interface IAuthStrategy {
  /** Human-readable name for logging (e.g., 'ApiKeyStrategy') */
  readonly name: string;

  /**
   * Configure authentication for this strategy.
   *
   * Responsibilities:
   * - Set ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN on authEnv
   * - Sync to process.env (SDK subprocess reads these)
   * - Start translation proxy if needed
   * - Apply tier mappings via ProviderModelsService
   * - Register dynamic model fetchers if needed
   * - Validate credentials format
   */
  configure(context: AuthConfigureContext): Promise<AuthConfigureResult>;

  /**
   * Tear down this strategy's resources.
   *
   * Responsibilities:
   * - Stop translation proxy if running
   * - Clear any caches (model cache, auth cache)
   * - Does NOT clear env vars (AuthManager handles clean slate)
   */
  teardown(): Promise<void>;
}
