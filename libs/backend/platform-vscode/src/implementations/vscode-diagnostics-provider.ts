/**
 * VscodeDiagnosticsProvider — IDiagnosticsProvider implementation using VS Code APIs.
 *
 * Wraps vscode.languages.getDiagnostics() and converts the VS Code
 * DiagnosticSeverity enum to platform-agnostic string literals. Returns an
 * `available` result always (VS Code always has the language API). When a
 * workspace root is provided, diagnostics are filtered to files within that root.
 */

import * as vscode from 'vscode';
import { isPathWithinRoots } from '@ptah-extension/platform-core';
import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
  FileDiagnostics,
  DiagnosticSeverity,
} from '@ptah-extension/platform-core';

export class VscodeDiagnosticsProvider implements IDiagnosticsProvider {
  /**
   * @param platform Node platform string. Parameterized for the same reason
   *   {@link isPathWithinRoots} takes one — so a spec can drive the win32
   *   case-fold rule on a Linux CI runner. Hosts never pass it.
   */
  constructor(private readonly platform: NodeJS.Platform = process.platform) {}

  async getDiagnostics(workspaceRoot?: string): Promise<DiagnosticsResult> {
    const vscDiagnostics = vscode.languages.getDiagnostics();
    const result: FileDiagnostics[] = [];

    for (const [uri, diagnostics] of vscDiagnostics) {
      if (diagnostics.length === 0) {
        continue;
      }

      // Filter to workspace root when provided, through the shared containment
      // predicate rather than a local `path.relative(...).startsWith('..')`.
      //
      // This is a CONSOLIDATION, not a bug fix (TASK_2026_303). The task was
      // opened on the premise that `path.relative` is case-sensitive even on
      // win32, so a root and a `uri.fsPath` differing only in casing would drop
      // a real diagnostic. That premise is FALSE: Node's `path.win32.relative`
      // lower-cases both operands before comparing, so the old form and this
      // one agree on every case that was measured. What is true is that the old
      // form's correctness rested on that undocumented Node behaviour, in one
      // of three hand-rolled copies of a rule the repo already owns as a
      // tested, platform-explicit predicate. One copy is better than three.
      if (
        workspaceRoot &&
        !isPathWithinRoots(uri.fsPath, [workspaceRoot], this.platform)
      ) {
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
