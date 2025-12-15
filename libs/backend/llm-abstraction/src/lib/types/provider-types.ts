/**
 * Centralized LLM Provider Type Definitions
 *
 * TASK_2025_073 - Batch 1, Task 1.1
 * Moved from llm-secrets.service.ts for better cohesion and single responsibility.
 * All provider-related types should be imported from this file.
 *
 * @packageDocumentation
 */

/**
 * Supported LLM provider identifiers
 *
 * @remarks
 * - anthropic: Claude models via Langchain
 * - openai: GPT models via Langchain
 * - google-genai: Gemini models via Langchain
 * - openrouter: Multi-provider access via Langchain
 * - vscode-lm: VS Code Language Model API (no API key needed)
 */
export type LlmProviderName =
  | 'anthropic'
  | 'openai'
  | 'google-genai'
  | 'openrouter'
  | 'vscode-lm';

/**
 * List of all supported providers (for validation and iteration)
 *
 * @remarks
 * Use this array to validate provider names at runtime or iterate all providers.
 */
export const SUPPORTED_PROVIDERS: readonly LlmProviderName[] = [
  'anthropic',
  'openai',
  'google-genai',
  'openrouter',
  'vscode-lm',
] as const;

/**
 * Provider display names for UI presentation
 *
 * @remarks
 * Use these human-readable names when showing providers to users.
 */
export const PROVIDER_DISPLAY_NAMES: Record<LlmProviderName, string> = {
  anthropic: 'Anthropic (Claude)',
  openai: 'OpenAI (GPT)',
  'google-genai': 'Google (Gemini)',
  openrouter: 'OpenRouter',
  'vscode-lm': 'VS Code Language Model',
} as const;

/**
 * Default models per provider
 *
 * @remarks
 * These are fallback defaults when no model is specified in settings.
 * Users can override these via VS Code settings.
 *
 * For vscode-lm, the format is 'vendor/family' (e.g., 'copilot/gpt-4o').
 * This allows the provider to correctly select models from VS Code's LM API.
 */
export const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-4o',
  'google-genai': 'gemini-1.5-pro',
  openrouter: 'anthropic/claude-sonnet-4',
  'vscode-lm': 'copilot/gpt-4o', // Format: vendor/family for VS Code LM API
} as const;

/**
 * Type guard to check if a string is a valid provider name
 *
 * @param name - String to validate
 * @returns true if name is a valid LlmProviderName
 *
 * @example
 * ```typescript
 * const userInput = 'anthropic';
 * if (isValidProviderName(userInput)) {
 *   // TypeScript now knows userInput is LlmProviderName
 *   const model = DEFAULT_MODELS[userInput];
 * }
 * ```
 */
export function isValidProviderName(name: string): name is LlmProviderName {
  return SUPPORTED_PROVIDERS.includes(name as LlmProviderName);
}
