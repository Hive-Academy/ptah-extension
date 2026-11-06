/**
 * DI tokens owned by workspace-intelligence (the service tokens it shares
 * with other libs stay in `@ptah-extension/vscode-core` `TOKENS`).
 */
export const WORKSPACE_INTELLIGENCE_TOKENS = {
  /**
   * ITreeSitterWorkerFactory: host-implemented spawner of the tree-sitter
   * worker process. Injected `{ isOptional: true }`: a host that registers
   * none (VS Code, CLI) parses in-process. Register it BEFORE
   * `registerWorkspaceIntelligenceServices`, which resolves the parser.
   */
  TREE_SITTER_WORKER_FACTORY: Symbol.for('PtahTreeSitterWorkerFactory'),
} as const;
