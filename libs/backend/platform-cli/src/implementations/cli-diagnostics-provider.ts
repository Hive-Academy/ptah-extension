/**
 * CliDiagnosticsProvider — IDiagnosticsProvider implementation for CLI.
 *
 * Returns an empty diagnostics list. The CLI does not have a live language server
 * to provide real-time diagnostics. A future enhancement could integrate tree-sitter
 * syntax error detection or run `tsc --noEmit` and parse the output.
 *
 * No external imports required — pure stub with correct interface contract.
 *
 * Copied from ElectronDiagnosticsProvider (identical logic, CLI class prefix).
 */

import type { IDiagnosticsProvider } from '@ptah-extension/platform-core';

export class CliDiagnosticsProvider implements IDiagnosticsProvider {
  getDiagnostics(): Array<{
    file: string;
    diagnostics: Array<{
      message: string;
      line: number;
      severity: 'error' | 'warning' | 'info' | 'hint';
    }>;
  }> {
    // CLI has no live language server. Return empty diagnostics.
    // Future: integrate tree-sitter parse errors or `tsc --noEmit` output.
    return [];
  }
}
