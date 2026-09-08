// Planted fixture for the degradation-audit self-test (Revision 2, B-1/S-3
// Zone 1). A two-line wrapped comment directly above the `catch` keyword —
// the marker is on the FIRST of the two lines, not the one immediately
// adjacent to `catch`. Must still suppress (mirrors
// cli-master-key-provider.ts:156-159).

export async function loadOptional(path: string): Promise<string | null> {
  try {
    return await loadFile(path);
    // degradation-audit: optional-capability — this module is optional; absent on
    // some hosts, and the caller already has a fallback path.
  } catch (error: unknown) {
    return null;
  }
}

declare function loadFile(path: string): Promise<string>;
