/**
 * Copilot Provider Module - Barrel exports
 *
 * @see TASK_2025_186 Batch 1 - Copilot Provider Core
 */

// Auth service (injectable, stateful)
export { CopilotAuthService } from './copilot-auth.service';

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
export { COPILOT_PROVIDER_ENTRY } from './copilot-provider-entry';

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
