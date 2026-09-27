/**
 * IDiagnosticsProvider — Platform-agnostic workspace diagnostics access.
 *
 * The contract is capability-aware and async: every implementation returns a
 * `DiagnosticsResult` discriminated union so callers can distinguish "this
 * runtime has no diagnostics source" (`unavailable`) from "the source was
 * queried and reported zero issues" (`available` + empty `diagnostics`).
 *
 * Both arms may carry `coverage` and `notChecked` (TASK_2026_559 Batch 25a):
 * what the answer covered, and which files it did not check and why. A
 * provider that knows files went unchecked (another language, a cap, an
 * unscoped call that syntax-checks nothing) MUST say so there, because an
 * `available` answer with no diagnostics otherwise reads as "no errors".
 */

import type { LanguageCoverage } from './language-coverage.interface';

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

/**
 * Files one answer did not check, grouped by language and reason. A scoped
 * answer names the requested files (`files`, bounded); an unscoped answer
 * gives the count only.
 */
export interface NotCheckedFiles {
  /** Registry language id, recognised language id, or `other`. */
  readonly language: string;
  /** How many files of this group were not checked. */
  readonly count: number;
  /**
   * The requested files of this group, absolute, at most
   * {@link MAX_NOT_CHECKED_FILES_LISTED}; absent on an unscoped answer.
   */
  readonly files?: readonly string[];
  /** Why they were not checked, and what the caller can do about it. */
  readonly reason: string;
}

/** At most this many paths are listed per {@link NotCheckedFiles} group. */
export const MAX_NOT_CHECKED_FILES_LISTED = 10;

/**
 * Coverage fields shared by both arms. Optional: a provider that cannot know
 * what it covered (a live language-server source) leaves them out, and a
 * consumer then treats the answer as `provider-defined`, never as a complete
 * census.
 */
export interface DiagnosticsCoverageFields {
  /**
   * What this answer analysed and what it did not (Batch 22 contract). Its
   * `checks` says which kind of check was made; a syntax-only language is
   * named `<id>:syntax-only` in `approximations`.
   */
  readonly coverage?: LanguageCoverage;
  /** The files this answer did not check, and why. Absent when none. */
  readonly notChecked?: readonly NotCheckedFiles[];
  /**
   * Findings a checker reported at positions it cannot place in the
   * workspace (go vet after a `//line` directive, Batch 37b1a). Present only
   * when above 0. Such an answer is never clean, whatever `diagnostics` and
   * `coverage` say: those findings exist and are not listed.
   */
  readonly unmappedFindings?: number;
  /**
   * A checker listed only the first of its findings (go vet: 500). Present
   * only when true; the listed diagnostics are then not all there are.
   */
  readonly diagnosticsTruncated?: boolean;
  /**
   * The opt-in `go vet` run behind this answer (Batches 37a/37b): present when
   * the host attached the checker and Go files were requested. Its fixed
   * codes say why Go files were only syntax-checked (consent off or stale,
   * no toolchain, a failed run); `go vet` is never a type check.
   */
  readonly goVet?: GoVetRunReport;
}

/** How the opt-in `go vet` checker answered one call (fixed codes only). */
export interface GoVetRunReport {
  /** `checked` only after a clean vet exit with parseable output. */
  readonly status: 'checked' | 'unchecked' | 'failed';
  readonly outcome:
    'ok' | 'findings' | 'timeout' | 'failed' | 'too-large' | 'not-run';
  /**
   * Fixed reason code: the checker's own (`no-consent`, `consent-stale`,
   * `no-go-binary`, `unmapped-findings`, …), or `checker-error` when the
   * checker itself threw. Absent on a plain successful run.
   */
  readonly reason?: string;
  /** Why the stored consent no longer applies (User Decision 25). */
  readonly staleReason?: 'root-moved' | 'root-replaced' | 'go-changed';
  /** How many requested Go files vet covered. */
  readonly checkedFiles: number;
}

export type DiagnosticsResult =
  | ({
      status: 'available';
      source: string;
      diagnostics: FileDiagnostics[];
    } & DiagnosticsCoverageFields)
  | ({
      status: 'unavailable';
      source: string;
      reason: string;
    } & DiagnosticsCoverageFields);

/**
 * Narrows a check to the projects that own a set of files.
 *
 * An implementation that compiles (`TypeScriptDiagnosticsProvider`) pays for
 * the WHOLE workspace otherwise, and on a large monorepo that cost exceeds
 * every client timeout in the path — 297 `tsconfig*.json` files in this
 * repository, each producing its own program, measured at over 400 s with no
 * answer returned. The agent loop that hits this is the common one: edit two
 * files, ask what broke. Those two files name one project, and one project is
 * seconds of work.
 *
 * Honoring it is OPTIONAL and the semantics are a FLOOR, not a filter. An
 * implementation may return diagnostics for other files in the same project —
 * an edit that breaks a sibling file is exactly what the caller needs to see —
 * and one whose source is already live (`VscodeDiagnosticsProvider` reading the
 * language servers) may narrow to the named files and nothing more. What no
 * implementation may do is report `available` while silently checking LESS than
 * the projects owning these files.
 *
 * The floor governs TYPE-CHECK claims only (Batch 25a amendment). A provider
 * may also run a syntax-only check (a parser, no compiler, nothing spawned)
 * for a language it cannot type-check; such a check is never a type-check
 * claim. Its answer carries `coverage` with `checks` `'syntax-only'` (only
 * syntax-checked files) or `'mixed'` (with type-checked ones), and each
 * syntax-only language named `<id>:syntax-only` in `coverage.approximations`
 * (under the four-item overflow rule, the rest counted in
 * `approximationsOmitted`). `checks: 'type-check'` never accompanies a
 * syntax-only approximation.
 */
export interface DiagnosticsScope {
  /**
   * Absolute paths of the files of interest. Paths outside the workspace root
   * are ignored. An empty or absent list means "check the whole workspace".
   */
  readonly files?: readonly string[];
}

export interface IDiagnosticsProvider {
  getDiagnostics(
    workspaceRoot?: string,
    scope?: DiagnosticsScope,
  ): Promise<DiagnosticsResult>;

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
