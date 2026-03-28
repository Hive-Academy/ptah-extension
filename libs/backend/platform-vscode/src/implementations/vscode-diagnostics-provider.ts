/**
 * VscodeDiagnosticsProvider — IDiagnosticsProvider implementation using VS Code APIs.
 *
 * Wraps vscode.languages.getDiagnostics() and converts the VS Code DiagnosticSeverity
 * enum to platform-agnostic string literals ('error' | 'warning' | 'info' | 'hint').
 */

import * as vscode from 'vscode';
import type { IDiagnosticsProvider } from '@ptah-extension/platform-core';

export class VscodeDiagnosticsProvider implements IDiagnosticsProvider {
  getDiagnostics(): Array<{
    file: string;
    diagnostics: Array<{
      message: string;
      line: number;
      severity: 'error' | 'warning' | 'info' | 'hint';
    }>;
  }> {
    const vscDiagnostics = vscode.languages.getDiagnostics();
    const result: Array<{
      file: string;
      diagnostics: Array<{
        message: string;
        line: number;
        severity: 'error' | 'warning' | 'info' | 'hint';
      }>;
    }> = [];

    for (const [uri, diagnostics] of vscDiagnostics) {
      if (diagnostics.length === 0) {
        continue;
      }

      result.push({
        file: uri.fsPath,
        diagnostics: diagnostics.map((d) => ({
          message: d.message,
          line: d.range.start.line,
          severity: this.severityToString(d.severity),
        })),
      });
    }

    return result;
  }

  /**
   * Convert VS Code DiagnosticSeverity enum to platform-agnostic string literal.
   */
  private severityToString(
    severity: vscode.DiagnosticSeverity,
  ): 'error' | 'warning' | 'info' | 'hint' {
    switch (severity) {
      case vscode.DiagnosticSeverity.Error:
        return 'error';
      case vscode.DiagnosticSeverity.Warning:
        return 'warning';
      case vscode.DiagnosticSeverity.Information:
        return 'info';
      case vscode.DiagnosticSeverity.Hint:
        return 'hint';
      default:
        return 'hint';
    }
  }
}
