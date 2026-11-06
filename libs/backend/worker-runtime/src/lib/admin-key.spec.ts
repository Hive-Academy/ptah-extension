import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import {
  ADMIN_PROOF_CONTEXT,
  adminProof,
  createAdminKey,
  verifyAdminProof,
} from './admin-key';
import { workerPaths } from './paths';

describe('admin key', () => {
  it('creates fresh private 32-byte material on each start', async () => {
    const home = await mkdtemp(join(tmpdir(), 'worker-admin-'));
    try {
      const paths = workerPaths(home);
      const first = await createAdminKey(paths);
      const second = await createAdminKey(paths);
      expect(first).toHaveLength(32);
      expect(first).not.toEqual(second);
      expect((await stat(paths.adminKey)).mode & 0o777).toBe(0o600);
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('proves the key with an HMAC bound to the challenge and context', () => {
    const key = Buffer.alloc(32, 7);
    const other = Buffer.alloc(32, 8);
    const proof = adminProof(key, 'challenge-1');
    expect(proof).toBe(
      createHmac('sha256', key)
        .update(`challenge-1\n${ADMIN_PROOF_CONTEXT}`)
        .digest('base64url'),
    );
    expect(proof).not.toContain(key.toString('base64url'));
    expect(verifyAdminProof(key, 'challenge-1', proof)).toBe(true);
    expect(verifyAdminProof(key, 'challenge-2', proof)).toBe(false);
    expect(verifyAdminProof(other, 'challenge-1', proof)).toBe(false);
    expect(verifyAdminProof(key, 'challenge-1', 'short')).toBe(false);
    // The raw key is not a valid proof.
    expect(
      verifyAdminProof(key, 'challenge-1', key.toString('base64url')),
    ).toBe(false);
  });
});
