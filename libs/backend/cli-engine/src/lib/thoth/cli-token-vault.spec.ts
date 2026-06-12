import 'reflect-metadata';

import { CliTokenVault } from './cli-token-vault';

describe('CliTokenVault', () => {
  let vault: CliTokenVault;

  beforeEach(() => {
    vault = new CliTokenVault();
  });

  it('reports encryption available', () => {
    expect(vault.isEncryptionAvailable()).toBe(true);
  });

  it('round-trips encrypt → decrypt', () => {
    const secret = 'xoxb-super-secret-token-12345';
    const ciphertext = vault.encrypt(secret);
    expect(ciphertext).not.toContain(secret);
    expect(ciphertext.startsWith('v1:')).toBe(true);
    expect(vault.decrypt(ciphertext)).toBe(secret);
  });

  it('produces a v1:<iv>:<tag>:<data> ciphertext shape', () => {
    const ciphertext = vault.encrypt('plaintext');
    const parts = ciphertext.split(':');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
    expect(parts[2]).toMatch(/^[0-9a-f]+$/);
  });

  it('returns null on a tampered ciphertext', () => {
    const ciphertext = vault.encrypt('secret');
    const parts = ciphertext.split(':');
    const tampered = `v1:${parts[1]}:${parts[2]}:${parts[3].replace(
      /.$/,
      (ch) => (ch === '0' ? '1' : '0'),
    )}`;
    expect(vault.decrypt(tampered)).toBeNull();
  });

  it('returns null on malformed ciphertext', () => {
    expect(vault.decrypt('not-a-valid-blob')).toBeNull();
    expect(vault.decrypt('v2:aa:bb:cc')).toBeNull();
    expect(vault.decrypt('')).toBeNull();
  });

  it('never emits the plaintext inside the ciphertext', () => {
    const secret = 'plaintext-marker-9f8e7d';
    const ciphertext = vault.encrypt(secret);
    expect(ciphertext.includes(secret)).toBe(false);
  });
});
