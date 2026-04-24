/**
 * `cli-secret-storage.spec.ts` — runs `runSecretStorageContract` against
 * `CliSecretStorage`, plus CLI-specific checks for AES-GCM round-trip
 * persistence, corruption recovery, and restart behaviour.
 *
 * The impl derives its key from the host `os.hostname()`/`os.userInfo()` pair,
 * so specs do not stub the crypto; they just point the storage at a tmpdir so
 * writes never touch the user's real `~/.ptah/secrets.enc`.
 */

import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { runSecretStorageContract } from '@ptah-extension/platform-core/testing';
import { CliSecretStorage } from './cli-secret-storage';

const tmpDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ptah-cli-sec-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (!dir) continue;
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {
      /* swallow */
    });
  }
});

runSecretStorageContract('CliSecretStorage', async () => {
  const storage = await makeTempDir();
  return new CliSecretStorage(storage);
});

describe('CliSecretStorage — CLI-specific behaviour', () => {
  let storage: string;

  beforeEach(async () => {
    storage = await makeTempDir();
  });

  it('persists secrets to an encrypted `secrets.enc` file on disk', async () => {
    const provider = new CliSecretStorage(storage);
    await provider.store('api-token', 'sk-1234');

    const raw = await fs.readFile(path.join(storage, 'secrets.enc'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, string>;
    // Must have the four encryption-envelope fields — never the plaintext key.
    expect(parsed).toHaveProperty('salt');
    expect(parsed).toHaveProperty('iv');
    expect(parsed).toHaveProperty('tag');
    expect(parsed).toHaveProperty('data');
    expect(raw).not.toContain('sk-1234');
  });

  it('secrets survive a provider restart (encrypted file reload)', async () => {
    const writer = new CliSecretStorage(storage);
    await writer.store('persistent', 'hello');

    const reader = new CliSecretStorage(storage);
    expect(await reader.get('persistent')).toBe('hello');
  });

  it('delete removes the key from the on-disk file', async () => {
    const provider = new CliSecretStorage(storage);
    await provider.store('transient', 'v');
    await provider.delete('transient');

    // Reopen to force a full decrypt path.
    const reopened = new CliSecretStorage(storage);
    expect(await reopened.get('transient')).toBeUndefined();
  });

  it('delete on a missing key does not throw and does not fire onDidChange', async () => {
    const provider = new CliSecretStorage(storage);
    const seen: string[] = [];
    const sub = provider.onDidChange((e) => seen.push(e.key));
    await expect(provider.delete('never-stored')).resolves.not.toThrow();
    sub.dispose();
    expect(seen).not.toContain('never-stored');
  });

  it('corrupted on-disk payload is ignored — provider starts fresh', async () => {
    // Seed garbage where the encrypted envelope should be.
    await fs.writeFile(
      path.join(storage, 'secrets.enc'),
      'not-json-at-all',
      'utf-8',
    );
    const provider = new CliSecretStorage(storage);
    expect(await provider.get('anything')).toBeUndefined();

    // And the provider should still be usable — write a fresh secret.
    await provider.store('fresh', 'value');
    expect(await provider.get('fresh')).toBe('value');
  });

  it('tamper-detection: flipped ciphertext byte causes decrypt to fail gracefully', async () => {
    // Write a valid secret, then flip a byte of the stored ciphertext and
    // confirm the reopened provider starts empty instead of throwing.
    const writer = new CliSecretStorage(storage);
    await writer.store('canary', 'v');

    const raw = await fs.readFile(path.join(storage, 'secrets.enc'), 'utf-8');
    const parsed = JSON.parse(raw) as { data: string } & Record<string, string>;
    // Flip the first hex char of `data` — guaranteed to invalidate the tag.
    const first = parsed.data[0];
    const flipped = first === '0' ? '1' : '0';
    parsed.data = flipped + parsed.data.slice(1);
    await fs.writeFile(
      path.join(storage, 'secrets.enc'),
      JSON.stringify(parsed),
      'utf-8',
    );

    const reopened = new CliSecretStorage(storage);
    expect(await reopened.get('canary')).toBeUndefined();
  });

  it('uses atomic rename (no leftover .tmp after a successful store)', async () => {
    const provider = new CliSecretStorage(storage);
    await provider.store('atomic', 'yes');
    const entries = await fs.readdir(storage);
    expect(entries).toContain('secrets.enc');
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });
});
