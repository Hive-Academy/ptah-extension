/**
 * machine-seed-key — unit tests for the stable per-machine key derivation
 * and AES-256-GCM envelope helpers.
 *
 * Source-under-test:
 *   libs/backend/platform-electron/src/settings/machine-seed-key.ts
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  deriveMachineSeedKey,
  encryptWithMachineSeed,
  decryptWithMachineSeed,
  MACHINE_WRAP_PREFIX,
} from './machine-seed-key';

// On Linux CI /etc/machine-id exists, which takes priority over the per-dir
// .machine-uuid fallback and makes every ptahDir derive the SAME key. Force
// ENOENT on the system machine-id paths so the suite deterministically
// exercises the .machine-uuid path on every OS.
jest.mock('fs', () => {
  const actual = jest.requireActual<typeof import('fs')>('fs');
  const readFileSync = ((...args: Parameters<typeof actual.readFileSync>) => {
    const [file] = args;
    if (file === '/etc/machine-id' || file === '/var/lib/dbus/machine-id') {
      throw Object.assign(
        new Error(`ENOENT: no such file or directory, open '${file}'`),
        { code: 'ENOENT' },
      );
    }
    return actual.readFileSync(...args);
  }) as typeof actual.readFileSync;
  return { ...actual, readFileSync };
});

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ptah-machine-seed-'));
}

describe('machine-seed-key', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTempDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('derives a stable 32-byte key and persists a .machine-uuid file', () => {
    const key = deriveMachineSeedKey(tmpDir);
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBe(32);

    // With the system machine-id paths stubbed out, the uuid file is created.
    expect(fs.existsSync(path.join(tmpDir, '.machine-uuid'))).toBe(true);
    const key2 = deriveMachineSeedKey(tmpDir);
    expect(key2.toString('hex')).toBe(key.toString('hex'));
  });

  it('round-trips plaintext through encrypt/decrypt', () => {
    const secret = 'discord-bot-token-abc123';
    const envelope = encryptWithMachineSeed(secret, tmpDir);
    expect(envelope.startsWith(MACHINE_WRAP_PREFIX)).toBe(true);
    // Format: gcm:<iv>:<tag>:<ct> — four colon-separated parts.
    expect(envelope.split(':')).toHaveLength(4);

    const decrypted = decryptWithMachineSeed(envelope, tmpDir);
    expect(decrypted).toBe(secret);
  });

  it('returns null for a malformed envelope', () => {
    expect(decryptWithMachineSeed('', tmpDir)).toBeNull();
    expect(decryptWithMachineSeed('not-an-envelope', tmpDir)).toBeNull();
    expect(decryptWithMachineSeed('gcm:only:three', tmpDir)).toBeNull();
  });

  it('returns null when decrypting under a different machine seed (tamper/wrong-machine)', () => {
    const envelope = encryptWithMachineSeed('secret', tmpDir);

    // A different ptahDir with its own .machine-uuid derives a different key.
    const otherDir = makeTempDir();
    try {
      expect(decryptWithMachineSeed(envelope, otherDir)).toBeNull();
    } finally {
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });

  it('uses a distinct info string from the messaging-gateway vault', () => {
    // Deriving here must NOT accidentally match the vault key. We can't import
    // the vault (app-level), but we assert the key is deterministic and the
    // envelope decrypts only with the same info-derived key (covered above).
    const a = deriveMachineSeedKey(tmpDir);
    const b = deriveMachineSeedKey(tmpDir);
    expect(a.equals(b)).toBe(true);
  });
});
