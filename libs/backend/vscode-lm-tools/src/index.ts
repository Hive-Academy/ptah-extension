/**
 * VS Code Language Model Tools Library
 *
 * Provides native VS Code Language Model Tools that wrap workspace-intelligence services.
 * These tools enable GitHub Copilot and other language models to interact with the workspace.
 */

// Tool exports
export { AnalyzeWorkspaceTool } from './lib/tools/analyze-workspace.tool';
export { SearchFilesTool } from './lib/tools/search-files.tool';
export { GetRelevantFilesTool } from './lib/tools/get-relevant-files.tool';
export { GetDiagnosticsTool } from './lib/tools/get-diagnostics.tool';
export { FindSymbolTool } from './lib/tools/find-symbol.tool';
export { GetGitStatusTool } from './lib/tools/get-git-status.tool';

// Service exports
export { LMToolsRegistrationService } from './lib/lm-tools-registration.service';

// Type exports
export type {
  IAnalyzeWorkspaceParameters,
  ISearchFilesParameters,
  IGetRelevantFilesParameters,
  IGetDiagnosticsParameters,
  IFindSymbolParameters,
  IGetGitStatusParameters,
} from './lib/types/tool-parameters';
