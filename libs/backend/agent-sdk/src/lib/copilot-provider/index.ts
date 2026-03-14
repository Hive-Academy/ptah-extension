/**
 * Copilot Provider Module - Barrel exports
 *
 * @see TASK_2025_186 - Copilot Provider Integration
 * @see TASK_2025_193 - Shared OpenAI translation module extraction
 */

// Auth service (injectable, stateful)
export { CopilotAuthService } from './copilot-auth.service';

// Translation proxy (injectable, thin subclass of TranslationProxyBase)
export { CopilotTranslationProxy } from './copilot-translation-proxy';

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

// Copilot-specific type exports
export type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
  CopilotAuthState,
  CopilotTokenResponse,
} from './copilot-provider.types';

// ---------------------------------------------------------------------------
// Backward-compatible re-exports from shared openai-translation module
// (TASK_2025_193: translators moved to openai-translation/)
// ---------------------------------------------------------------------------

// Response translator (renamed: CopilotResponseTranslator -> OpenAIResponseTranslator)
export { OpenAIResponseTranslator as CopilotResponseTranslator } from '../openai-translation';

// Request translator (pure functions, stateless)
export {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateMessages,
  translateTools,
  translateToolChoice,
} from '../openai-translation';

// Protocol type re-exports for backward compatibility
export type {
  AnthropicMessagesRequest,
  OpenAIChatCompletionsRequest,
  OpenAIStreamChunk,
} from '../openai-translation';
