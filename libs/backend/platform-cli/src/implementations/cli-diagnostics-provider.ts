/**
 * CliDiagnosticsProvider — Phase 0 fallback IDiagnosticsProvider for CLI.
 *
 * Returns an explicit `unavailable` result. The real diagnostics provider
 * (`TypeScriptDiagnosticsProvider` from `workspace-intelligence`) overrides
 * this token after workspace-intelligence registration in the CLI DI
 * composition (cli-engine container.ts).
 */

import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
} from '@ptah-extension/platform-core';

export class CliDiagnosticsProvider implements IDiagnosticsProvider {
  async getDiagnostics(): Promise<DiagnosticsResult> {
    return {
      status: 'unavailable',
      source: 'cli-phase0',
      reason: 'Diagnostics not configured for this CLI runtime.',
    };
  }
}
