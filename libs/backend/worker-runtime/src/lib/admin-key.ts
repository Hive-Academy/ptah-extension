import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { ensureWorkerDirectory, WorkerPaths } from './paths';

export async function createAdminKey(paths: WorkerPaths): Promise<Buffer> {
  await ensureWorkerDirectory(paths);
  const key = randomBytes(32);
  const temporary = `${paths.adminKey}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(temporary, key, { mode: 0o600, flag: 'wx' });
  await rename(temporary, paths.adminKey);
  return key;
}

export async function readAdminKey(paths: WorkerPaths): Promise<Buffer> {
  const key = await readFile(paths.adminKey);
  if (key.length !== 32) throw new Error('Invalid worker admin key');
  return key;
}

export function verifyAdminKey(
  expected: Uint8Array,
  candidate: Uint8Array,
): boolean {
  return (
    expected.length === 32 &&
    candidate.length === 32 &&
    timingSafeEqual(expected, candidate)
  );
}
