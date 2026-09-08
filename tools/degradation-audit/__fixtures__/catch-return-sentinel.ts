// Planted fixture for the degradation-audit self-test. Never suppress this
// file — it exists so the self-test always has something real to detect.

export function readConfigOrNull(path: string): string | null {
  try {
    return loadFile(path);
  } catch (error: unknown) {
    return null;
  }
}

export function readConfigWithLogging(path: string): string | null {
  try {
    return loadFile(path);
  } catch (error: unknown) {
    logger.error('failed to read config', error);
    return null;
  }
}

declare function loadFile(path: string): string;
declare const logger: { error: (...args: unknown[]) => void };
