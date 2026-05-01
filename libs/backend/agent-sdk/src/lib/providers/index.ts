/**
 * Agent SDK Providers — umbrella barrel.
 *
 * Each provider sub-folder owns its own auth service, translation proxy,
 * provider-entry constant, and types. The _shared sub-module holds
 * infrastructure every provider needs: the AnthropicProvider contract and
 * the OpenAI <-> Anthropic translation base/utilities.
 *
 * External consumers MUST import from the root @ptah-extension/agent-sdk
 * barrel, not this umbrella. This file exists so the top-level barrel has
 * one stable deep path per provider concern, and so intra-library code can
 * reach a sibling provider through a single import line.
 *
 * Consolidated under providers/ in TASK_2025_291 Wave C3.
 */

// Shared provider infrastructure.
export * from './_shared';

// Per-provider sub-modules.
export * from './codex';
export * from './copilot';
export * from './local';
export * from './openrouter';

// DI registration helper (extracted from di/register.ts:407-487 in Wave C3).
export { registerProviders } from './register-providers';
