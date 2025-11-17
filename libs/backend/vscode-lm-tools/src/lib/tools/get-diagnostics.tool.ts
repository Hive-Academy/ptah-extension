/**
 * Get Diagnostics Tool
 *
 * Gets VS Code diagnostics (errors, warnings) for files or entire workspace
 */

import * as vscode from 'vscode';
import { injectable } from 'tsyringe';
import { IGetDiagnosticsParameters } from '../types/tool-parameters';

@injectable()
export class GetDiagnosticsTool
  implements vscode.LanguageModelTool<IGetDiagnosticsParameters>
{
  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<IGetDiagnosticsParameters>
  ): Promise<vscode.PreparedToolInvocation> {
    const { filePath, severity } = options.input;

    return {
      invocationMessage: filePath
        ? `Getting diagnostics for ${filePath}...`
        : 'Getting workspace diagnostics...',
      confirmationMessages: {
        title: 'Get Diagnostics',
        message: new vscode.MarkdownString(
          `Get diagnostics${
            filePath ? ` for **${filePath}**` : ' for entire workspace'
          }?` + (severity ? `\n\n- Severity filter: ${severity}` : '')
        ),
      },
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<IGetDiagnosticsParameters>
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const { filePath, severity } = options.input;

      const severityMap: Record<string, vscode.DiagnosticSeverity> = {
        error: vscode.DiagnosticSeverity.Error,
        warning: vscode.DiagnosticSeverity.Warning,
        info: vscode.DiagnosticSeverity.Information,
        hint: vscode.DiagnosticSeverity.Hint,
      };

      let diagnostics: [vscode.Uri, vscode.Diagnostic[]][];

      if (filePath) {
        const uri = vscode.Uri.file(filePath);
        const fileDiagnostics = vscode.languages.getDiagnostics(uri);
        diagnostics = [[uri, fileDiagnostics]];
      } else {
        diagnostics = vscode.languages.getDiagnostics();
      }

      // Filter by severity if specified
      if (severity) {
        const targetSeverity = severityMap[severity];
        diagnostics = diagnostics
          .map(([uri, diags]): [vscode.Uri, vscode.Diagnostic[]] => [
            uri,
            diags.filter((d) => d.severity === targetSeverity),
          ])
          .filter(([, diags]) => diags.length > 0);
      }

      if (diagnostics.length === 0) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart(
            `No diagnostics found${
              severity ? ` with severity "${severity}"` : ''
            }.`
          ),
        ]);
      }

      const formatDiagnostics = diagnostics
        .map(([uri, diags]) => {
          const fileName = vscode.workspace.asRelativePath(uri);
          const diagList = diags
            .map((d) => {
              const severityIcon = ['🔴', '⚠️', 'ℹ️', '💡'][d.severity] || '•';
              const location = `Line ${d.range.start.line + 1}:${
                d.range.start.character + 1
              }`;
              return `  ${severityIcon} ${location} - ${d.message}${
                d.source ? ` [${d.source}]` : ''
              }`;
            })
            .join('\n');

          return `**${fileName}** (${diags.length} issues):\n${diagList}`;
        })
        .join('\n\n');

      const totalIssues = diagnostics.reduce(
        (sum, [, diags]) => sum + diags.length,
        0
      );
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Found ${totalIssues} diagnostic issue(s) in ${diagnostics.length} file(s):\n\n${formatDiagnostics}`
        ),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      throw new Error(`Failed to get diagnostics: ${message}`);
    }
  }
}
