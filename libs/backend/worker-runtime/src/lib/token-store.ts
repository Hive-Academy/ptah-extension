import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { ensureWorkerDirectory, WorkerPaths } from './paths';
import type { WorkerGrant } from '@ptah-extension/worker-protocol';

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export interface WorkerTokenRecord {
  tokenId: string;
  secretHash: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
  grant: WorkerGrant;
  revokedAt?: string;
}

export class InsecureTokenFileError extends Error {
  readonly code = 'INSECURE_TOKEN_FILE';
  constructor() {
    super('Worker tokens.json must be readable only by its owner (mode 0600).');
    this.name = 'InsecureTokenFileError';
  }
}

export class TokenStore {
  private records: WorkerTokenRecord[] = [];
  constructor(private readonly paths: WorkerPaths) {}

  async load(): Promise<void> {
    try {
      const info = await stat(this.paths.tokens);
      if ((info.mode & 0o077) !== 0) throw new InsecureTokenFileError();
      const value: unknown = JSON.parse(
        await readFile(this.paths.tokens, 'utf8'),
      );
      if (!Array.isArray(value) || !value.every(isTokenRecord))
        throw new Error('Invalid worker token store');
      this.records = value;
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }
  }

  list(): WorkerTokenRecord[] {
    return this.records.map((record) => ({
      ...record,
      grant: { ...record.grant, workspaceIds: [...record.grant.workspaceIds] },
    }));
  }

  async issue(
    clientName: string,
    grant: WorkerGrant,
  ): Promise<{ token: string; tokenId: string }> {
    const digits = randomBytes(8);
    let bits = BigInt(`0x${digits.toString('hex')}`) & ((1n << 60n) - 1n);
    let tokenId = '';
    for (let i = 0; i < 12; i += 1) {
      tokenId = BASE32[Number(bits & 31n)] + tokenId;
      bits >>= 5n;
    }
    const secret = randomBytes(32).toString('base64url');
    const now = new Date().toISOString();
    await this.save([
      ...this.records,
      {
        tokenId,
        secretHash: hash(secret),
        clientName,
        createdAt: now,
        lastUsedAt: null,
        grant,
      },
    ]);
    return { token: `ptw1.${tokenId}.${secret}`, tokenId };
  }

  authenticate(token: string): WorkerTokenRecord | null {
    const match = /^ptw1\.([0-9A-HJKMNP-TV-Z]{12})\.([A-Za-z0-9_-]{43})$/.exec(
      token,
    );
    const found = this.records.find((record) => record.tokenId === match?.[1]);
    const expected = Buffer.from(
      found?.secretHash ?? randomBytes(32).toString('hex'),
      'hex',
    );
    const actual = Buffer.from(hash(match?.[2] ?? ''), 'hex');
    const matches = timingSafeEqual(expected, actual);
    return found && !found.revokedAt && matches
      ? {
          ...found,
          grant: {
            ...found.grant,
            workspaceIds: [...found.grant.workspaceIds],
          },
        }
      : null;
  }

  async revoke(tokenId: string): Promise<void> {
    await this.save(
      this.records.map((record) =>
        record.tokenId === tokenId
          ? { ...record, revokedAt: new Date().toISOString() }
          : record,
      ),
    );
  }

  private async save(records: WorkerTokenRecord[]): Promise<void> {
    await ensureWorkerDirectory(this.paths);
    const temporary = `${this.paths.tokens}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    await writeFile(temporary, JSON.stringify(records), {
      mode: 0o600,
      flag: 'wx',
    });
    await rename(temporary, this.paths.tokens);
    this.records = records;
  }
}

function hash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
function isTokenRecord(value: unknown): value is WorkerTokenRecord {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<WorkerTokenRecord>;
  return (
    typeof item.tokenId === 'string' &&
    typeof item.secretHash === 'string' &&
    typeof item.clientName === 'string' &&
    typeof item.createdAt === 'string' &&
    (item.lastUsedAt === null || typeof item.lastUsedAt === 'string') &&
    typeof item.grant?.machineId === 'string' &&
    Array.isArray(item.grant.workspaceIds) &&
    item.grant.workspaceIds.every((id) => typeof id === 'string')
  );
}
