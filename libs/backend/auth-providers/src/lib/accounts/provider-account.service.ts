import { randomUUID } from 'node:crypto';
import { mkdirSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { inject, injectable } from 'tsyringe';
import { PERSISTENCE_TOKENS } from '@ptah-extension/persistence-sqlite';
import type { ProviderAccountAdmissionPort, ClaudeAccountAdmissionRequest, ClaudeAccountAdmissionOutcome,
  ClaudeAccountReservationRelease, ClaudeAccountReservationReleaseOutcome,
  ClaudeAccountReservationRetain, ClaudeAccountReservationRetainOutcome, ProviderAccountPortRefusal } from '@ptah-extension/auth-providers-tokens';
import { accountActionResult } from './claude-account-command';
import type { SqliteConnectionService, SqliteDatabase } from '@ptah-extension/persistence-sqlite';
import { isProviderAccountOpaqueId, isSafeProviderAccountLabel, type ProviderAccountScope, type ProviderAccountSummary } from '@ptah-extension/shared';
import { ProviderAccountStore, type StoredProviderAccount, type StoredAccountSelection } from './provider-account.store';
import { ProviderAccountStoreError, providerAccountErrorCode } from './provider-account-route';

const admissionRequestSchema = z.object({
  provider: z.literal('claude'), scope: z.enum(['main', 'lane']),
  operationId: z.string().refine(isProviderAccountOpaqueId),
  runId: z.string().refine(isProviderAccountOpaqueId),
  selection: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('omitted') }).strict(),
    z.object({ kind: z.literal('ambient') }).strict(),
    z.object({ kind: z.literal('named'), profileId: z.string().refine(isProviderAccountOpaqueId) }).strict(),
  ]),
}).strict();

/** Metadata and fail-closed admission. Construction never reads the database. */
@injectable()
export class ProviderAccountService implements ProviderAccountAdmissionPort {
  private disposed = false;

  constructor(@inject(ProviderAccountStore) private readonly store: ProviderAccountStore,
    @inject(PERSISTENCE_TOKENS.SQLITE_CONNECTION)
    private readonly connection: Pick<SqliteConnectionService, 'db' | 'dbPath'>) {}

  async admitClaudeRoute(request: ClaudeAccountAdmissionRequest): Promise<ClaudeAccountAdmissionOutcome> {
    try {
      if (this.disposed) return this.refusal('unavailable-storage');
      if (request.provider !== 'claude') return this.refusal('wrong-provider');
      const parsed = admissionRequestSchema.safeParse(request);
      if (!parsed.success) return this.refusal('conflict');
      const selection = parsed.data.selection;
      if (selection.kind === 'named') this.store.get(selection.profileId);
      // D7: certification and successful admission belong to later batches.
      // Never manufacture a certified route from persisted directory metadata.
      return this.refusal('release-held');
    } catch (error: unknown) {
      return this.refusal(error instanceof ProviderAccountStoreError ? error.code : 'unavailable-storage');
    }
  }

  async releaseReservation(_command: ClaudeAccountReservationRelease): Promise<ClaudeAccountReservationReleaseOutcome> {
    return this.refusal('conflict');
  }

  async retainUnresolvedReservation(_command: ClaudeAccountReservationRetain): Promise<ClaudeAccountReservationRetainOutcome> {
    return this.refusal('conflict');
  }

  dispose(): void {
    this.disposed = true;
    // Disposal is not termination proof. Never sweep persisted reservations.
  }

  private refusal(code: ProviderAccountPortRefusal['code']): ProviderAccountPortRefusal {
    return { code, summary: accountActionResult(code).summary };
  }

  add(label: string): ProviderAccountSummary {
    if (!isSafeProviderAccountLabel(label)) throw new ProviderAccountStoreError('conflict');
    const dbPath = this.connection.dbPath;
    if (!isAbsolute(dbPath)) throw new ProviderAccountStoreError('unavailable-storage');
    try {
      // Check each owned parent; do not follow a substituted symlink or junction.
      let parent = dirname(dbPath);
      for (const segment of ['provider-accounts', 'claude']) {
        parent = join(parent, segment);
        try { mkdirSync(parent, { mode: 0o700 }); }
        catch (error: unknown) {
          if (providerAccountErrorCode(error) !== 'EEXIST') throw error;
        }
        const stat = lstatSync(parent);
        if (stat.isSymbolicLink() || !stat.isDirectory()) throw new ProviderAccountStoreError('unsupported-store');
      }
      const profileId = randomUUID();
      return this.summary(this.store.add(profileId, label, join(parent, profileId)));
    } catch (error: unknown) {
      if (error instanceof ProviderAccountStoreError) throw error;
      throw new ProviderAccountStoreError('unavailable-storage');
    }
  }

  list(): readonly ProviderAccountSummary[] { return this.store.list().map(profile => this.summary(profile)); }
  rename(profileId: string, expectedRevision: number, label: string): ProviderAccountSummary {
    return this.summary(this.store.rename(profileId, expectedRevision, label));
  }
  remove(profileId: string, expectedRevision: number): void { this.store.remove(profileId, expectedRevision); }
  selection(workspaceRoot: string, scope: ProviderAccountScope): StoredAccountSelection {
    return this.store.selection(workspaceRoot, scope);
  }
  select(workspaceRoot: string, scope: ProviderAccountScope, profileId: string | null,
    expectedRevision: number, expectedProfileRevision?: number): StoredAccountSelection {
    return this.store.select(workspaceRoot, scope, profileId, expectedRevision, expectedProfileRevision);
  }

  /** Both scope CAS checks and both writes share one immediate transaction. */
  setDefault(workspaceRoot: string, profileId: string | null,
    expected: Readonly<Record<ProviderAccountScope, number>>, expectedProfileRevision?: number):
    Readonly<Record<ProviderAccountScope, StoredAccountSelection>> {
    if (!workspaceRoot || (profileId !== null && !isProviderAccountOpaqueId(profileId)) ||
      ![expected.main, expected.lane].every(value => Number.isSafeInteger(value) && value >= -1) ||
      (profileId !== null && (!Number.isSafeInteger(expectedProfileRevision) || (expectedProfileRevision ?? -1) < 0))) {
      throw new ProviderAccountStoreError('conflict');
    }
    let db: SqliteDatabase | undefined;
    let started = false;
    try {
      db = this.connection.db;
      if (db.inTransaction) throw new ProviderAccountStoreError('conflict');
      db.exec('BEGIN IMMEDIATE');
      started = true;
      if (profileId !== null) {
        const raw = db.prepare("SELECT revision, route_fingerprint FROM provider_account_profiles WHERE profile_id = ? AND provider = 'claude' AND removed_at IS NULL").get(profileId);
        if (!raw) throw new ProviderAccountStoreError('missing-profile');
        const profile = z.object({ revision: z.number().int().nonnegative(), route_fingerprint: z.string() }).parse(raw);
        if (profile.revision !== expectedProfileRevision) throw new ProviderAccountStoreError('conflict');
        if (db.prepare('SELECT 1 FROM provider_account_operations WHERE route_fingerprint = ?').get(profile.route_fingerprint)) {
          throw new ProviderAccountStoreError('busy');
        }
      }
      for (const scope of ['main', 'lane'] as const) {
        const raw = db.prepare("SELECT revision FROM provider_account_selections WHERE workspace_root = ? AND provider = 'claude' AND scope = ?").get(workspaceRoot, scope);
        const revision = raw ? z.object({ revision: z.number().int().nonnegative() }).parse(raw).revision : -1;
        if (revision !== expected[scope]) throw new ProviderAccountStoreError('conflict');
        db.prepare(`INSERT INTO provider_account_selections (workspace_root, provider, scope, profile_id, revision, updated_at)
          VALUES (?, 'claude', ?, ?, ?, ?) ON CONFLICT(workspace_root, provider, scope)
          DO UPDATE SET profile_id = excluded.profile_id, revision = excluded.revision, updated_at = excluded.updated_at`)
          .run(workspaceRoot, scope, profileId, revision + 1, Date.now());
      }
      db.exec('COMMIT');
      return { main: { profileId, revision: expected.main + 1 }, lane: { profileId, revision: expected.lane + 1 } };
    } catch (error: unknown) {
      if (started && db?.inTransaction) {
        try { db.exec('ROLLBACK'); }
        catch (rollbackError: unknown) {
          // degradation-audit: optional-capability — preserve the original safe refusal if SQLite ended the transaction
        }
      }
      if (error instanceof ProviderAccountStoreError) throw error;
      if (/SQLITE_(BUSY|LOCKED)/.test(providerAccountErrorCode(error))) {
        throw new ProviderAccountStoreError('busy');
      }
      throw new ProviderAccountStoreError('unavailable-storage');
    }
  }

  private summary(profile: StoredProviderAccount): ProviderAccountSummary {
    try {
      const row = this.connection.db.prepare('SELECT COUNT(*) AS count FROM provider_account_run_leases WHERE route_fingerprint = ?').get(profile.route_fingerprint);
      const activeRunCount = z.object({ count: z.number().int().nonnegative() }).parse(row).count;
      return { profileId: profile.profile_id, provider: 'claude', label: profile.label, state: profile.state,
        revision: profile.revision, owner: 'unknown', activeRunCount };
    } catch (error: unknown) {
      if (error instanceof ProviderAccountStoreError) throw error;
      throw new ProviderAccountStoreError('unavailable-storage');
    }
  }
}
