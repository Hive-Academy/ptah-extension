// Planted fixture for the degradation-audit self-test.

export function ignoreFailure(path: string): void {
  try {
    loadFile(path);
  } catch (error: unknown) {}
}

declare function loadFile(path: string): string;
