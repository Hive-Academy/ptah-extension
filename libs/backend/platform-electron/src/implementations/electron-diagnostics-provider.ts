/**
 * ElectronDiagnosticsProvider — IDiagnosticsProvider implementation for Electron.
 *
 * Returns an empty diagnostics list. Electron does not have a live language server
 * to provide real-time diagnostics. A future enhancement could integrate tree-sitter
 * syntax error detection or run `tsc --noEmit` and parse the output.
 *
 * No Electron imports required — pure stub with correct interface contract.
 */

import type { IDiagnosticsProvider } from '@ptah-extension/platform-core';

export class ElectronDiagnosticsProvider implements IDiagnosticsProvider {
  getDiagnostics(): Array<{
    file: string;
    diagnostics: Array<{
      message: string;
      line: number;
      severity: 'error' | 'warning' | 'info' | 'hint';
    }>;
  }> {
    // Electron has no live language server. Return empty diagnostics.
    // Future: integrate tree-sitter parse errors or `tsc --noEmit` output.
    return [];
  }
}
