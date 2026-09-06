// Planted fixture for `--self-test-parse-guard` (Revision 1, style-review
// Serious 1). Deliberately unbalanced syntax — must make `detectInFile`
// throw via the `parseDiagnostics` check, proving the parse-failure guard is
// still live on this TypeScript version. Excluded from the normal
// `--self-test` glob (see `runSelfTest` in check-degradation.ts).
export function broken( {
  return undefined;
}
