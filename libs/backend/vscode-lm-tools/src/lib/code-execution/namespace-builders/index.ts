/**
 * Namespace Builders Index
 *
 * Re-exports all namespace builder functions and their dependency interfaces.
 */

// AST namespace
export {
  buildAstNamespace,
  type AstNamespaceDependencies,
} from './ast-namespace.builder';

// Analysis namespaces (context, project, relevance)
export {
  buildContextNamespace,
  buildProjectNamespace,
  buildRelevanceNamespace,
  buildDependencyNamespace,
  type AnalysisNamespaceDependencies,
} from './analysis-namespace.builders';

// Core namespaces (workspace, search, diagnostics)
export {
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildDiagnosticsNamespace,
  type CoreNamespaceDependencies,
} from './core-namespace.builders';

// System namespaces (ai, files) + help method
export {
  buildAINamespace,
  buildFilesNamespace,
  buildHelpMethod,
  type SystemNamespaceDependencies,
} from './system-namespace.builders';

// IDE namespace (lsp, editor, actions, testing)
export { buildIDENamespace } from './ide-namespace.builder';

// LLM namespace (VS Code LM provider)
export {
  buildLLMNamespace,
  type LlmNamespaceDependencies,
} from './llm-namespace.builder';

// Orchestration namespace (TASK_2025_111 - workflow state management)
export {
  buildOrchestrationNamespace,
  type OrchestrationNamespaceDependencies,
} from './orchestration-namespace.builder';

// Agent namespace (TASK_2025_157 - async agent orchestration)
export {
  buildAgentNamespace,
  type AgentNamespaceDependencies,
} from './agent-namespace.builder';
