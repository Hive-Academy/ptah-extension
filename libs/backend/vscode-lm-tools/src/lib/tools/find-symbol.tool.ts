/**
 * Find Symbol Tool
 *
 * Searches for classes, functions, types, or interfaces across the workspace
 */

import * as vscode from 'vscode';
import { injectable } from 'tsyringe';
import { IFindSymbolParameters } from '../types/tool-parameters';

@injectable()
export class FindSymbolTool
  implements vscode.LanguageModelTool<IFindSymbolParameters>
{
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IFindSymbolParameters>
  ): Promise<vscode.PreparedToolInvocation> {
    const { symbolName, symbolType } = options.input;

    return {
      invocationMessage: `Searching for symbol "${symbolName}"...`,
      confirmationMessages: {
        title: 'Find Symbol',
        message: new vscode.MarkdownString(
          `Search for **${symbolName}**?` +
            (symbolType && symbolType !== 'any'
              ? `\n\n- Type: ${symbolType}`
              : '')
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IFindSymbolParameters>
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { symbolName, symbolType = 'any' } = options.input;

      // Use VS Code's workspace symbol search
      const symbols = await vscode.commands.executeCommand<
        vscode.SymbolInformation[]
      >('vscode.executeWorkspaceSymbolProvider', symbolName);

      if (!symbols || symbols.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No symbols found matching "${symbolName}". Try:\n` +
              `- Checking the spelling\n` +
              `- Using partial names (e.g., "User" instead of "UserService")\n` +
              `- Ensuring the file is indexed by the language server`
          ),
        ]);
      }

      // Filter by symbol type if specified
      const symbolKindMap: Record<string, vscode.SymbolKind[]> = {
        class: [vscode.SymbolKind.Class],
        function: [vscode.SymbolKind.Function, vscode.SymbolKind.Method],
        interface: [vscode.SymbolKind.Interface],
        type: [vscode.SymbolKind.TypeParameter, vscode.SymbolKind.Struct],
        variable: [
          vscode.SymbolKind.Variable,
          vscode.SymbolKind.Property,
          vscode.SymbolKind.Field,
        ],
        any: Object.values(vscode.SymbolKind).filter(
          (k) => typeof k === 'number'
        ) as vscode.SymbolKind[],
      };

      const filteredSymbols =
        symbolType && symbolType !== 'any'
          ? symbols.filter((s) => symbolKindMap[symbolType]?.includes(s.kind))
          : symbols;

      if (filteredSymbols.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `Found ${symbols.length} symbol(s) named "${symbolName}", but none match type "${symbolType}".`
          ),
        ]);
      }

      const symbolList = filteredSymbols
        .slice(0, 20) // Limit to first 20 results
        .map((s) => {
          const kindName = vscode.SymbolKind[s.kind];
          const location = vscode.workspace.asRelativePath(s.location.uri);
          const line = s.location.range.start.line + 1;
          const container = s.containerName ? ` in ${s.containerName}` : '';
          return `- **${s.name}** (${kindName}${container})\n  📄 ${location}:${line}`;
        })
        .join('\n');

      const more =
        filteredSymbols.length > 20
          ? `\n\n... and ${filteredSymbols.length - 20} more results.`
          : '';

      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Found ${filteredSymbols.length} symbol(s) matching "${symbolName}":\n\n${symbolList}${more}`
        ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to find symbol: ${message}`);
    }
  }
}
