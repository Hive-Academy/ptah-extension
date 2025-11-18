/**
 * Language Model Tools Registration Service
 *
 * Registers all Ptah workspace tools with VS Code's Language Model API
 */

import * as vscode from 'vscode';
import { injectable, container } from 'tsyringe';
import { AnalyzeWorkspaceTool } from './tools/analyze-workspace.tool';
import { SearchFilesTool } from './tools/search-files.tool';
import { GetRelevantFilesTool } from './tools/get-relevant-files.tool';
import { GetDiagnosticsTool } from './tools/get-diagnostics.tool';
import { FindSymbolTool } from './tools/find-symbol.tool';
import { GetGitStatusTool } from './tools/get-git-status.tool';

/**
 * Service responsible for registering all Language Model Tools
 *
 * @example
 * ```typescript
 * const registrationService = container.resolve(LMToolsRegistrationService);
 * registrationService.registerAll(context);
 * ```
 */
@injectable()
export class LMToolsRegistrationService implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];

  /**
   * Register all Language Model Tools with VS Code
   *
   * @param context - Extension context for managing disposables
   */
  registerAll(context: vscode.ExtensionContext): void {
    // Resolve tool instances from DI container
    const analyzeWorkspace = container.resolve(AnalyzeWorkspaceTool);
    const searchFiles = container.resolve(SearchFilesTool);
    const getRelevantFiles = container.resolve(GetRelevantFilesTool);
    const getDiagnostics = container.resolve(GetDiagnosticsTool);
    const findSymbol = container.resolve(FindSymbolTool);
    const getGitStatus = container.resolve(GetGitStatusTool);

    // Register each tool with VS Code
    const registrations = [
      vscode.lm.registerTool('ptah_analyze_workspace', analyzeWorkspace),
      vscode.lm.registerTool('ptah_search_files', searchFiles),
      vscode.lm.registerTool('ptah_get_relevant_files', getRelevantFiles),
      vscode.lm.registerTool('ptah_get_diagnostics', getDiagnostics),
      vscode.lm.registerTool('ptah_find_symbol', findSymbol),
      vscode.lm.registerTool('ptah_get_git_status', getGitStatus),
    ];

    // Store disposables
    this.disposables.push(...registrations);
    registrations.forEach((reg) => context.subscriptions.push(reg));

    console.log('[Ptah LM Tools] Registered 6 Language Model Tools');
  }

  /**
   * Dispose of all registrations
   */
  dispose(): void {
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
    this.disposables = [];
  }
}
