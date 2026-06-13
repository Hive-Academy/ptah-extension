import 'reflect-metadata';

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { CliTokenVault } from './cli-token-vault';

const SALT_PATH = path.join(
  os.homedir(),
  '.ptah',
  'state',
  'gateway-vault.salt',
);

describe('CliTokenVault — extended Vault coverage', () => {
  describe('multi-byte UTF-8 round-trip', () => {
    it('round-trips a token containing multi-byte UTF-8 characters', () => {
      const vault = new CliTokenVault();
      const secret = '日本語トークン-🔑-tg-12345';
      const ciphertext = vault.encrypt(secret);
      expect(vault.decrypt(ciphertext)).toBe(secret);
    });

    it('round-trips a token that is entirely emoji / supplementary BMP', () => {
      const vault = new CliTokenVault();
      const secret = '🚀🛸🌍🔒🗝️';
      const ciphertext = vault.encrypt(secret);
      expect(vault.decrypt(ciphertext)).toBe(secret);
    });

    it('round-trips an empty string without crashing', () => {
      const vault = new CliTokenVault();
      const ciphertext = vault.encrypt('');
      expect(vault.decrypt(ciphertext)).toBe('');
    });

    it('round-trips a 4096-character ASCII string (long token)', () => {
      const vault = new CliTokenVault();
      const secret = 'x'.repeat(4096);
      expect(vault.decrypt(vault.encrypt(secret))).toBe(secret);
    });
  });

  describe('wrong-key decrypt → null', () => {
    it('returns null when decrypting ciphertext with a different vault instance (different key material)', () => {
      const vaultA = new CliTokenVault();
      const ciphertext = vaultA.encrypt('secret-payload');

      const saltPath = SALT_PATH;
      let saltBackup: Buffer | undefined;
      try {
        saltBackup = fs.readFileSync(saltPath);
      } catch {
        void 0;
      }

      try {
        fs.mkdirSync(path.dirname(saltPath), { recursive: true });
        fs.writeFileSync(saltPath, Buffer.alloc(32, 0xab), { mode: 0o600 });
        const vaultB = new CliTokenVault();
        const result = vaultB.decrypt(ciphertext);
        expect(result).toBeNull();
      } finally {
        if (saltBackup !== undefined) {
          fs.writeFileSync(saltPath, saltBackup, { mode: 0o600 });
        } else {
          try {
            fs.unlinkSync(saltPath);
          } catch {
            void 0;
          }
        }
      }
    });

    it('returns null when the auth tag is all-zeros (wrong tag)', () => {
      const vault = new CliTokenVault();
      const ct = vault.encrypt('abc');
      const parts = ct.split(':');
      const wrongTag = '00'.repeat(16);
      expect(
        vault.decrypt(`v1:${parts[1]}:${wrongTag}:${parts[3]}`),
      ).toBeNull();
    });
  });

  describe('salt-write failure observability', () => {
    it('warns through the injected sink when the salt cannot be persisted', () => {
      const blocker = path.join(
        os.tmpdir(),
        `ptah-vault-blocker-${process.pid}-${Date.now()}`,
      );
      fs.writeFileSync(blocker, 'not a directory');
      const unwritableSaltPath = path.join(blocker, 'gateway-vault.salt');

      const warn = jest.fn();
      try {
        const vault = new CliTokenVault(warn, unwritableSaltPath);
        expect(warn).toHaveBeenCalledTimes(1);
        const message = warn.mock.calls[0][0] as string;
        expect(message).toContain('salt could not be persisted');
        expect(message).toContain(unwritableSaltPath);
        const secret = 'ephemeral-salt-token';
        expect(vault.decrypt(vault.encrypt(secret))).toBe(secret);
      } finally {
        try {
          fs.unlinkSync(blocker);
        } catch {
          void 0;
        }
      }
    });

    it('does not warn when the salt persists successfully', () => {
      const okSaltPath = path.join(
        os.tmpdir(),
        `ptah-vault-ok-${process.pid}-${Date.now()}`,
        'gateway-vault.salt',
      );
      const warn = jest.fn();
      try {
        const vault = new CliTokenVault(warn, okSaltPath);
        expect(warn).not.toHaveBeenCalled();
        expect(vault.decrypt(vault.encrypt('ok'))).toBe('ok');
      } finally {
        try {
          fs.rmSync(path.dirname(okSaltPath), {
            recursive: true,
            force: true,
          });
        } catch {
          void 0;
        }
      }
    });
  });

  describe('salt file recreation', () => {
    it('creates a fresh salt and still encrypts/decrypts when the salt file does not exist', () => {
      let savedSalt: Buffer | undefined;
      try {
        savedSalt = fs.readFileSync(SALT_PATH);
        fs.unlinkSync(SALT_PATH);
      } catch {
        void 0;
      }

      try {
        const vault = new CliTokenVault();
        const secret = 'recreate-salt-test-token';
        const ct = vault.encrypt(secret);
        expect(vault.decrypt(ct)).toBe(secret);
        expect(fs.existsSync(SALT_PATH)).toBe(true);
        const newSalt = fs.readFileSync(SALT_PATH);
        expect(newSalt.length).toBe(32);
      } finally {
        if (savedSalt !== undefined) {
          try {
            fs.writeFileSync(SALT_PATH, savedSalt, { mode: 0o600 });
          } catch {
            void 0;
          }
        }
      }
    });

    it('falls back gracefully when the salt file contains fewer than 32 bytes', () => {
      let savedSalt: Buffer | undefined;
      try {
        savedSalt = fs.readFileSync(SALT_PATH);
      } catch {
        void 0;
      }

      try {
        fs.mkdirSync(path.dirname(SALT_PATH), { recursive: true });
        fs.writeFileSync(SALT_PATH, Buffer.alloc(16, 0xcc), { mode: 0o600 });
        const vault = new CliTokenVault();
        const secret = 'short-salt-fallback';
        expect(vault.decrypt(vault.encrypt(secret))).toBe(secret);
      } finally {
        if (savedSalt !== undefined) {
          try {
            fs.writeFileSync(SALT_PATH, savedSalt, { mode: 0o600 });
          } catch {
            void 0;
          }
        }
      }
    });
  });
});
