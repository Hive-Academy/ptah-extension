import { mkdir, rmdir } from 'node:fs/promises';

/** A directory creation is atomic across processes sharing the worker data path. */
export async function withFileLock<T>(
  file: string,
  operation: () => Promise<T>,
): Promise<T> {
  const lock = `${file}.lock`;
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      await mkdir(lock);
      break;
    } catch (error) {
      if (!isOccupied(error)) throw error;
      if (Date.now() >= deadline)
        throw new Error(`Worker file is busy: ${file}`, { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await operation();
  } finally {
    await rmdir(lock);
  }
}

function isOccupied(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'EEXIST'
  );
}
