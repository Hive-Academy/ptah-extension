/**
 * Prompt Harness Module
 *
 * Re-exports the Ptah core system prompt used by InternalQueryService.
 * Enhanced Prompts feature (PromptDesignerAgent, PromptCacheService,
 * EnhancedPromptsService) lives in `@ptah-extension/agent-generation`.
 */

export {
  PTAH_CORE_SYSTEM_PROMPT,
  PTAH_CORE_SYSTEM_PROMPT_TOKENS,
  PTAH_MCP_MANDATE_PROMPT,
  PTAH_MCP_SUBSTITUTION_SECTION,
} from './ptah-core-prompt';
