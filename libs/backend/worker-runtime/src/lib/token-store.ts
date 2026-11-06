import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { ensureWorkerDirectory, WorkerPaths } from './paths';
import type { WorkerGrant } from '@ptah-extension/worker-protocol';
import { writeJsonAtomic } from './atomic-file';
import { withFileLock } from './file-lock';

const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** `lastUsedAt` is written at most once per token in this window. */
const LAST_USED_DEBOUNCE_MS = 60_000;

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

/**
 * The worker's token file. Every writer takes the file lock, reloads the file
 * under it and writes through one atomic save, so concurrent pairing,
 * revocation and grant changes never drop each other's records.
 */
export class TokenStore {
  private records: WorkerTokenRecord[] = [];
  private readonly lastRecorded = new Map<string, number>();
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
      if (!isMissing(error)) throw error;
      this.records = [];
    }
  }

  list(): WorkerTokenRecord[] {
    return this.records.map(copy);
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
    await this.mutate((records) => [
      ...records,
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
    return found && !found.revokedAt && matches ? copy(found) : null;
  }

  /**
   * Marks the token revoked. Returns the record, or undefined for an unknown
   * token. Revoking a revoked token keeps its first `revokedAt`.
   */
  async revoke(tokenId: string): Promise<WorkerTokenRecord | undefined> {
    let revoked: WorkerTokenRecord | undefined;
    await this.mutate((records) =>
      records.map((record) => {
        if (record.tokenId !== tokenId) return record;
        revoked = record.revokedAt
          ? record
          : { ...record, revokedAt: new Date().toISOString() };
        return revoked;
      }),
    );
    return revoked && copy(revoked);
  }

  /**
   * Adds workspace IDs to a live token's grant. Returns the updated record, or
   * undefined when the token is unknown or revoked.
   */
  async addWorkspaces(
    tokenId: string,
    workspaceIds: readonly string[],
  ): Promise<WorkerTokenRecord | undefined> {
    let updated: WorkerTokenRecord | undefined;
    await this.mutate((records) =>
      records.map((record) => {
        if (record.tokenId !== tokenId || record.revokedAt) return record;
        updated = {
          ...record,
          grant: {
            ...record.grant,
            workspaceIds: [
              ...new Set([...record.grant.workspaceIds, ...workspaceIds]),
            ],
          },
        };
        return updated;
      }),
    );
    return updated && copy(updated);
  }

  /**
   * Records a successful authentication in `lastUsedAt`. Writes at most once
   * per token per minute; a revoked or unknown token is left alone.
   */
  async recordUse(tokenId: string): Promise<void> {
    const now = Date.now();
    const last = this.lastRecorded.get(tokenId);
    if (last !== undefined && now - last < LAST_USED_DEBOUNCE_MS) return;
    await this.mutate((records) =>
      records.map((record) =>
        record.tokenId === tokenId && !record.revokedAt
          ? { ...record, lastUsedAt: new Date(now).toISOString() }
          : record,
      ),
    );
    // Only a written use starts the debounce window; a failed write retries
    // on the next authentication.
    this.lastRecorded.set(tokenId, now);
  }

  /** Lock, reload, change and save in one step; the only writer of the file. */
  private async mutate(
    change: (records: WorkerTokenRecord[]) => WorkerTokenRecord[],
  ): Promise<void> {
    await ensureWorkerDirectory(this.paths);
    await withFileLock(this.paths.tokens, async () => {
      await this.load();
      const next = change(this.list());
      await writeJsonAtomic(this.paths.tokens, next);
      this.records = next;
    });
  }
}

function copy(record: WorkerTokenRecord): WorkerTokenRecord {
  return {
    ...record,
    grant: { ...record.grant, workspaceIds: [...record.grant.workspaceIds] },
  };
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
