/**
 * Copilot Provider Module - Barrel exports
 *
 */

// Auth service (injectable, stateful - platform-agnostic base class)
export { CopilotAuthService } from './copilot-auth.service';

// VS Code-enhanced auth service (adds native GitHub OAuth via vscode.authentication)
export { VscodeCopilotAuthService } from './vscode-copilot-auth.service';

// File-based auth utilities (cross-platform token reading and writing)
export {
  readCopilotToken,
  getCopilotHostsPath,
  getCopilotAppsPath,
  writeCopilotToken,
} from './copilot-file-auth';
export type { CopilotHostsFile } from './copilot-file-auth';

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
// ---------------------------------------------------------------------------

// Response translator (renamed: CopilotResponseTranslator -> OpenAIResponseTranslator)
export { OpenAIResponseTranslator as CopilotResponseTranslator } from '../_shared/translation';

// Request translator (pure functions, stateless)
export {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateMessages,
  translateTools,
  translateToolChoice,
} from '../_shared/translation';

// Protocol type re-exports for backward compatibility
export type {
  AnthropicMessagesRequest,
  OpenAIChatCompletionsRequest,
  OpenAIStreamChunk,
} from '../_shared/translation';
