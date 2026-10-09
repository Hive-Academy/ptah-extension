/** Preserves JavaScript's default string sort order without locale-dependent collation. */
export function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
