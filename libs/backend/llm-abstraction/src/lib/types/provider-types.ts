/**
 * Centralized LLM Provider Type Definitions
 *
 * TASK_2025_073 - Batch 1, Task 1.1 (original)
 * TASK_2025_155 - Batch 1, Task 1.3 (removed anthropic/openrouter, native SDK migration)
 *
 * Moved from llm-secrets.service.ts for better cohesion and single responsibility.
 * All provider-related types should be imported from this file.
 *
 * @packageDocumentation
 */

/**
 * Supported LLM provider identifiers
 *
 * @remarks
 * - openai: GPT models via native OpenAI SDK
 * - google-genai: Gemini models via native @google/genai SDK
 * - vscode-lm: VS Code Language Model API (no API key needed)
 */
export type LlmProviderName = 'openai' | 'google-genai' | 'vscode-lm';

/**
 * List of all supported providers (for validation and iteration)
 *
 * @remarks
 * Use this array to validate provider names at runtime or iterate all providers.
 */
export const SUPPORTED_PROVIDERS: readonly LlmProviderName[] = [
  'openai',
  'google-genai',
  'vscode-lm',
] as const;

/**
 * Provider display names for UI presentation
 *
 * @remarks
 * Use these human-readable names when showing providers to users.
 */
export const PROVIDER_DISPLAY_NAMES: Record<LlmProviderName, string> = {
  openai: 'OpenAI (GPT)',
  'google-genai': 'Google (Gemini)',
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
  openai: 'gpt-4o',
  'google-genai': 'gemini-2.5-flash',
  'vscode-lm': 'copilot/gpt-4o',
} as const;

/**
 * Type guard to check if a string is a valid provider name
 *
 * @param name - String to validate
 * @returns true if name is a valid LlmProviderName
 *
 * @example
 * ```typescript
 * const userInput = 'openai';
 * if (isValidProviderName(userInput)) {
 *   // TypeScript now knows userInput is LlmProviderName
 *   const model = DEFAULT_MODELS[userInput];
 * }
 * ```
 */
export function isValidProviderName(name: string): name is LlmProviderName {
  return SUPPORTED_PROVIDERS.includes(name as LlmProviderName);
}
