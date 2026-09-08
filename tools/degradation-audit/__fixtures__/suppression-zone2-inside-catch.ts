// Planted fixture for the degradation-audit self-test (Revision 2, B-1/S-3
// Zone 2). The marker sits as the first line(s) INSIDE a bare `catch {}`
// block, not above the `catch` keyword. Must still suppress (mirrors
// cli-master-key-provider.ts:168-172).

export function loadOptionalSync(path: string): string | null {
  try {
    return loadFileSync(path);
  } catch {
    // degradation-audit: optional-capability — a synchronous failure here is the
    // same optional-module case; same fallback, same reason it must not throw.
    return null;
  }
}

declare function loadFileSync(path: string): string;
