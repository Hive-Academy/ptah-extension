// Planted fixture for the degradation-audit self-test (Revision 1, S-1).
// Proves all three accepted separators suppress correctly: ASCII hyphen,
// en dash, and em dash. None of these three sites should appear as an
// unsuppressed violation.

export function readWithHyphen(path: string): string | null {
  try {
    return loadFile(path);
    // degradation-audit: optional-capability - config file is optional, ASCII hyphen
  } catch (error: unknown) {
    return null;
  }
}

export function readWithEnDash(path: string): string | null {
  try {
    return loadFile(path);
    // degradation-audit: optional-capability – config file is optional, en dash
  } catch (error: unknown) {
    return null;
  }
}

export function readWithEmDash(path: string): string | null {
  try {
    return loadFile(path);
    // degradation-audit: optional-capability — config file is optional, em dash
  } catch (error: unknown) {
    return null;
  }
}

declare function loadFile(path: string): string;
