/**
 * Copilot Provider Module - Barrel exports
 *
 * @see TASK_2025_186 - Copilot Provider Integration
 */

// Auth service (injectable, stateful)
export { CopilotAuthService } from './copilot-auth.service';

// Translation proxy (injectable, manages local HTTP server)
export { CopilotTranslationProxy } from './copilot-translation-proxy';

// Response translator (stateful, create per-request)
export { CopilotResponseTranslator } from './copilot-response-translator';

// Request translator (pure functions, stateless)
export {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateMessages,
  translateTools,
  translateToolChoice,
} from './copilot-request-translator';

// Provider registry entry (static data)
export {
  COPILOT_PROVIDER_ENTRY,
  COPILOT_DEFAULT_TIERS,
} from './copilot-provider-entry';

// Constants
export {
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  COPILOT_OAUTH_SENTINEL,
} from './copilot-provider.types';

// Type exports
export type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
  CopilotAuthState,
  CopilotTokenResponse,
  AnthropicMessagesRequest,
  OpenAIChatCompletionsRequest,
  OpenAIStreamChunk,
} from './copilot-provider.types';
