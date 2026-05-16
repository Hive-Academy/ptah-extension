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

// System namespaces (files) + help method
export {
  buildFilesNamespace,
  buildHelpMethod,
  type SystemNamespaceDependencies,
} from './system-namespace.builders';

// IDE namespace (lsp, editor, actions, testing)
export {
  buildIDENamespace,
  type IIDECapabilities,
} from './ide-namespace.builder';
// NOTE: VscodeIDECapabilities is NOT exported here to prevent the Electron bundler
// from resolving ide-capabilities.vscode.ts (which imports `vscode` directly).
// Import it from the subpath: '@ptah-extension/vscode-lm-tools/vscode'

// Orchestration namespace (workflow state management)
export {
  buildOrchestrationNamespace,
  type OrchestrationNamespaceDependencies,
} from './orchestration-namespace.builder';

// Agent namespace (async agent orchestration)
export {
  buildAgentNamespace,
  type AgentNamespaceDependencies,
} from './agent-namespace.builder';

// Git namespace (worktree operations)
export {
  buildGitNamespace,
  type GitNamespaceDependencies,
} from './git-namespace.builder';

// JSON namespace (JSON validation and repair)
export {
  buildJsonNamespace,
  type JsonNamespaceDependencies,
} from './json-namespace.builder';

// Browser namespace (CDP browser integration)
export {
  buildBrowserNamespace,
  type IBrowserCapabilities,
  type BrowserSessionOptions,
  type BrowserNamespaceDependencies,
  validateBrowserUrl,
} from './browser-namespace.builder';

// Skill namespace (ptah.skill.list + ptah.skill.describe)
export {
  buildSkillNamespace,
  type SkillNamespaceDependencies,
  type SkillNamespace,
  type PromotedSkillRecord,
} from './skill-namespace.builder';

// Memory namespace (ptah.memory.search + ptah.memory.list)
export {
  buildMemoryNamespace,
  type MemoryNamespaceDependencies,
  type MemoryNamespace,
} from './memory-namespace.builder';

// Code symbol indexer namespace (ptah.code.searchSymbols + ptah.code.reindex)
export {
  buildCodeNamespace,
  type CodeNamespaceDependencies,
  type CodeNamespace,
  type SymbolSearchResult,
  type ReindexResult,
} from './code-namespace.builder';
