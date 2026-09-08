// Planted fixture for the degradation-audit self-test — proves a valid
// suppression comment removes a site from the count.

export function readOptionalConfig(path: string): string | null {
  try {
    return loadFile(path);
    // degradation-audit: optional-capability — config file is optional, absence is not an error
  } catch (error: unknown) {
    return null;
  }
}

declare function loadFile(path: string): string;
