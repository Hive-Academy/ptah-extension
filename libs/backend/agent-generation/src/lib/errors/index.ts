/**
 * Error Classes Barrel Export
 *
 * Centralized export point for all error classes in the agent-generation library.
 * Provides a clean import path for error handling:
 * `import { AgentGenerationError, TemplateError } from '@ptah-extension/agent-generation';`
 *
 * @module @ptah-extension/agent-generation/errors
 */

// Base error and error codes
export {
  AgentGenerationError,
  type AgentGenerationErrorCode,
} from './agent-generation.error';

// Specialized error classes
export { TemplateError } from './template.error';
export { ContentGenerationError } from './generation.error';
export { ValidationError } from './validation.error';
export { LlmGenerationError } from './llm-generation.error';
export { FileWriteError } from './file-write.error';
