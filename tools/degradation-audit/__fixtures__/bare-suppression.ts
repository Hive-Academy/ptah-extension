// Planted fixture for the degradation-audit self-test — proves a marker
// with no reason is itself a violation and does NOT suppress the site.

export function readConfigBareSuppression(path: string): string | null {
  try {
    return loadFile(path);
    // degradation-audit: optional-capability
  } catch (error: unknown) {
    return null;
  }
}

declare function loadFile(path: string): string;
