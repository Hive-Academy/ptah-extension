/**
 * Namespace Builders Index
 *
 * Re-exports all namespace builder functions and their dependency interfaces.
 */
export {
  buildAstNamespace,
  type AstNamespaceDependencies,
} from './ast-namespace.builder';
export {
  buildContextNamespace,
  buildProjectNamespace,
  buildRelevanceNamespace,
  buildDependencyNamespace,
  type AnalysisNamespaceDependencies,
} from './analysis-namespace.builders';
export {
  buildWorkspaceNamespace,
  buildSearchNamespace,
  buildDiagnosticsNamespace,
  type CoreNamespaceDependencies,
} from './core-namespace.builders';
export {
  buildFilesNamespace,
  buildHelpMethod,
  type SystemNamespaceDependencies,
} from './system-namespace.builders';
export {
  buildIDENamespace,
  type IIDECapabilities,
} from './ide-namespace.builder';
export {
  buildOrchestrationNamespace,
  type OrchestrationNamespaceDependencies,
} from './orchestration-namespace.builder';
export {
  buildAgentNamespace,
  type AgentNamespaceDependencies,
} from './agent-namespace.builder';
export {
  buildGitNamespace,
  type GitNamespaceDependencies,
} from './git-namespace.builder';
export {
  buildJsonNamespace,
  type JsonNamespaceDependencies,
} from './json-namespace.builder';
export {
  buildBrowserNamespace,
  type IBrowserCapabilities,
  type BrowserSessionOptions,
  type BrowserNamespaceDependencies,
  validateBrowserUrl,
} from './browser-namespace.builder';
export {
  buildSkillNamespace,
  type SkillNamespaceDependencies,
  type SkillNamespace,
  type PromotedSkillRecord,
} from './skill-namespace.builder';
export {
  buildMemoryNamespace,
  type MemoryNamespaceDependencies,
  type MemoryNamespace,
} from './memory-namespace.builder';
export {
  buildCorpusNamespace,
  type CorpusNamespaceDependencies,
  type CorpusNamespace,
} from './corpus-namespace.builder';
export {
  buildCodeNamespace,
  type CodeNamespaceDependencies,
  type CodeNamespace,
  type SymbolSearchResult,
  type ReindexResult,
} from './code-namespace.builder';
export {
  buildHarnessNamespace,
  type HarnessNamespaceDependencies,
  type HarnessNamespace,
} from './harness-namespace.builder';
