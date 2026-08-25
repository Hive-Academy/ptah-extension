/**
 * VscodeDiagnosticsProvider — IDiagnosticsProvider implementation using VS Code APIs.
 *
 * Wraps vscode.languages.getDiagnostics() and converts the VS Code
 * DiagnosticSeverity enum to platform-agnostic string literals. Returns an
 * `available` result always (VS Code always has the language API). When a
 * workspace root is provided, diagnostics are filtered to files within that root.
 */

import * as vscode from 'vscode';
import * as path from 'path';
import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
  FileDiagnostics,
  DiagnosticSeverity,
} from '@ptah-extension/platform-core';

export class VscodeDiagnosticsProvider implements IDiagnosticsProvider {
  async getDiagnostics(workspaceRoot?: string): Promise<DiagnosticsResult> {
    const vscDiagnostics = vscode.languages.getDiagnostics();
    const result: FileDiagnostics[] = [];

    const normRoot = workspaceRoot
      ? path.resolve(workspaceRoot).replace(/\\/g, '/')
      : undefined;

    for (const [uri, diagnostics] of vscDiagnostics) {
      if (diagnostics.length === 0) {
        continue;
      }

      const filePath = uri.fsPath.replace(/\\/g, '/');

      // Filter to workspace root when provided.
      if (normRoot) {
        const rel = path.relative(normRoot, filePath).replace(/\\/g, '/');
        if (rel.startsWith('..') || path.isAbsolute(rel)) {
          continue;
        }
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

    return {
      status: 'available',
      source: 'vscode-languages',
      diagnostics: result,
    };
  }

  private severityToString(
    severity: vscode.DiagnosticSeverity,
  ): DiagnosticSeverity {
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
