import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { ITokenVault } from '@ptah-extension/messaging-gateway';

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const SALT_LENGTH = 32;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';

export type VaultWarnSink = (message: string) => void;

export class CliTokenVault implements ITokenVault {
  private readonly key: Buffer;
  private readonly warn: VaultWarnSink;
  private readonly saltPath: string;

  constructor(warn?: VaultWarnSink, saltPath?: string) {
    this.warn =
      warn ??
      ((message: string): void => {
        process.emitWarning(message, 'CliTokenVault');
      });
    this.saltPath =
      saltPath ??
      path.join(os.homedir(), '.ptah', 'state', 'gateway-vault.salt');
    const salt = this.loadOrCreateSalt();
    this.key = crypto.pbkdf2Sync(
      this.computeMachineId(),
      salt,
      PBKDF2_ITERATIONS,
      KEY_LENGTH,
      PBKDF2_DIGEST,
    );
  }

  isEncryptionAvailable(): boolean {
    return true;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    let data = cipher.update(plaintext, 'utf-8', 'hex');
    data += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${data}`;
  }

  decrypt(ciphertext: string): string | null {
    try {
      const parts = ciphertext.split(':');
      if (parts.length !== 4 || parts[0] !== 'v1') {
        return null;
      }
      const iv = Buffer.from(parts[1], 'hex');
      const tag = Buffer.from(parts[2], 'hex');
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      let plaintext = decipher.update(parts[3], 'hex', 'utf-8');
      plaintext += decipher.final('utf-8');
      return plaintext;
    } catch {
      return null;
    }
  }

  private computeMachineId(): string {
    try {
      return `${os.hostname()}:${os.userInfo().username}`;
    } catch {
      return `${os.hostname()}:unknown`;
    }
  }

  private warnSaltNotPersisted(saltPath: string, error: unknown): void {
    const reason = error instanceof Error ? error.message : String(error);
    this.warn(
      `gateway token-vault salt could not be persisted to ${saltPath} (${reason}); ` +
        'tokens encrypted in this process will not be readable after restart — ' +
        're-run `ptah gateway set-token` once the state directory is writable',
    );
  }

  private loadOrCreateSalt(): Buffer {
    const saltPath = this.saltPath;
    try {
      const existing = fs.readFileSync(saltPath);
      if (existing.length === SALT_LENGTH) {
        return existing;
      }
    } catch {
      void 0;
    }
    const salt = crypto.randomBytes(SALT_LENGTH);
    try {
      fs.mkdirSync(path.dirname(saltPath), { recursive: true });
      fs.writeFileSync(saltPath, salt, { mode: 0o600 });
    } catch (error: unknown) {
      this.warnSaltNotPersisted(saltPath, error);
    }
    return salt;
  }
}
