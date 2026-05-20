/**
 * Copilot Provider Module - Barrel exports
 *
 */
export { CopilotAuthService } from './copilot-auth.service';
export { VscodeCopilotAuthService } from './vscode-copilot-auth.service';
export {
  readCopilotToken,
  getCopilotHostsPath,
  getCopilotAppsPath,
  writeCopilotToken,
} from './copilot-file-auth';
export type { CopilotHostsFile } from './copilot-file-auth';
export { CopilotTranslationProxy } from './copilot-translation-proxy';
export {
  COPILOT_PROVIDER_ENTRY,
  COPILOT_DEFAULT_TIERS,
} from '@ptah-extension/shared';
export {
  COPILOT_PROXY_TOKEN_PLACEHOLDER,
  COPILOT_OAUTH_SENTINEL,
} from './copilot-provider.types';
export type {
  ICopilotAuthService,
  ICopilotTranslationProxy,
  CopilotAuthState,
  CopilotTokenResponse,
} from './copilot-provider.types';
export { OpenAIResponseTranslator as CopilotResponseTranslator } from '../../translation';
export {
  translateAnthropicToOpenAI,
  translateSystemPrompt,
  translateMessages,
  translateTools,
  translateToolChoice,
} from '../../translation';
export type {
  AnthropicMessagesRequest,
  OpenAIChatCompletionsRequest,
  OpenAIStreamChunk,
} from '../../translation';
