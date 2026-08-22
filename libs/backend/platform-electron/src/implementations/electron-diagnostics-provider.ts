/**
 * ElectronDiagnosticsProvider — Phase 0 fallback IDiagnosticsProvider for Electron.
 *
 * Returns an explicit `unavailable` result. The real diagnostics provider
 * (`TypeScriptDiagnosticsProvider` from `workspace-intelligence`) overrides
 * this token after workspace-intelligence registration in the Electron DI
 * composition (phase-2-libraries.ts).
 */

import type {
  IDiagnosticsProvider,
  DiagnosticsResult,
} from '@ptah-extension/platform-core';

export class ElectronDiagnosticsProvider implements IDiagnosticsProvider {
  async getDiagnostics(): Promise<DiagnosticsResult> {
    return {
      status: 'unavailable',
      source: 'electron-phase0',
      reason: 'Diagnostics not configured for this Electron runtime.',
    };
  }
}
