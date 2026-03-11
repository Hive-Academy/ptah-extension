/**
 * Orchestration patterns extracted from roocode-generator.
 *
 * These patterns provide reusable abstractions for:
 * - Partial success in batch operations (error-accumulation)
 * - Sequential multi-phase pipelines (generation-pipeline)
 * - LLM prompt building (prompt-builder)
 *
 * @module patterns
 */

export * from './error-accumulation';
export * from './generation-pipeline';
export * from './prompt-builder';
