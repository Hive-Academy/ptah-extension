// Planted fixture for the degradation-audit self-test (Revision 1, S-1).
// A `degradation-audit:` marker that does not fully parse — wrong kind name,
// or a separator character outside the accepted set — must NEVER silently
// drop the site. It is always surfaced as a `bare-suppression` violation, and
// the underlying site remains counted (the suppression did not apply).

export function readWithUnknownKind(path: string): string | null {
  try {
    return loadFile(path);
    // degradation-audit: not-a-real-kind — this kind does not exist
  } catch (error: unknown) {
    return null;
  }
}

declare function loadFile(path: string): string;
