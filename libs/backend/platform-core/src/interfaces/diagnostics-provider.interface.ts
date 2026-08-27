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

  /**
   * Drop any cached result for one root, or for every root when called with no
   * argument. Never re-runs the check — warming a result nobody has asked for
   * is work for an answer that may never be requested.
   *
   * **Optional, and deliberately so.** An implementation that answers from a
   * source which is already live has nothing to invalidate:
   * `VscodeDiagnosticsProvider` reads `vscode.languages.getDiagnostics()`,
   * which the language servers keep current, so requiring the method here
   * would force it to carry a no-op that reads as if it did something. Absence
   * is the honest signal that the implementation holds no state a writer could
   * make stale.
   *
   * **An implementation that DOES cache MUST implement it**, because a cache
   * keyed on the workspace root has no change signal of its own — nothing in
   * that key moves when a source file does. `TypeScriptDiagnosticsProvider` is
   * the case this exists for: it holds a short per-root result cache, and the
   * core prompt tells every agent to check diagnostics AFTER it edits files,
   * so "read, fix, read again" is the normal path rather than an edge case.
   * Without this call the second read is answered from before the fix.
   *
   * **Callers MUST invoke it optionally** (`provider.invalidate?.(root)`) and
   * MUST NOT treat its absence as an error — see
   * `DiagnosticsCacheInvalidator` in `@ptah-extension/vscode-lm-tools`, which
   * subscribes to the SDK `PostToolUse` hook and calls this after every agent
   * `Write` / `Edit` / `NotebookEdit`.
   */
  invalidate?(workspaceRoot?: string): void;
}
