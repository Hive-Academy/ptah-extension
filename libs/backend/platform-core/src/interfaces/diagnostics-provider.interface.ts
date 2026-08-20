/**
 * IDiagnosticsProvider — Platform-agnostic workspace diagnostics access.
 *
 * The contract is capability-aware and async: every implementation returns a
 * `DiagnosticsResult` discriminated union so callers can distinguish "this
 * runtime has no diagnostics source" (`unavailable`) from "the source was
 * queried and reported zero issues" (`available` + empty `diagnostics`).
 */

export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface DiagnosticEntry {
  message: string;
  line: number;
  severity: DiagnosticSeverity;
  code?: string | number;
}

export interface FileDiagnostics {
  file: string;
  diagnostics: DiagnosticEntry[];
}

export type DiagnosticsResult =
  | { status: 'available'; source: string; diagnostics: FileDiagnostics[] }
  | { status: 'unavailable'; source: string; reason: string };

export interface IDiagnosticsProvider {
  getDiagnostics(workspaceRoot?: string): Promise<DiagnosticsResult>;
}
