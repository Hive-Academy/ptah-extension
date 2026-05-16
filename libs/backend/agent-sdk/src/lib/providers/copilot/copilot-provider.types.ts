/**
 * Copilot Provider Types
 *
 * Copilot-specific types only. OpenAI/Anthropic protocol types have been
 * extracted to the shared openai-translation module.
 *
 * Backward-compatible re-exports ensure existing consumers continue to work.
 */

// ---------------------------------------------------------------------------
// Backward-compatible re-exports from shared openai-translation module
// ---------------------------------------------------------------------------

export type {
  ITranslationProxy as ICopilotTranslationProxy,
  OpenAIChatMessage,
  OpenAIContentPart,
  OpenAITextPart,
  OpenAIImagePart,
  OpenAIToolCall,
  OpenAIToolDefinition,
  OpenAIChatCompletionsRequest,
  OpenAIStreamChunk,
  OpenAIStreamChoice,
  OpenAIToolCallDelta,
  AnthropicContentBlock,
  AnthropicTextBlock,
  AnthropicImageBlock,
  AnthropicToolUseBlock,
  AnthropicToolResultBlock,
  AnthropicMessage,
  AnthropicSystemPrompt,
  AnthropicToolDefinition,
  AnthropicToolChoice,
  AnthropicMessagesRequest,
} from '../_shared/translation';

// ---------------------------------------------------------------------------
// Copilot Constants
// ---------------------------------------------------------------------------

/** Placeholder API key used when the translation proxy manages auth internally */
export const COPILOT_PROXY_TOKEN_PLACEHOLDER = 'copilot-proxy-managed';

/** Sentinel value identifying a Copilot OAuth-based provider configuration */
export const COPILOT_OAUTH_SENTINEL = 'copilot-oauth';

// ---------------------------------------------------------------------------
// Copilot Authentication Types
// ---------------------------------------------------------------------------

/**
 * Response from the Copilot token exchange endpoint.
 * Returned by the configured token exchange endpoint (see `ptah.provider.github-copilot.tokenExchangeUrl` setting).
 */
export interface CopilotTokenResponse {
  /** The Copilot bearer token for API authentication */
  token: string;
  /** Unix timestamp (seconds) when the token expires */
  expires_at: number;
  /** Optional endpoint overrides from the token response */
  endpoints?: {
    /** The API base URL to use (may differ from default) */
    api: string;
  };
}

/**
 * Internal authentication state cached by CopilotAuthService.
 * Contains both the GitHub OAuth token and the exchanged Copilot bearer token.
 */
export interface CopilotAuthState {
  /** GitHub OAuth access token (from VS Code authentication) */
  githubToken: string;
  /** Copilot bearer token (exchanged from GitHub token) */
  bearerToken: string;
  /** Unix timestamp (seconds) when the bearer token expires */
  expiresAt: number;
  /** Copilot API endpoint (default: https://api.githubcopilot.com) */
  apiEndpoint: string;
}

/**
 * Metadata returned from the GitHub Device Code endpoint, surfaced as the
 * result of {@link ICopilotAuthService.beginLogin}. The CLI uses these fields
 * to construct an `oauth.url.open` JSON-RPC request to the connected client;
 * the webview UX wires them to its own clipboard + browser-open flow.
 */
export interface CopilotDeviceLoginInfo {
  /** Opaque GitHub device code — the key for {@link ICopilotAuthService.pollLogin}. */
  deviceCode: string;
  /** Short human-friendly code the user types into the verification page. */
  userCode: string;
  /** URL the user must open in a browser to authorize the device. */
  verificationUri: string;
  /** Server-recommended polling interval (seconds). */
  interval: number;
  /** Server-recommended expiry for the device code (seconds). */
  expiresIn: number;
}

/**
 * Options accepted by {@link ICopilotAuthService.pollLogin}.
 *
 * - `intervalSeconds` overrides the server-recommended polling interval.
 * - `timeoutMs` caps the total polling duration. Defaults to 5 minutes.
 * - `signal` allows an external `AbortController` to cancel polling. Cancelling
 *   has the same effect as calling {@link ICopilotAuthService.cancelLogin}:
 *   the promise resolves with `false` and no token is persisted.
 */
export interface CopilotPollLoginOptions {
  intervalSeconds?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Copilot authentication service interface.
 * Handles GitHub OAuth login and Copilot bearer token lifecycle.
 */
export interface ICopilotAuthService {
  /** Initiate GitHub OAuth login and exchange for Copilot bearer token */
  login(): Promise<boolean>;
  /**
   * Attempt to restore authentication silently from persisted tokens.
   * Tries file-based token reading and VS Code auth (if available) but
   * does NOT trigger the interactive device code flow.
   * Used during startup to avoid blocking the UI with auth dialogs.
   */
  tryRestoreAuth(): Promise<boolean>;
  /** Check whether a valid (non-expired) Copilot bearer token is available */
  isAuthenticated(): Promise<boolean>;
  /** Get the current auth state, or null if not authenticated */
  getAuthState(): Promise<CopilotAuthState | null>;
  /** Get HTTP headers required for Copilot API requests */
  getHeaders(): Promise<Record<string, string>>;
  /** Clear cached auth state (logout) */
  logout(): Promise<void>;

  // ---------------------------------------------------------------------------
  // Headless-friendly device-code API
  //
  // The legacy `login()` is preserved verbatim for the webview UX. The split
  // begin/poll/cancel surface lets the headless CLI surface the device-code
  // metadata to the connected client over JSON-RPC and drive polling itself
  // (so the CLI process can multiplex polling with stdio I/O and react to
  // SIGINT cleanly).
  // ---------------------------------------------------------------------------

  /**
   * Step 1: request a fresh GitHub device code and stash the metadata needed
   * to poll for the access token. The returned `deviceCode` is the key that
   * must be passed to {@link pollLogin} and {@link cancelLogin}.
   *
   * Multiple concurrent flows are supported — each call produces a distinct
   * `deviceCode` and is tracked independently. Pending entries are auto-pruned
   * 10 minutes after creation to bound memory usage if a caller never polls.
   */
  beginLogin(): Promise<CopilotDeviceLoginInfo>;

  /**
   * Step 2: poll GitHub for the access token associated with a `deviceCode`
   * previously returned by {@link beginLogin}. On success, the token is
   * exchanged for a Copilot bearer token, persisted to disk via
   * `writeCopilotToken`, and the in-memory auth state is populated — exactly
   * mirroring the legacy `login()` post-exchange behavior.
   *
   * @returns `true` when a token was obtained AND exchanged successfully.
   *          `false` when the flow timed out, was cancelled, the device code
   *          is unknown, the user denied access, or the exchange failed.
   *          Never throws for these cases.
   */
  pollLogin(
    deviceCode: string,
    opts?: CopilotPollLoginOptions,
  ): Promise<boolean>;

  /**
   * Cancel an in-flight {@link pollLogin} for the given `deviceCode`. The
   * corresponding `pollLogin` promise resolves with `false` and the pending
   * entry is removed from the in-memory map. No-op if `deviceCode` is unknown
   * (e.g. polling already completed or was never started).
   */
  cancelLogin(deviceCode: string): void;
}
