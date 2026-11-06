import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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

/** Binds an admin proof to this protocol use, so the HMAC means nothing elsewhere. */
export const ADMIN_PROOF_CONTEXT = 'ptah-worker/admin-auth/v1';

/**
 * The admin `auth` proof: HMAC-SHA256(adminKey, challenge + context), as
 * base64url. The challenge is the connection's `hello` `adminChallenge`.
 */
export function adminProof(key: Uint8Array, challenge: string): string {
  return createHmac('sha256', key)
    .update(`${challenge}\n${ADMIN_PROOF_CONTEXT}`)
    .digest('base64url');
}

/** Constant-time check of an admin proof against this connection's challenge. */
export function verifyAdminProof(
  key: Uint8Array,
  challenge: string,
  candidate: string,
): boolean {
  if (key.length !== 32) return false;
  const expected = Buffer.from(adminProof(key, challenge), 'base64url');
  const actual = Buffer.from(candidate, 'base64url');
  return actual.length === expected.length && timingSafeEqual(expected, actual);
}
