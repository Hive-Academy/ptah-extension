/**
 * IDiagnosticsProvider — Platform-agnostic workspace diagnostics access.
 *
 * Replaces: vscode.languages.getDiagnostics(), vscode.DiagnosticSeverity
 *
 * VS Code implementation: Wraps vscode.languages.getDiagnostics() with severity
 * enum-to-string conversion.
 * Electron implementation: Returns [] (no live language server). Future: could
 * run `tsc --noEmit --pretty false` and parse output.
 */

export interface IDiagnosticsProvider {
  /**
   * Get all diagnostics across the workspace.
   * Replaces: vscode.languages.getDiagnostics()
   *
   * @returns Array of file diagnostics. Each entry has a file path and its diagnostics.
   */
  getDiagnostics(): Array<{
    file: string;
    diagnostics: Array<{
      message: string;
      line: number;
      severity: 'error' | 'warning' | 'info' | 'hint';
    }>;
  }>;
}
