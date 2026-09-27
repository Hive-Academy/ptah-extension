/**
 * Violation model and deterministic output for `i18n-check`.
 *
 * Every rule reports into one list; the list is sorted by file, line, kind and
 * key before printing, so two runs over the same tree print byte-identical
 * output (plan Component 2, "deterministic output order").
 */

export type ViolationKind =
  | 'parse-error'
  | 'missing-file'
  | 'sole-default-key'
  | 'invalid-value'
  | 'duplicate-key'
  | 'dotted-key'
  | 'missing-in-ar'
  | 'missing-in-en'
  | 'placeholder-mismatch'
  | 'markup-mismatch'
  | 'disallowed-tag'
  | 'glossary-invalid'
  | 'glossary-term-missing'
  | 'not-arabic'
  | 'verbatim-mismatch'
  | 'unknown-key'
  | 'foreign-scope'
  | 'unannotated-computed-key'
  | 'invalid-key-const'
  | 'bare-marker'
  | 'not-a-group'
  | 'no-source-files'
  | 'duplicate-key-constant';

export interface Violation {
  /** Workspace-relative path with forward slashes. */
  file: string;
  /** 1-based line; 0 when the violation concerns the whole file. */
  line: number;
  kind: ViolationKind;
  /** The translation key concerned, or '' when none applies. */
  key: string;
  detail: string;
}

export function compareViolations(a: Violation, b: Violation): number {
  return (
    compareText(a.file, b.file) ||
    a.line - b.line ||
    compareText(a.kind, b.kind) ||
    compareText(a.key, b.key) ||
    compareText(a.detail, b.detail)
  );
}

/** Sorts and removes exact duplicates (the same site reached by two rules). */
export function normaliseViolations(
  violations: readonly Violation[],
): Violation[] {
  const sorted = [...violations].sort(compareViolations);
  return sorted.filter(
    (v, i) => i === 0 || compareViolations(v, sorted[i - 1]) !== 0,
  );
}

/** `file:line: [kind] key - detail`; the key and detail parts are omitted when empty. */
export function formatViolation(v: Violation): string {
  const key = v.key ? ` ${v.key}` : '';
  const detail = v.detail ? ` - ${v.detail}` : '';
  return `${v.file}:${v.line}: [${v.kind}]${key}${detail}`;
}

/** Code-point order, independent of the host locale. */
function compareText(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}
