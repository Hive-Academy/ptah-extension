// Planted fixture for the degradation-audit self-test (Revision 2, B-1/S-3).
// A `degradation-audit:` marker that does not sit in any of the three
// recognised zones for any catch/.catch() site — e.g. left behind after a
// refactor moved the code it used to annotate. Must be reported as
// `orphaned-suppression`, never silently ignored.

// degradation-audit: optional-capability — this used to annotate a catch block
// that has since been deleted; nothing below is a catch or .catch() site.
export function plainHelper(value: number): number {
  return value * 2;
}
