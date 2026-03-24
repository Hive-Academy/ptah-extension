/**
 * Copilot Provider Types - TASK_2025_186 Batch 1, slimmed TASK_2025_193 Batch 2
 *
 * Copilot-specific types only. OpenAI/Anthropic protocol types have been
 * extracted to the shared openai-translation module (TASK_2025_193).
 *
 * Backward-compatible re-exports ensure existing consumers continue to work.
 */

// ---------------------------------------------------------------------------
// Backward-compatible re-exports from shared openai-translation module
// (TASK_2025_193: protocol types moved to openai-translation)
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
} from '../openai-translation';

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
 * Returned by `GET https://api.github.com/copilot_internal/v2/token`.
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
 * Copilot authentication service interface.
 * Handles GitHub OAuth login and Copilot bearer token lifecycle.
 */
export interface ICopilotAuthService {
  /** Initiate GitHub OAuth login and exchange for Copilot bearer token */
  login(): Promise<boolean>;
  /** Check whether a valid (non-expired) Copilot bearer token is available */
  isAuthenticated(): Promise<boolean>;
  /** Get the current auth state, or null if not authenticated */
  getAuthState(): Promise<CopilotAuthState | null>;
  /** Get HTTP headers required for Copilot API requests */
  getHeaders(): Promise<Record<string, string>>;
  /** Clear cached auth state (logout) */
  logout(): Promise<void>;
}
